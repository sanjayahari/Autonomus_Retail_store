// ============================================================================
// reconciliation_engine.hpp
// Autonomous Retail Infrastructure — Checkout & Daily Reconciliation Engine
//
// Responsibilities:
//   1. Process payment authorization at checkout terminal
//   2. Compute gross total, cost of goods, net profit (40% margin)
//   3. Write finalized Transaction to SQLite (WAL mode)
//   4. Decrement live inventory counts
//   5. Enqueue transaction to the cloud sync batch for PostgreSQL replication
// ============================================================================
#pragma once

#include "retail_types.hpp"
#include "session_manager.hpp"

#include <functional>
#include <mutex>
#include <queue>
#include <string>
#include <vector>

namespace retail {

// Callback: emitted when a transaction is finalized (for WebSocket push)
using TransactionCallback = std::function<void(const Transaction&)>;

// Simple in-memory inventory mirror (loaded from SQLite on startup)
using InventoryMap = std::unordered_map<uint32_t /*sku*/, int32_t /*qty*/>;

// ----------------------------------------------------------------------------
// ReconciliationEngine
// ----------------------------------------------------------------------------
class ReconciliationEngine {
public:
    explicit ReconciliationEngine(SessionManager&     session_mgr,
                                  TransactionCallback on_transaction,
                                  InventoryMap        initial_inventory)
        : session_mgr_(session_mgr)
        , on_transaction_(std::move(on_transaction))
        , inventory_(std::move(initial_inventory))
        , transaction_id_counter_(1)
    {}

    // -------------------------------------------------------------------------
    // process_checkout — called when a customer reaches the payment terminal.
    // Returns the finalized Transaction on success, nullopt on failure.
    //
    // Payment flow:
    //   1. Transition session to CHECKOUT state
    //   2. Call external payment gateway (stubbed here as authorize_payment)
    //   3. Compute financial breakdown
    //   4. Decrement inventory
    //   5. Finalize and persist
    // -------------------------------------------------------------------------
    [[nodiscard]] std::optional<Transaction> process_checkout(
            SessionId session_id,
            std::string_view payment_method) {

        auto snap = session_mgr_.read_session(session_id);
        if (!snap) return std::nullopt;
        if (snap->state == SessionState::SUSPENDED) return std::nullopt;

        // --- Step 1: Authorize payment ---
        const bool authorized = authorize_payment(
            payment_method, snap->gross_total_cents);

        // --- Step 2: Build transaction record ---
        Transaction txn;
        txn.transaction_id      = transaction_id_counter_++;
        txn.session_id          = session_id;
        txn.session_start_us    = snap->opened_at_us;
        txn.session_end_us      = now_us();
        txn.gross_total_cents   = snap->gross_total_cents;
        txn.cost_of_goods_cents = snap->gross_total_cents * (1.0f - config::RETAIL_MARGIN);
        txn.net_profit_cents    = snap->gross_total_cents * config::RETAIL_MARGIN;
        txn.item_count          = snap->item_count;
        txn.payment_authorized  = authorized;

        const std::size_t pm_len = std::min(
            payment_method.size(), sizeof(txn.payment_method) - 1);
        std::memcpy(txn.payment_method, payment_method.data(), pm_len);
        txn.payment_method[pm_len] = '\0';

        if (!authorized) {
            // Payment failed — keep session open for retry
            enqueue_cloud_sync(txn);
            on_transaction_(txn);
            return txn;
        }

        // --- Step 3: Decrement inventory ---
        {
            std::lock_guard lk(inventory_mutex_);
            for (const auto& item : snap->cart) {
                if (item.quantity > 0) {
                    auto it = inventory_.find(static_cast<uint32_t>(item.sku));
                    if (it != inventory_.end()) {
                        it->second -= item.quantity;
                    }
                }
            }
        }

        // --- Step 4: Enqueue for SQLite write + cloud sync ---
        enqueue_cloud_sync(txn);

        // --- Step 5: Close the session ---
        session_mgr_.close_session(session_id);

        // Notify WebSocket gateway
        on_transaction_(txn);

        return txn;
    }

    // -------------------------------------------------------------------------
    // get_inventory_count — O(1) lookup for current stock of a SKU
    // -------------------------------------------------------------------------
    [[nodiscard]] int32_t get_inventory_count(Sku sku) const {
        std::lock_guard lk(inventory_mutex_);
        auto it = inventory_.find(static_cast<uint32_t>(sku));
        return (it != inventory_.end()) ? it->second : -1;
    }

    // -------------------------------------------------------------------------
    // dequeue_sync_batch — called by the cloud sync agent thread to drain
    // finalized transactions for PostgreSQL replication.
    // Returns up to CLOUD_SYNC_BATCH_SIZE records per call.
    // -------------------------------------------------------------------------
    [[nodiscard]] std::vector<Transaction> dequeue_sync_batch() {
        std::lock_guard lk(sync_queue_mutex_);
        std::vector<Transaction> batch;
        batch.reserve(config::CLOUD_SYNC_BATCH_SIZE);

        while (!sync_queue_.empty()
               && batch.size() < static_cast<std::size_t>(config::CLOUD_SYNC_BATCH_SIZE)) {
            batch.push_back(sync_queue_.front());
            sync_queue_.pop();
        }
        return batch;
    }

    // -------------------------------------------------------------------------
    // daily_reconciliation — run at store close (or scheduled cron).
    // Returns a summary report for the dashboard.
    // -------------------------------------------------------------------------
    struct DailySummary {
        float  total_gross_cents;
        float  total_profit_cents;
        float  total_cogs_cents;
        int    total_transactions;
        int    authorized_transactions;
        int    failed_transactions;
        std::vector<std::pair<uint32_t /*sku*/, int32_t /*qty*/>> low_stock_items;
    };

    [[nodiscard]] DailySummary run_daily_reconciliation() {
        DailySummary summary{};

        // Drain all finalized transactions from today (in practice, fetched
        // from SQLite where date = TODAY; stubbed here)
        {
            std::lock_guard lk(daily_txn_mutex_);
            for (const auto& txn : daily_transactions_) {
                summary.total_gross_cents  += txn.gross_total_cents;
                summary.total_profit_cents += txn.net_profit_cents;
                summary.total_cogs_cents   += txn.cost_of_goods_cents;
                summary.total_transactions++;
                if (txn.payment_authorized) summary.authorized_transactions++;
                else                        summary.failed_transactions++;
            }
            daily_transactions_.clear();
        }

        // Identify low-stock items (threshold: qty < 5)
        {
            std::lock_guard lk(inventory_mutex_);
            for (const auto& [sku, qty] : inventory_) {
                if (qty < 5) {
                    summary.low_stock_items.emplace_back(sku, qty);
                }
            }
        }

        return summary;
    }

    void record_daily_transaction(const Transaction& txn) {
        std::lock_guard lk(daily_txn_mutex_);
        daily_transactions_.push_back(txn);
    }

private:
    // Stub: replace with actual payment gateway SDK call (Stripe, Adyen, etc.)
    [[nodiscard]] static bool authorize_payment(std::string_view method,
                                                float amount_cents) noexcept {
        (void)method; (void)amount_cents;
        // In production: call gateway SDK, return result of auth response.
        // Here we always approve for the prototype.
        return true;
    }

    void enqueue_cloud_sync(const Transaction& txn) {
        std::lock_guard lk(sync_queue_mutex_);
        sync_queue_.push(txn);
    }

    [[nodiscard]] static int64_t now_us() noexcept {
        using namespace std::chrono;
        return duration_cast<microseconds>(
            system_clock::now().time_since_epoch()).count();
    }

    SessionManager&     session_mgr_;
    TransactionCallback on_transaction_;

    mutable std::mutex  inventory_mutex_;
    InventoryMap        inventory_;

    std::mutex          sync_queue_mutex_;
    std::queue<Transaction> sync_queue_;

    std::mutex          daily_txn_mutex_;
    std::vector<Transaction> daily_transactions_;

    std::atomic<uint64_t> transaction_id_counter_;
};

} // namespace retail
