-- ============================================================================
-- cloud_schema.sql
-- Autonomous Retail Infrastructure — PostgreSQL Cloud Database Schema
--
-- Target: PostgreSQL 15+ with TimescaleDB extension (optional but recommended
-- for the time-series event tables). Runs on cloud VM or managed RDS instance.
--
-- Design principles:
--   - Multi-store: every table includes store_id for horizontal isolation
--   - Partitioned tables (transactions, cart_events) by month for performance
--   - JSONB columns for flexible event metadata without schema migrations
--   - Row-level security policies for owner dashboard access control
--   - Indices tuned for the React dashboard's query patterns
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";        -- UUID generation
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- Query performance monitoring
-- CREATE EXTENSION IF NOT EXISTS timescaledb;      -- Uncomment if TimescaleDB installed

-- ============================================================================
-- STORES: Multi-store registry
-- ============================================================================
CREATE TABLE IF NOT EXISTS stores (
    store_id         SERIAL PRIMARY KEY,
    name             TEXT    NOT NULL,
    address          TEXT,
    timezone         TEXT    NOT NULL DEFAULT 'UTC',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active           BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================================================
-- ITEMS: Global product catalog (source of truth, synced to edge SQLite)
-- ============================================================================
CREATE TABLE IF NOT EXISTS items (
    sku              INTEGER PRIMARY KEY,
    name             TEXT    NOT NULL,
    weight_grams     REAL    NOT NULL CHECK (weight_grams > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    barcode          TEXT    UNIQUE,
    category         TEXT,
    supplier         TEXT,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_barcode   ON items(barcode);
CREATE INDEX IF NOT EXISTS idx_items_category  ON items(category) WHERE active;

-- ============================================================================
-- INVENTORY: Stock levels per store per SKU
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory (
    store_id          INTEGER NOT NULL REFERENCES stores(store_id),
    sku               INTEGER NOT NULL REFERENCES items(sku),
    qty_on_hand       INTEGER NOT NULL DEFAULT 0,
    qty_reserved      INTEGER NOT NULL DEFAULT 0,
    reorder_threshold INTEGER NOT NULL DEFAULT 5,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (store_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_inventory_low
    ON inventory(store_id, qty_on_hand)
    WHERE qty_on_hand < 5;

-- ============================================================================
-- SESSIONS: Customer session records (replicated from edge)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    session_id        BIGINT  NOT NULL,           -- Matches edge SessionId (uint64)
    store_id          INTEGER NOT NULL REFERENCES stores(store_id),
    customer_token    TEXT    NOT NULL,           -- SHA-256 hashed at edge
    state             SMALLINT NOT NULL DEFAULT 2,
    opened_at         TIMESTAMPTZ NOT NULL,
    closed_at         TIMESTAMPTZ,
    duration_seconds  INTEGER GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (closed_at - opened_at))::INTEGER
    ) STORED,
    PRIMARY KEY (session_id, store_id)
) PARTITION BY RANGE (opened_at);

-- Monthly partitions (auto-created by a scheduled cron or pg_partman)
CREATE TABLE IF NOT EXISTS sessions_2025_01
    PARTITION OF sessions FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE IF NOT EXISTS sessions_2025_06
    PARTITION OF sessions FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
-- Additional partitions managed by pg_partman in production

CREATE INDEX IF NOT EXISTS idx_sessions_store_date
    ON sessions(store_id, opened_at);

-- ============================================================================
-- TRANSACTIONS: Finalized checkout records (replicated from edge)
-- Partitioned by month for efficient date-range queries from the dashboard.
-- ============================================================================
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id      BIGINT       NOT NULL,
    store_id            INTEGER      NOT NULL REFERENCES stores(store_id),
    session_id          BIGINT       NOT NULL,
    session_start       TIMESTAMPTZ  NOT NULL,
    session_end         TIMESTAMPTZ  NOT NULL,
    gross_total_cents   INTEGER      NOT NULL CHECK (gross_total_cents >= 0),
    cost_of_goods_cents INTEGER      NOT NULL,
    net_profit_cents    INTEGER      NOT NULL,
    item_count          INTEGER      NOT NULL CHECK (item_count >= 0),
    payment_authorized  BOOLEAN      NOT NULL DEFAULT FALSE,
    payment_method      TEXT         NOT NULL,
    synced_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (transaction_id, store_id, session_end)
) PARTITION BY RANGE (session_end);

CREATE TABLE IF NOT EXISTS transactions_2025_01
    PARTITION OF transactions FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE IF NOT EXISTS transactions_2025_06
    PARTITION OF transactions FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

-- Dashboard query: daily revenue chart
CREATE INDEX IF NOT EXISTS idx_txn_store_date
    ON transactions(store_id, session_end)
    WHERE payment_authorized;

-- Dashboard query: recent transactions list
CREATE INDEX IF NOT EXISTS idx_txn_store_recent
    ON transactions(store_id, synced_at DESC);

-- ============================================================================
-- SECURITY_INCIDENTS: Anomaly event log (replicated from edge)
-- ============================================================================
CREATE TABLE IF NOT EXISTS security_incidents (
    incident_id      BIGINT   NOT NULL,
    store_id         INTEGER  NOT NULL REFERENCES stores(store_id),
    session_id       BIGINT,
    camera_id        INTEGER,
    anomaly_score    REAL     NOT NULL CHECK (anomaly_score BETWEEN 0 AND 1),
    level            SMALLINT NOT NULL DEFAULT 0, -- 0=INFO,1=WARNING,2=CRITICAL
    event_class      SMALLINT NOT NULL DEFAULT 0,
    description      TEXT     NOT NULL,
    resolved         BOOLEAN  NOT NULL DEFAULT FALSE,
    resolved_by      TEXT,                        -- Operator ID
    resolved_at      TIMESTAMPTZ,
    occurred_at      TIMESTAMPTZ NOT NULL,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata         JSONB,                       -- Camera frame path, bbox, etc.
    PRIMARY KEY (incident_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_incidents_critical
    ON security_incidents(store_id, occurred_at DESC)
    WHERE level = 2 AND resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_incidents_unresolved
    ON security_incidents(store_id, level, resolved)
    WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_incidents_session
    ON security_incidents(session_id);

-- ============================================================================
-- CART_EVENTS: Immutable audit log replicated from edge
-- ============================================================================
CREATE TABLE IF NOT EXISTS cart_events (
    event_id             BIGINT      NOT NULL,
    store_id             INTEGER     NOT NULL REFERENCES stores(store_id),
    session_id           BIGINT      NOT NULL,
    sku                  INTEGER     NOT NULL REFERENCES items(sku),
    event_type           SMALLINT    NOT NULL,
    quantity_delta       INTEGER     NOT NULL,
    unit_price_cents     INTEGER     NOT NULL,
    weight_delta_g       REAL,
    camera_corroborated  BOOLEAN     NOT NULL DEFAULT TRUE,
    occurred_at          TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (event_id, store_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS cart_events_2025_06
    PARTITION OF cart_events FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

-- ============================================================================
-- MATERIALIZED VIEWS: Pre-aggregated for dashboard query performance
-- Refreshed every 5 minutes by a pg_cron job.
-- ============================================================================

-- Daily revenue + profit by store (powers the main profit chart)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_revenue AS
    SELECT
        store_id,
        DATE_TRUNC('day', session_end AT TIME ZONE 'UTC') AS day,
        COUNT(*)                            AS transaction_count,
        SUM(gross_total_cents)              AS gross_cents,
        SUM(net_profit_cents)               AS profit_cents,
        SUM(cost_of_goods_cents)            AS cogs_cents,
        AVG(gross_total_cents)              AS avg_basket_cents,
        SUM(item_count)                     AS total_items_sold
    FROM transactions
    WHERE payment_authorized = TRUE
    GROUP BY store_id, day
    ORDER BY store_id, day DESC
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_revenue_pk
    ON mv_daily_revenue(store_id, day);

-- Hourly transaction volume (powers the intraday heatmap widget)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_volume AS
    SELECT
        store_id,
        DATE_TRUNC('hour', session_end AT TIME ZONE 'UTC') AS hour,
        COUNT(*) AS transaction_count,
        SUM(gross_total_cents) AS gross_cents
    FROM transactions
    WHERE payment_authorized = TRUE
      AND session_end >= NOW() - INTERVAL '7 days'
    GROUP BY store_id, hour
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_hourly_pk
    ON mv_hourly_volume(store_id, hour);

-- Top-selling items by store
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_items AS
    SELECT
        ce.store_id,
        ce.sku,
        i.name,
        i.unit_price_cents,
        SUM(ce.quantity_delta) FILTER (WHERE ce.quantity_delta > 0) AS units_sold,
        SUM(ce.quantity_delta * ce.unit_price_cents)
            FILTER (WHERE ce.quantity_delta > 0)                    AS revenue_cents
    FROM cart_events ce
    JOIN items i ON i.sku = ce.sku
    WHERE ce.occurred_at >= NOW() - INTERVAL '30 days'
    GROUP BY ce.store_id, ce.sku, i.name, i.unit_price_cents
WITH NO DATA;

CREATE INDEX IF NOT EXISTS idx_mv_top_items_store
    ON mv_top_items(store_id, revenue_cents DESC);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Auto-update updated_at on items table
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_items_updated
    BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Refresh materialized views (called by pg_cron every 5 minutes)
CREATE OR REPLACE FUNCTION fn_refresh_dashboard_views()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_revenue;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_volume;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_items;
END;
$$;

-- ============================================================================
-- ROW-LEVEL SECURITY: Owners can only see their own store's data
-- ============================================================================
ALTER TABLE transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;

-- Policy: app role sees only rows matching their store_id claim
CREATE POLICY store_isolation_txn ON transactions
    USING (store_id = current_setting('app.store_id')::INTEGER);

CREATE POLICY store_isolation_inc ON security_incidents
    USING (store_id = current_setting('app.store_id')::INTEGER);

CREATE POLICY store_isolation_ses ON sessions
    USING (store_id = current_setting('app.store_id')::INTEGER);

-- ============================================================================
-- SEED: Default store record
-- ============================================================================
INSERT INTO stores (name, address, timezone) VALUES
    ('Store #1 — Flagship', '123 Main St', 'America/Los_Angeles')
ON CONFLICT DO NOTHING;
