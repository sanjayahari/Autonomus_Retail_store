// ============================================================================
// item_catalog.hpp
// Autonomous Retail Infrastructure — O(1) SKU Weight Profile Lookup
//
// A flat open-addressing hash map keyed by Sku (uint32_t).
// Unlike std::unordered_map, this structure:
//   - allocates no heap memory per entry (flat array of ItemProfile)
//   - has predictable cache behaviour (linear probing stays in L1/L2)
//   - is populated once at startup from SQLite and read-only thereafter,
//     so no synchronization is needed on the lookup path
//
// Probe sequence: linear with power-of-two table size (Capacity).
// Load factor must stay below 0.75 for acceptable probe lengths.
// ============================================================================
#pragma once

#include "retail_types.hpp"
#include <array>
#include <cstring>
#include <optional>
#include <stdexcept>

namespace retail {

template<std::size_t Capacity = 4096>
class ItemCatalog {
    static_assert((Capacity & (Capacity - 1)) == 0,
        "Capacity must be a power of two");

public:
    ItemCatalog() {
        // Mark every slot as invalid (empty)
        for (auto& slot : table_) {
            slot.valid = false;
        }
    }

    // -------------------------------------------------------------------------
    // insert — called once during catalog hydration at startup.
    // Throws if the table exceeds its load factor limit.
    // -------------------------------------------------------------------------
    void insert(const ItemProfile& profile) {
        if (count_ >= MAX_LOAD) {
            throw std::overflow_error(
                "ItemCatalog: load factor exceeded, increase Capacity");
        }

        std::size_t idx = hash(profile.sku);
        while (table_[idx].valid) {
            if (table_[idx].sku == profile.sku) {
                table_[idx] = profile;  // Update existing
                return;
            }
            idx = (idx + 1) & MASK;
        }

        table_[idx] = profile;
        ++count_;
    }

    // -------------------------------------------------------------------------
    // lookup — the hot path called on every weight event.
    // O(1) amortized. Returns nullptr if SKU is not in catalog.
    // -------------------------------------------------------------------------
    [[nodiscard]] const ItemProfile* lookup(Sku sku) const noexcept {
        std::size_t idx = hash(sku);

        // Linear probe — worst case is proportional to (1 / (1 - load_factor))
        // which at 0.75 max load is at most ~4 probes on average.
        for (std::size_t probe = 0; probe < Capacity; ++probe) {
            const ItemProfile& slot = table_[idx];
            if (!slot.valid)       return nullptr;  // Empty slot = miss
            if (slot.sku == sku)   return &slot;    // Hit
            idx = (idx + 1) & MASK;
        }
        return nullptr;
    }

    // -------------------------------------------------------------------------
    // match_by_weight — find best matching SKU for a given weight delta.
    // Used as a fallback when a shelf slot's expected SKU is ambiguous.
    // Returns nullptr if no profile is within WEIGHT_TOLERANCE_GRAMS.
    // This is O(n) and should only run on ambiguous events, not the hot path.
    // -------------------------------------------------------------------------
    [[nodiscard]] const ItemProfile* match_by_weight(float weight_grams) const noexcept {
        const float abs_weight = (weight_grams < 0) ? -weight_grams : weight_grams;
        const ItemProfile* best = nullptr;
        float best_delta = config::WEIGHT_TOLERANCE_GRAMS;

        for (const auto& slot : table_) {
            if (!slot.valid) continue;
            const float delta = abs_weight - slot.weight_grams;
            const float abs_delta = (delta < 0) ? -delta : delta;
            if (abs_delta < best_delta) {
                best_delta = abs_delta;
                best = &slot;
            }
        }
        return best;
    }

    [[nodiscard]] std::size_t count() const noexcept { return count_; }

private:
    // FNV-1a hash adapted for uint32_t — fast and well-distributed
    [[nodiscard]] static std::size_t hash(Sku sku) noexcept {
        constexpr uint32_t FNV_PRIME  = 16777619u;
        constexpr uint32_t FNV_OFFSET = 2166136261u;
        uint32_t key = static_cast<uint32_t>(sku);
        uint32_t h   = FNV_OFFSET;
        for (int i = 0; i < 4; ++i) {
            h ^= (key & 0xFF);
            h *= FNV_PRIME;
            key >>= 8;
        }
        return h & MASK;
    }

    static constexpr std::size_t MASK     = Capacity - 1;
    static constexpr std::size_t MAX_LOAD = (Capacity * 3) / 4;  // 75%

    std::array<ItemProfile, Capacity> table_{};
    std::size_t count_ = 0;
};

} // namespace retail
