// ============================================================================
// session_manager.hpp
// Autonomous Retail Infrastructure — Customer Session Lifecycle Manager
//
// Manages up to MAX_SESSIONS concurrent shopping sessions in a flat
// open-addressing array indexed by SessionId hash. No heap allocations
// after initialization. Thread-safe via per-session spinlocks; the
// session table itself is mutated only by the door controller thread
// (session open/close), while cart mutations come from the fusion engine
// thread — both take only the lock for their specific session slot.
// ============================================================================
#pragma once

#include "retail_types.hpp"
#include <array>
#include <atomic>
#include <chrono>
#include <cstring>
#include <functional>
#include <mutex>
#include <optional>
#include <random>
#include <vector>

namespace retail {

// ----------------------------------------------------------------------------
// Per-session state. Aligned to a full cache line to prevent false sharing
// between adjacent session slots in the flat array.
// ----------------------------------------------------------------------------
struct alignas(128) SessionSlot {
    // Session identity
    SessionId       id;
    SessionState    state;

    // Timing
    int64_t         opened_at_us;    // Unix epoch microseconds
    int64_t         closed_at_us;

    // Shopping cart — vector of committed cart items
    std::vector<CartItem> cart;

    // Running financial totals (updated incrementally on each cart event)
    float           gross_total_cents;
    uint32_t        item_count;

    // Biometric / card identifier used at door entry
    char            customer_token[64];

    // Slot occupancy flag (checked without taking the lock for fast scan)
    std::atomic<bool> occupied;

    // Per-slot mutex (only held for microseconds during cart mutation)
    mutable std::mutex slot_mutex;

    // Reset all fields to a clean initial state (called when slot is reused)
    void reset() {
        state             = SessionState::INACTIVE;
        opened_at_us      = 0;
        closed_at_us      = 0;
        gross_total_cents = 0.0f;
        item_count        = 0;
        cart.clear();
        std::memset(customer_token, 0, sizeof(customer_token));
        occupied.store(false, std::memory_order_release);
    }

    // Non-copyable/movable — mutex and atomic make this non-trivial
    SessionSlot() { reset(); id = SessionId::INVALID; }
    SessionSlot(const SessionSlot&) = delete;
    SessionSlot& operator=(const SessionSlot&) = delete;
};

// ----------------------------------------------------------------------------
// SessionManager
// ----------------------------------------------------------------------------
class SessionManager {
public:
    explicit SessionManager() {
        for (auto& slot : slots_) {
            slot.id = SessionId::INVALID;
        }
    }

    // -------------------------------------------------------------------------
    // open_session — called by the door controller when a customer scans in.
    // Allocates a slot, generates a cryptographically-seeded session ID,
    // and unlocks the door. Returns INVALID on store-full condition.
    // -------------------------------------------------------------------------
    [[nodiscard]] SessionId open_session(std::string_view customer_token) {
        // Find a free slot (scan is O(MAX_SESSIONS) but MAX_SESSIONS == 64)
        for (auto& slot : slots_) {
            bool expected = false;
            if (slot.occupied.compare_exchange_strong(
                    expected, true,
                    std::memory_order_acq_rel, std::memory_order_relaxed)) {
                // We own this slot — initialize without holding a lock
                // (no other thread can see it until occupied == true with a valid id)
                slot.id              = generate_session_id();
                slot.state           = SessionState::ENTERING;
                slot.opened_at_us    = now_us();
                slot.gross_total_cents = 0.0f;
                slot.item_count      = 0;
                slot.cart.clear();

                const std::size_t copy_len = std::min(
                    customer_token.size(), sizeof(slot.customer_token) - 1);
                std::memcpy(slot.customer_token, customer_token.data(), copy_len);
                slot.customer_token[copy_len] = '\0';

                // Publish to table index for O(1) forward lookup
                {
                    std::lock_guard lk(table_mutex_);
                    id_to_slot_[static_cast<uint64_t>(slot.id) & MASK] = &slot;
                }

                slot.state = SessionState::ACTIVE;

                ++active_count_;
                return slot.id;
            }
        }
        return SessionId::INVALID;  // Store is at capacity
    }

    // -------------------------------------------------------------------------
    // close_session — called by the reconciliation engine after payment.
    // Marks session as CLOSING and schedules slot for reuse.
    // -------------------------------------------------------------------------
    bool close_session(SessionId id) {
        SessionSlot* slot = find_slot(id);
        if (!slot) return false;

        {
            std::lock_guard lk(slot->slot_mutex);
            if (slot->state == SessionState::SUSPENDED ||
                slot->state == SessionState::CHECKOUT) {
                slot->state        = SessionState::CLOSING;
                slot->closed_at_us = now_us();
            }
        }

        // Remove from lookup table then free slot
        {
            std::lock_guard lk(table_mutex_);
            id_to_slot_[static_cast<uint64_t>(id) & MASK] = nullptr;
        }

        slot->reset();
        --active_count_;
        return true;
    }

    // -------------------------------------------------------------------------
    // apply_cart_event — called by the sensor fusion engine.
    // Atomically appends a cart mutation and updates running totals.
    // -------------------------------------------------------------------------
    bool apply_cart_event(SessionId id, CartEventType type,
                          const ItemProfile& profile, float price_override = -1.0f) {
        SessionSlot* slot = find_slot(id);
        if (!slot) return false;

        std::lock_guard lk(slot->slot_mutex);

        if (slot->state != SessionState::ACTIVE) return false;

        float price = (price_override >= 0.0f)
                    ? price_override
                    : profile.unit_price_cents;

        switch (type) {
            case CartEventType::ITEM_ADDED: {
                // Check if SKU already in cart (merge quantities)
                bool merged = false;
                for (auto& item : slot->cart) {
                    if (item.sku == profile.sku) {
                        item.quantity++;
                        merged = true;
                        break;
                    }
                }
                if (!merged) {
                    CartItem ci;
                    ci.sku              = profile.sku;
                    ci.name             = profile.name;
                    ci.unit_price_cents = price;
                    ci.weight_grams     = profile.weight_grams;
                    ci.quantity         = 1;
                    slot->cart.push_back(std::move(ci));
                }
                slot->gross_total_cents += price;
                slot->item_count++;
                break;
            }

            case CartEventType::ITEM_REMOVED:
            case CartEventType::ITEM_RETURNED: {
                for (auto& item : slot->cart) {
                    if (item.sku == profile.sku && item.quantity > 0) {
                        item.quantity--;
                        slot->gross_total_cents -= price;
                        slot->item_count--;
                        break;
                    }
                }
                break;
            }

            default:
                break;
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // suspend_session — immediately freezes a session pending security review.
    // Cart changes are rejected while suspended.
    // -------------------------------------------------------------------------
    bool suspend_session(SessionId id) {
        SessionSlot* slot = find_slot(id);
        if (!slot) return false;
        std::lock_guard lk(slot->slot_mutex);
        if (slot->state == SessionState::ACTIVE) {
            slot->state = SessionState::SUSPENDED;
            return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // read_session — returns a snapshot of session state (copies, not ref).
    // Safe to call from the WebSocket broadcast thread.
    // -------------------------------------------------------------------------
    struct SessionSnapshot {
        SessionId       id;
        SessionState    state;
        int64_t         opened_at_us;
        float           gross_total_cents;
        uint32_t        item_count;
        char            customer_token[64];
        std::vector<CartItem> cart;
    };

    [[nodiscard]] std::optional<SessionSnapshot> read_session(SessionId id) const {
        const SessionSlot* slot = find_slot(id);
        if (!slot) return std::nullopt;

        std::lock_guard lk(slot->slot_mutex);
        SessionSnapshot snap;
        snap.id                = slot->id;
        snap.state             = slot->state;
        snap.opened_at_us      = slot->opened_at_us;
        snap.gross_total_cents = slot->gross_total_cents;
        snap.item_count        = slot->item_count;
        std::memcpy(snap.customer_token, slot->customer_token,
                    sizeof(snap.customer_token));
        snap.cart              = slot->cart;
        return snap;
    }

    // -------------------------------------------------------------------------
    // for_each_active — iterate all active sessions (used for telemetry push)
    // -------------------------------------------------------------------------
    void for_each_active(std::function<void(const SessionSlot&)> fn) const {
        for (const auto& slot : slots_) {
            if (slot.occupied.load(std::memory_order_acquire)) {
                std::lock_guard lk(slot.slot_mutex);
                fn(slot);
            }
        }
    }

    [[nodiscard]] int active_count() const noexcept {
        return active_count_.load(std::memory_order_relaxed);
    }

private:
    // O(1) slot lookup by session ID via flat hash index
    [[nodiscard]] SessionSlot* find_slot(SessionId id) {
        std::lock_guard lk(table_mutex_);
        SessionSlot* slot = id_to_slot_[static_cast<uint64_t>(id) & MASK];
        if (slot && slot->id == id) return slot;
        return nullptr;
    }

    [[nodiscard]] const SessionSlot* find_slot(SessionId id) const {
        std::lock_guard lk(table_mutex_);
        const SessionSlot* slot = id_to_slot_[static_cast<uint64_t>(id) & MASK];
        if (slot && slot->id == id) return slot;
        return nullptr;
    }

    [[nodiscard]] static SessionId generate_session_id() {
        // 64-bit ID from hardware entropy + monotonic counter
        static std::atomic<uint64_t> counter{1};
        thread_local std::mt19937_64 rng{std::random_device{}()};
        const uint64_t rand_part    = rng();
        const uint64_t counter_part = counter.fetch_add(1, std::memory_order_relaxed);
        // XOR fold to keep IDs unique even if rand repeats
        return static_cast<SessionId>(rand_part ^ (counter_part << 32));
    }

    [[nodiscard]] static int64_t now_us() {
        using namespace std::chrono;
        return duration_cast<microseconds>(
            system_clock::now().time_since_epoch()).count();
    }

    static constexpr std::size_t MASK = config::MAX_SESSIONS - 1;

    // The flat session slot array — no heap allocs after construction
    std::array<SessionSlot, config::MAX_SESSIONS> slots_;

    // Fast ID → slot* lookup (power-of-two sized, same as MAX_SESSIONS)
    std::array<SessionSlot*, config::MAX_SESSIONS> id_to_slot_{};
    mutable std::mutex table_mutex_;

    std::atomic<int> active_count_{0};
};

} // namespace retail
