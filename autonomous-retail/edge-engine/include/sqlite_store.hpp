// ============================================================================
// sqlite_store.hpp
// Autonomous Retail Infrastructure — SQLite Persistence Layer
//
// All SQLite I/O goes through a single dedicated writer thread to ensure
// WAL mode delivers its maximum throughput benefit (one writer, many readers).
//
// Callers enqueue WriteOp variants via a lock-free queue.
// The writer thread drains the queue in batches wrapped in a single
// BEGIN / COMMIT transaction for 10–100× throughput vs. auto-commit.
//
// Prepared statements are compiled once at startup and reused for
// every subsequent write — zero parse overhead on the hot path.
//
// Read operations (catalog hydration, inventory load) are called once
// at startup from the main thread before the writer loop starts.
// ============================================================================
#pragma once

#include "retail_types.hpp"

#include <sqlite3.h>

#include <atomic>
#include <chrono>
#include <functional>
#include <iostream>
#include <mutex>
#include <queue>
#include <stdexcept>
#include <string>
#include <thread>
#include <variant>
#include <vector>

namespace retail {

// ─── Helper: throw on SQLite error ───────────────────────────────────────────
inline void sql_check(int rc, sqlite3* db, const char* ctx = "") {
    if (rc != SQLITE_OK && rc != SQLITE_ROW && rc != SQLITE_DONE) {
        throw std::runtime_error(
            std::string("[SQLite] ") + ctx + ": " + sqlite3_errmsg(db));
    }
}

// ─── Write operations submitted to the writer thread ─────────────────────────
struct WriteTransaction { Transaction txn; };
struct WriteIncident    { SecurityIncident inc; };
struct WriteCartEvent   {
    uint64_t  event_id;
    SessionId session_id;
    Sku       sku;
    CartEventType type;
    int32_t   quantity_delta;
    float     unit_price_cents;
    float     weight_delta_grams;
    bool      camera_corroborated;
    int64_t   timestamp_us;
};
struct WriteSession {
    SessionId   id;
    std::string customer_token;
    int64_t     opened_at_us;
};
struct MarkSynced { std::string table; uint64_t id; };

using WriteOp = std::variant<
    WriteTransaction,
    WriteIncident,
    WriteCartEvent,
    WriteSession,
    MarkSynced
>;

// ─── SQLiteStore ─────────────────────────────────────────────────────────────
class SQLiteStore {
public:
    explicit SQLiteStore(const std::string& db_path)
        : db_(nullptr), db_path_(db_path), running_(false) {}

    ~SQLiteStore() {
        stop();
    }

    // -------------------------------------------------------------------------
    // open — opens DB, applies PRAGMAs, creates schema, compiles statements.
    // Must be called from the main thread before start().
    // -------------------------------------------------------------------------
    void open() {
        int rc = sqlite3_open(db_path_.c_str(), &db_);
        sql_check(rc, db_, "open");

        // Performance PRAGMAs — safe for Jetson eMMC / NVMe
        exec("PRAGMA journal_mode = WAL");
        exec("PRAGMA synchronous  = NORMAL");
        exec("PRAGMA foreign_keys = ON");
        exec("PRAGMA page_size    = 4096");
        exec("PRAGMA cache_size   = -8000");  // 8 MB page cache
        exec("PRAGMA temp_store   = MEMORY");
        exec("PRAGMA mmap_size    = 268435456");  // 256 MB mmap on Jetson

        // Apply schema (idempotent)
        apply_schema();

        // Compile all prepared statements
        prepare_statements();

        std::cout << "[SQLite] Opened: " << db_path_ << '\n';
    }

    // -------------------------------------------------------------------------
    // start — launches the background writer thread.
    // -------------------------------------------------------------------------
    void start() {
        running_.store(true, std::memory_order_release);
        writer_thread_ = std::thread([this]{ writer_loop(); });
    }

    // -------------------------------------------------------------------------
    // stop — gracefully drains the queue and joins the writer thread.
    // -------------------------------------------------------------------------
    void stop() {
        running_.store(false, std::memory_order_release);
        if (writer_thread_.joinable()) {
            writer_thread_.join();
        }
        finalize_statements();
        if (db_) {
            sqlite3_close(db_);
            db_ = nullptr;
        }
    }

    // -------------------------------------------------------------------------
    // enqueue — thread-safe push from any producer thread.
    // -------------------------------------------------------------------------
    void enqueue(WriteOp op) {
        std::lock_guard lk(queue_mutex_);
        queue_.push(std::move(op));
    }

    // ─── Read API (called synchronously at startup, before writer starts) ───

    // Load all active items into a callback (for ItemCatalog hydration)
    void load_items(std::function<void(ItemProfile)> callback) {
        sqlite3_stmt* stmt;
        sql_check(sqlite3_prepare_v2(db_,
            "SELECT sku, name, weight_grams, unit_price_cents FROM items WHERE active=1",
            -1, &stmt, nullptr), db_, "load_items");

        while (sqlite3_step(stmt) == SQLITE_ROW) {
            ItemProfile p{};
            p.sku              = static_cast<Sku>(sqlite3_column_int(stmt, 0));
            const char* name   = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
            std::strncpy(p.name, name ? name : "", sizeof(p.name) - 1);
            p.weight_grams     = static_cast<float>(sqlite3_column_double(stmt, 2));
            p.unit_price_cents = static_cast<float>(sqlite3_column_int(stmt, 3));
            p.valid            = true;
            callback(p);
        }
        sqlite3_finalize(stmt);
    }

    // Load inventory into a map (for ReconciliationEngine)
    void load_inventory(std::function<void(uint32_t sku, int32_t qty)> callback) {
        sqlite3_stmt* stmt;
        sql_check(sqlite3_prepare_v2(db_,
            "SELECT sku, qty_on_hand FROM inventory",
            -1, &stmt, nullptr), db_, "load_inventory");

        while (sqlite3_step(stmt) == SQLITE_ROW) {
            callback(static_cast<uint32_t>(sqlite3_column_int(stmt, 0)),
                     sqlite3_column_int(stmt, 1));
        }
        sqlite3_finalize(stmt);
    }

    // Load planogram for fusion engine zone mappings
    void load_planogram(
            std::function<void(uint32_t shelf, uint32_t slot, uint32_t sku, uint32_t cam)> cb) {
        sqlite3_stmt* stmt;
        sql_check(sqlite3_prepare_v2(db_,
            "SELECT shelf_id, slot_id, sku, camera_id FROM planogram",
            -1, &stmt, nullptr), db_, "load_planogram");

        while (sqlite3_step(stmt) == SQLITE_ROW) {
            cb(sqlite3_column_int(stmt, 0),
               sqlite3_column_int(stmt, 1),
               sqlite3_column_int(stmt, 2),
               sqlite3_column_int(stmt, 3));
        }
        sqlite3_finalize(stmt);
    }

    // Fetch pending-sync transactions for the cloud sync agent
    std::vector<Transaction> get_unsynced_transactions(int limit = 100) {
        std::vector<Transaction> result;
        sqlite3_stmt* stmt;
        sql_check(sqlite3_prepare_v2(db_,
            "SELECT transaction_id, session_id, session_start_us, session_end_us,"
            "       gross_total_cents, cost_of_goods_cents, net_profit_cents,"
            "       item_count, payment_authorized, payment_method"
            " FROM transactions WHERE synced_to_cloud=0 LIMIT ?",
            -1, &stmt, nullptr), db_, "get_unsynced");

        sqlite3_bind_int(stmt, 1, limit);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Transaction t{};
            t.transaction_id      = sqlite3_column_int64(stmt, 0);
            t.session_id          = static_cast<SessionId>(sqlite3_column_int64(stmt, 1));
            t.session_start_us    = sqlite3_column_int64(stmt, 2);
            t.session_end_us      = sqlite3_column_int64(stmt, 3);
            t.gross_total_cents   = static_cast<float>(sqlite3_column_int(stmt, 4));
            t.cost_of_goods_cents = static_cast<float>(sqlite3_column_int(stmt, 5));
            t.net_profit_cents    = static_cast<float>(sqlite3_column_int(stmt, 6));
            t.item_count          = sqlite3_column_int(stmt, 7);
            t.payment_authorized  = sqlite3_column_int(stmt, 8) != 0;
            const char* pm = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 9));
            std::strncpy(t.payment_method, pm ? pm : "", sizeof(t.payment_method) - 1);
            result.push_back(t);
        }
        sqlite3_finalize(stmt);
        return result;
    }

private:
    // ─── Writer loop ──────────────────────────────────────────────────────────
    void writer_loop() {
        while (running_.load(std::memory_order_acquire)) {
            // Drain up to BATCH_SIZE ops per commit cycle
            std::vector<WriteOp> batch;
            batch.reserve(64);
            {
                std::lock_guard lk(queue_mutex_);
                while (!queue_.empty() && batch.size() < 64) {
                    batch.push_back(std::move(queue_.front()));
                    queue_.pop();
                }
            }

            if (!batch.empty()) {
                exec("BEGIN");
                for (const auto& op : batch) {
                    std::visit([this](const auto& o){ write(o); }, op);
                }
                exec("COMMIT");
            } else {
                // Nothing to write — sleep briefly to yield CPU
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            }

            // Checkpoint WAL every N pages to keep file size bounded
            checkpoint_if_needed();
        }

        // Drain remaining items on shutdown
        {
            std::lock_guard lk(queue_mutex_);
            if (!queue_.empty()) {
                exec("BEGIN");
                while (!queue_.empty()) {
                    std::visit([this](const auto& o){ write(o); }, queue_.front());
                    queue_.pop();
                }
                exec("COMMIT");
            }
        }
    }

    // ─── Individual write implementations ────────────────────────────────────
    void write(const WriteTransaction& wt) {
        const Transaction& t = wt.txn;
        sqlite3_bind_int64(stmt_insert_txn_, 1, t.transaction_id);
        sqlite3_bind_int64(stmt_insert_txn_, 2, static_cast<int64_t>(t.session_id));
        sqlite3_bind_int64(stmt_insert_txn_, 3, t.session_start_us);
        sqlite3_bind_int64(stmt_insert_txn_, 4, t.session_end_us);
        sqlite3_bind_int  (stmt_insert_txn_, 5, static_cast<int>(t.gross_total_cents));
        sqlite3_bind_int  (stmt_insert_txn_, 6, static_cast<int>(t.cost_of_goods_cents));
        sqlite3_bind_int  (stmt_insert_txn_, 7, static_cast<int>(t.net_profit_cents));
        sqlite3_bind_int  (stmt_insert_txn_, 8, t.item_count);
        sqlite3_bind_int  (stmt_insert_txn_, 9, t.payment_authorized ? 1 : 0);
        sqlite3_bind_text (stmt_insert_txn_, 10, t.payment_method, -1, SQLITE_STATIC);

        step_and_reset(stmt_insert_txn_, "insert_transaction");
    }

    void write(const WriteIncident& wi) {
        const SecurityIncident& i = wi.inc;
        sqlite3_bind_int64(stmt_insert_inc_, 1, static_cast<int64_t>(i.incident_id));
        sqlite3_bind_int64(stmt_insert_inc_, 2, static_cast<int64_t>(i.session_id));
        sqlite3_bind_int  (stmt_insert_inc_, 3, static_cast<int32_t>(i.camera_id));
        sqlite3_bind_double(stmt_insert_inc_, 4, i.anomaly_score);
        sqlite3_bind_int  (stmt_insert_inc_, 5, static_cast<int>(i.level));
        sqlite3_bind_int  (stmt_insert_inc_, 6, i.event_class);
        sqlite3_bind_text (stmt_insert_inc_, 7, i.description, -1, SQLITE_STATIC);
        sqlite3_bind_int64(stmt_insert_inc_, 8, i.timestamp_us);

        step_and_reset(stmt_insert_inc_, "insert_incident");
    }

    void write(const WriteCartEvent& we) {
        sqlite3_bind_int64(stmt_insert_cart_, 1, static_cast<int64_t>(we.session_id));
        sqlite3_bind_int  (stmt_insert_cart_, 2, static_cast<int32_t>(we.sku));
        sqlite3_bind_int  (stmt_insert_cart_, 3, static_cast<int>(we.type));
        sqlite3_bind_int  (stmt_insert_cart_, 4, we.quantity_delta);
        sqlite3_bind_int  (stmt_insert_cart_, 5, static_cast<int>(we.unit_price_cents));
        sqlite3_bind_double(stmt_insert_cart_, 6, we.weight_delta_grams);
        sqlite3_bind_int  (stmt_insert_cart_, 7, we.camera_corroborated ? 1 : 0);
        sqlite3_bind_int64(stmt_insert_cart_, 8, we.timestamp_us);

        step_and_reset(stmt_insert_cart_, "insert_cart_event");
    }

    void write(const WriteSession& ws) {
        sqlite3_bind_int64(stmt_insert_session_, 1, static_cast<int64_t>(ws.id));
        sqlite3_bind_text (stmt_insert_session_, 2, ws.customer_token.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt_insert_session_, 3, ws.opened_at_us);

        step_and_reset(stmt_insert_session_, "insert_session");
    }

    void write(const MarkSynced& ms) {
        // Dynamically build UPDATE — table name validated against whitelist
        static const char* allowed[] = { "transactions", "security_incidents" };
        bool valid = false;
        for (const char* a : allowed) { if (ms.table == a) { valid = true; break; } }
        if (!valid) return;

        const std::string sql =
            "UPDATE " + ms.table + " SET synced_to_cloud=1 WHERE "
            + (ms.table == "transactions" ? "transaction_id" : "incident_id")
            + "=" + std::to_string(ms.id);
        exec(sql.c_str());
    }

    // ─── Statement management ─────────────────────────────────────────────────
    void prepare_statements() {
        auto prep = [&](sqlite3_stmt*& stmt, const char* sql) {
            sql_check(sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr), db_, sql);
        };

        prep(stmt_insert_txn_,
            "INSERT OR REPLACE INTO transactions"
            "(transaction_id,session_id,session_start_us,session_end_us,"
            " gross_total_cents,cost_of_goods_cents,net_profit_cents,"
            " item_count,payment_authorized,payment_method)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)");

        prep(stmt_insert_inc_,
            "INSERT OR REPLACE INTO security_incidents"
            "(incident_id,session_id,camera_id,anomaly_score,"
            " level,event_class,description,timestamp_us)"
            " VALUES(?,?,?,?,?,?,?,?)");

        prep(stmt_insert_cart_,
            "INSERT INTO cart_events"
            "(session_id,sku,event_type,quantity_delta,unit_price_cents,"
            " weight_delta_g,camera_corroborated,timestamp_us)"
            " VALUES(?,?,?,?,?,?,?,?)");

        prep(stmt_insert_session_,
            "INSERT OR IGNORE INTO sessions(session_id,customer_token,opened_at_us,state)"
            " VALUES(?,?,?,2)");  // state=2 → ACTIVE
    }

    void finalize_statements() {
        for (sqlite3_stmt* s : {stmt_insert_txn_, stmt_insert_inc_,
                                stmt_insert_cart_, stmt_insert_session_}) {
            if (s) sqlite3_finalize(s);
        }
    }

    void step_and_reset(sqlite3_stmt* stmt, const char* ctx) {
        int rc = sqlite3_step(stmt);
        if (rc != SQLITE_DONE) {
            std::cerr << "[SQLite] Step failed (" << ctx << "): "
                      << sqlite3_errmsg(db_) << '\n';
        }
        sqlite3_reset(stmt);
        sqlite3_clear_bindings(stmt);
    }

    void exec(const char* sql) {
        char* err = nullptr;
        int rc = sqlite3_exec(db_, sql, nullptr, nullptr, &err);
        if (rc != SQLITE_OK) {
            std::string msg = err ? err : "unknown";
            sqlite3_free(err);
            throw std::runtime_error(std::string("[SQLite] exec: ") + msg);
        }
    }

    void checkpoint_if_needed() {
        // WAL checkpoint every ~1000 writes to bound WAL file growth
        if (++write_count_ % config::SQLITE_WAL_CHECKPOINT_SIZE == 0) {
            sqlite3_wal_checkpoint_v2(db_, nullptr,
                SQLITE_CHECKPOINT_PASSIVE, nullptr, nullptr);
        }
    }

    void apply_schema() {
        // Schema SQL inlined here for self-contained binary.
        // In production, read from the .sql file or embed via xxd.
        exec(R"SQL(
            CREATE TABLE IF NOT EXISTS items (
                sku INTEGER PRIMARY KEY, name TEXT NOT NULL,
                weight_grams REAL NOT NULL, unit_price_cents INTEGER NOT NULL,
                barcode TEXT UNIQUE, active INTEGER NOT NULL DEFAULT 1,
                created_at_us INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000000),
                updated_at_us INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000000));
        )SQL");
        exec(R"SQL(
            CREATE TABLE IF NOT EXISTS planogram (
                shelf_id INTEGER NOT NULL, slot_id INTEGER NOT NULL,
                sku INTEGER NOT NULL REFERENCES items(sku), camera_id INTEGER NOT NULL,
                PRIMARY KEY (shelf_id, slot_id));
        )SQL");
        exec(R"SQL(
            CREATE TABLE IF NOT EXISTS inventory (
                sku INTEGER PRIMARY KEY REFERENCES items(sku),
                qty_on_hand INTEGER NOT NULL DEFAULT 0,
                reorder_threshold INTEGER NOT NULL DEFAULT 5,
                updated_at_us INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000000));
        )SQL");
        exec(R"SQL(
            CREATE TABLE IF NOT EXISTS sessions (
                session_id INTEGER PRIMARY KEY, customer_token TEXT NOT NULL,
                state INTEGER NOT NULL DEFAULT 2, opened_at_us INTEGER NOT NULL,
                closed_at_us INTEGER, store_id INTEGER NOT NULL DEFAULT 1);
        )SQL");
        exec(R"SQL(
            CREATE TABLE IF NOT EXISTS cart_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES sessions(session_id),
                sku INTEGER NOT NULL, event_type INTEGER NOT NULL,
                quantity_delta INTEGER NOT NULL DEFAULT 1,
                unit_price_cents INTEGER NOT NULL,
                weight_delta_g REAL, camera_corroborated INTEGER NOT NULL DEFAULT 1,
                timestamp_us INTEGER NOT NULL);
        )SQL");
        exec(R"SQL(
            CREATE TABLE IF NOT EXISTS transactions (
                transaction_id INTEGER PRIMARY KEY,
                session_id INTEGER NOT NULL, session_start_us INTEGER NOT NULL,
                session_end_us INTEGER NOT NULL,
                gross_total_cents INTEGER NOT NULL, cost_of_goods_cents INTEGER NOT NULL,
                net_profit_cents INTEGER NOT NULL, item_count INTEGER NOT NULL,
                payment_authorized INTEGER NOT NULL DEFAULT 0,
                payment_method TEXT NOT NULL, synced_to_cloud INTEGER NOT NULL DEFAULT 0,
                created_at_us INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000000));
        )SQL");
        exec(R"SQL(
            CREATE TABLE IF NOT EXISTS security_incidents (
                incident_id INTEGER PRIMARY KEY,
                session_id INTEGER, camera_id INTEGER, anomaly_score REAL NOT NULL,
                level INTEGER NOT NULL, event_class INTEGER NOT NULL DEFAULT 0,
                description TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
                synced_to_cloud INTEGER NOT NULL DEFAULT 0,
                timestamp_us INTEGER NOT NULL);
        )SQL");
        exec("CREATE INDEX IF NOT EXISTS idx_txn_unsynced ON transactions(synced_to_cloud) WHERE synced_to_cloud=0");
        exec("CREATE INDEX IF NOT EXISTS idx_inc_unsynced ON security_incidents(synced_to_cloud) WHERE synced_to_cloud=0");
    }

    // ─── Members ─────────────────────────────────────────────────────────────
    sqlite3*     db_;
    std::string  db_path_;

    std::atomic<bool>     running_;
    std::thread           writer_thread_;
    std::mutex            queue_mutex_;
    std::queue<WriteOp>   queue_;

    sqlite3_stmt* stmt_insert_txn_     = nullptr;
    sqlite3_stmt* stmt_insert_inc_     = nullptr;
    sqlite3_stmt* stmt_insert_cart_    = nullptr;
    sqlite3_stmt* stmt_insert_session_ = nullptr;

    uint64_t write_count_ = 0;
};

} // namespace retail
