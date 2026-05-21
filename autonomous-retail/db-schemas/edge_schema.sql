-- ============================================================================
-- edge_schema.sql
-- Autonomous Retail Infrastructure — SQLite Edge Database Schema
--
-- Target: SQLite 3.35+ in WAL (Write-Ahead Log) mode.
-- Opened with: PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
--
-- Design principles:
--   - All timestamps stored as INTEGER microseconds since Unix epoch
--   - Monetary values stored as INTEGER cents (no floating-point precision loss)
--   - Enum values stored as INTEGER (matches C++ enum class backing type)
--   - Every table has a monotonic rowid alias for efficient range scans
--   - Indices are minimal — only what the sync agent and fusion engine query
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA page_size    = 4096;   -- Matches typical SSD/eMMC sector size on Jetson

-- ============================================================================
-- CATALOG: Item definitions and weight profiles
-- Loaded into the in-memory ItemCatalog<> at startup. Writes are infrequent
-- (planogram changes), reads are never from SQLite on the hot path.
-- ============================================================================
CREATE TABLE IF NOT EXISTS items (
    sku              INTEGER PRIMARY KEY,          -- Maps to retail::Sku
    name             TEXT    NOT NULL,
    weight_grams     REAL    NOT NULL,
    unit_price_cents INTEGER NOT NULL,             -- Stored as integer cents
    barcode          TEXT    UNIQUE,
    active           INTEGER NOT NULL DEFAULT 1,  -- 0 = discontinued
    created_at_us    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000000),
    updated_at_us    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000000)
);

CREATE INDEX IF NOT EXISTS idx_items_active ON items(active);

-- ============================================================================
-- PLANOGRAM: Maps (shelf, slot) pairs to SKUs and camera zones
-- ============================================================================
CREATE TABLE IF NOT EXISTS planogram (
    shelf_id     INTEGER NOT NULL,
    slot_id      INTEGER NOT NULL,
    sku          INTEGER NOT NULL REFERENCES items(sku),
    camera_id    INTEGER NOT NULL,
    zone_label   TEXT,                            -- Human-readable, e.g. "aisle-2-left"
    updated_at_us INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000000),
    PRIMARY KEY (shelf_id, slot_id)
);

-- ============================================================================
-- INVENTORY: Live stock counts per SKU
-- Decremented on checkout, incremented on restock events.
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory (
    sku              INTEGER PRIMARY KEY REFERENCES items(sku),
    qty_on_hand      INTEGER NOT NULL DEFAULT 0,
    qty_reserved     INTEGER NOT NULL DEFAULT 0,   -- Held in active carts
    reorder_threshold INTEGER NOT NULL DEFAULT 5,
    updated_at_us    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000000)
);

CREATE INDEX IF NOT EXISTS idx_inventory_low_stock
    ON inventory(qty_on_hand) WHERE qty_on_hand < 5;

-- ============================================================================
-- SESSIONS: Customer session lifecycle
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    session_id       INTEGER PRIMARY KEY,          -- Maps to retail::SessionId
    customer_token   TEXT    NOT NULL,             -- Hashed biometric / card token
    state            INTEGER NOT NULL DEFAULT 1,   -- SessionState enum
    opened_at_us     INTEGER NOT NULL,
    closed_at_us     INTEGER,
    store_id         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_sessions_state   ON sessions(state);
CREATE INDEX IF NOT EXISTS idx_sessions_opened  ON sessions(opened_at_us);

-- ============================================================================
-- CART_EVENTS: Immutable append-only log of every cart mutation.
-- The virtual invoice is derived from this log, never mutated in place.
-- This is the audit trail for dispute resolution.
-- ============================================================================
CREATE TABLE IF NOT EXISTS cart_events (
    event_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       INTEGER NOT NULL REFERENCES sessions(session_id),
    sku              INTEGER NOT NULL REFERENCES items(sku),
    event_type       INTEGER NOT NULL,             -- CartEventType enum
    quantity_delta   INTEGER NOT NULL DEFAULT 1,   -- +1 added, -1 returned
    unit_price_cents INTEGER NOT NULL,
    weight_delta_g   REAL,                         -- Raw weight delta that triggered event
    camera_corroborated INTEGER NOT NULL DEFAULT 1,-- 0 = fusion timed out (flagged)
    timestamp_us     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cart_events_session
    ON cart_events(session_id, timestamp_us);

-- ============================================================================
-- TRANSACTIONS: One record per completed checkout
-- ============================================================================
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id      INTEGER PRIMARY KEY,
    session_id          INTEGER NOT NULL REFERENCES sessions(session_id),
    session_start_us    INTEGER NOT NULL,
    session_end_us      INTEGER NOT NULL,
    gross_total_cents   INTEGER NOT NULL,
    cost_of_goods_cents INTEGER NOT NULL,
    net_profit_cents    INTEGER NOT NULL,
    item_count          INTEGER NOT NULL,
    payment_authorized  INTEGER NOT NULL DEFAULT 0,  -- 0/1 boolean
    payment_method      TEXT    NOT NULL,
    synced_to_cloud     INTEGER NOT NULL DEFAULT 0,  -- 0 = pending sync
    created_at_us       INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000000)
);

CREATE INDEX IF NOT EXISTS idx_transactions_unsynced
    ON transactions(synced_to_cloud) WHERE synced_to_cloud = 0;

CREATE INDEX IF NOT EXISTS idx_transactions_date
    ON transactions(created_at_us);

-- ============================================================================
-- SECURITY_INCIDENTS: Every anomaly event from the fusion engine
-- ============================================================================
CREATE TABLE IF NOT EXISTS security_incidents (
    incident_id      INTEGER PRIMARY KEY,
    session_id       INTEGER REFERENCES sessions(session_id),
    camera_id        INTEGER,
    anomaly_score    REAL    NOT NULL,
    level            INTEGER NOT NULL,             -- SecurityLevel enum (0=INFO,1=WARN,2=CRIT)
    event_class      INTEGER NOT NULL DEFAULT 0,   -- 0=normal,1=conceal,2=bypass,3=loiter
    description      TEXT    NOT NULL,
    resolved         INTEGER NOT NULL DEFAULT 0,   -- 0 = open, 1 = resolved
    resolved_at_us   INTEGER,
    synced_to_cloud  INTEGER NOT NULL DEFAULT 0,
    timestamp_us     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_critical
    ON security_incidents(level) WHERE level = 2;

CREATE INDEX IF NOT EXISTS idx_incidents_unsynced
    ON security_incidents(synced_to_cloud) WHERE synced_to_cloud = 0;

CREATE INDEX IF NOT EXISTS idx_incidents_session
    ON security_incidents(session_id, timestamp_us);

-- ============================================================================
-- CLOUD_SYNC_LOG: Tracks what has been successfully replicated upstream
-- ============================================================================
CREATE TABLE IF NOT EXISTS cloud_sync_log (
    sync_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type      TEXT    NOT NULL,             -- 'transaction' | 'incident' | 'inventory'
    entity_id        INTEGER NOT NULL,
    synced_at_us     INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000000),
    status           TEXT    NOT NULL DEFAULT 'SUCCESS',
    error_message    TEXT
);

-- ============================================================================
-- TRIGGERS: Maintain updated_at automatically
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trg_items_updated
    AFTER UPDATE ON items
    BEGIN
        UPDATE items SET updated_at_us = strftime('%s','now') * 1000000
        WHERE sku = NEW.sku;
    END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_updated
    AFTER UPDATE ON inventory
    BEGIN
        UPDATE inventory SET updated_at_us = strftime('%s','now') * 1000000
        WHERE sku = NEW.sku;
    END;

-- ============================================================================
-- VIEWS: Pre-built queries used by the C++ engine and sync agent
-- ============================================================================

-- Current cart for a session (derived from event log)
CREATE VIEW IF NOT EXISTS v_session_cart AS
    SELECT
        ce.session_id,
        ce.sku,
        i.name,
        i.unit_price_cents,
        SUM(ce.quantity_delta) AS quantity,
        SUM(ce.quantity_delta * ce.unit_price_cents) AS line_total_cents
    FROM cart_events ce
    JOIN items i ON i.sku = ce.sku
    GROUP BY ce.session_id, ce.sku
    HAVING quantity > 0;

-- Pending sync queue
CREATE VIEW IF NOT EXISTS v_pending_sync_transactions AS
    SELECT * FROM transactions WHERE synced_to_cloud = 0;

CREATE VIEW IF NOT EXISTS v_pending_sync_incidents AS
    SELECT * FROM security_incidents WHERE synced_to_cloud = 0;

-- Daily profit summary
CREATE VIEW IF NOT EXISTS v_daily_summary AS
    SELECT
        DATE(created_at_us / 1000000, 'unixepoch') AS date,
        COUNT(*)                                    AS transaction_count,
        SUM(gross_total_cents)                      AS gross_cents,
        SUM(net_profit_cents)                       AS profit_cents,
        SUM(cost_of_goods_cents)                    AS cogs_cents,
        AVG(gross_total_cents)                      AS avg_basket_cents
    FROM transactions
    WHERE payment_authorized = 1
    GROUP BY date
    ORDER BY date DESC;
