// cloud-api/server.js
// Autonomous Retail Infrastructure — Cloud API Server
//
// Responsibilities:
//   1. Accept WebSocket connections from edge nodes (one per store)
//   2. Relay telemetry/security events to owner dashboard clients
//   3. Expose REST endpoints queried by the React dashboard
//   4. Persist received transactions/incidents to PostgreSQL
//   5. Serve the materialized view data for profit charts
//
// Stack: Node.js 20 LTS, Express 4, ws, pg (node-postgres)
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const express   = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { Pool }  = require("pg");
const http      = require("http");
const cors      = require("cors");

// ─── Configuration ────────────────────────────────────────────────────────────
const PORT      = parseInt(process.env.PORT      ?? "3001");
const PG_URL    = process.env.DATABASE_URL       ?? "postgresql://localhost/retail";
const EDGE_SECRET = process.env.EDGE_SECRET      ?? "dev-secret-change-in-prod";
const STORE_ID  = parseInt(process.env.STORE_ID  ?? "1");

// ─── PostgreSQL connection pool ───────────────────────────────────────────────
const pool = new Pool({
  connectionString: PG_URL,
  max:              20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[PG] Idle client error:", err.message);
});

// ─── Express app ─────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.use(cors({
  origin: process.env.DASHBOARD_ORIGIN ?? "*",
  methods: ["GET", "POST", "PATCH"],
}));
app.use(express.json({ limit: "1mb" }));

// Set store_id for row-level security on every request
app.use(async (req, res, next) => {
  req.pgClient = await pool.connect();
  try {
    await req.pgClient.query(`SET app.store_id = $1`, [STORE_ID]);
    next();
  } catch (err) {
    req.pgClient.release();
    next(err);
  }
});

// Release connection after each request
app.use((req, res, next) => {
  res.on("finish", () => req.pgClient?.release());
  next();
});

// ─── REST Routes ─────────────────────────────────────────────────────────────

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", store_id: STORE_ID, ts: Date.now() });
});

// Daily revenue summary (powers main profit chart)
app.get("/api/revenue/daily", async (req, res) => {
  const { days = 30 } = req.query;
  try {
    const { rows } = await req.pgClient.query(`
      SELECT
        day::TEXT,
        transaction_count,
        gross_cents,
        profit_cents,
        cogs_cents,
        avg_basket_cents,
        total_items_sold
      FROM mv_daily_revenue
      WHERE store_id = $1
        AND day >= NOW() - ($2 || ' days')::INTERVAL
      ORDER BY day ASC
      LIMIT 365
    `, [STORE_ID, parseInt(days)]);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error("[API] /revenue/daily:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Intraday hourly volume (last 7 days)
app.get("/api/revenue/hourly", async (req, res) => {
  try {
    const { rows } = await req.pgClient.query(`
      SELECT hour::TEXT, transaction_count, gross_cents
      FROM mv_hourly_volume
      WHERE store_id = $1
      ORDER BY hour DESC
      LIMIT 168
    `, [STORE_ID]);
    res.json({ ok: true, data: rows.reverse() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Top-selling items
app.get("/api/items/top", async (req, res) => {
  const { limit = 20 } = req.query;
  try {
    const { rows } = await req.pgClient.query(`
      SELECT sku, name, units_sold, revenue_cents
      FROM mv_top_items
      WHERE store_id = $1
      ORDER BY revenue_cents DESC
      LIMIT $2
    `, [STORE_ID, parseInt(limit)]);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Recent transactions
app.get("/api/transactions", async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  try {
    const { rows } = await req.pgClient.query(`
      SELECT
        transaction_id, session_id,
        gross_total_cents, net_profit_cents, cost_of_goods_cents,
        item_count, payment_authorized, payment_method,
        session_end AS completed_at
      FROM transactions
      WHERE store_id = $1
        AND payment_authorized = TRUE
      ORDER BY session_end DESC
      LIMIT $2 OFFSET $3
    `, [STORE_ID, parseInt(limit), parseInt(offset)]);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Security incidents
app.get("/api/incidents", async (req, res) => {
  const { level, resolved = "false", limit = 100 } = req.query;
  try {
    const conditions = ["store_id = $1"];
    const params     = [STORE_ID];

    if (level !== undefined) {
      params.push(parseInt(level));
      conditions.push(`level = $${params.length}`);
    }
    if (resolved === "false") {
      conditions.push("resolved = FALSE");
    }

    const { rows } = await req.pgClient.query(`
      SELECT
        incident_id, session_id, camera_id,
        anomaly_score, level, event_class, description,
        resolved, resolved_at, occurred_at
      FROM security_incidents
      WHERE ${conditions.join(" AND ")}
      ORDER BY occurred_at DESC
      LIMIT $${params.push(parseInt(limit)) && params.length}
    `, params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Resolve an incident
app.patch("/api/incidents/:id/resolve", async (req, res) => {
  const { id }       = req.params;
  const { resolved_by = "owner" } = req.body;
  try {
    const { rowCount } = await req.pgClient.query(`
      UPDATE security_incidents
      SET resolved = TRUE, resolved_at = NOW(), resolved_by = $1
      WHERE incident_id = $2 AND store_id = $3
    `, [resolved_by, parseInt(id), STORE_ID]);

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Incident not found" });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Inventory status
app.get("/api/inventory", async (req, res) => {
  try {
    const { rows } = await req.pgClient.query(`
      SELECT
        i.store_id, i.sku, p.name, p.unit_price_cents,
        i.qty_on_hand, i.qty_reserved, i.reorder_threshold,
        i.updated_at
      FROM inventory i
      JOIN items p ON p.sku = i.sku
      WHERE i.store_id = $1
      ORDER BY i.qty_on_hand ASC
    `, [STORE_ID]);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Cloud sync ingest endpoint — called by edge cloud sync agent
app.post("/api/sync/transactions", async (req, res) => {
  const { secret } = req.headers;
  if (secret !== EDGE_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { transactions } = req.body;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ ok: false, error: "No transactions" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of transactions) {
      await client.query(`
        INSERT INTO transactions
          (transaction_id, store_id, session_id, session_start, session_end,
           gross_total_cents, cost_of_goods_cents, net_profit_cents,
           item_count, payment_authorized, payment_method)
        VALUES ($1,$2,$3,to_timestamp($4/1000000.0),to_timestamp($5/1000000.0),
                $6,$7,$8,$9,$10,$11)
        ON CONFLICT (transaction_id, store_id, session_end) DO NOTHING
      `, [
        t.transaction_id, STORE_ID, t.session_id,
        t.session_start_us, t.session_end_us,
        t.gross_total_cents, t.cost_of_goods_cents, t.net_profit_cents,
        t.item_count, t.payment_authorized, t.payment_method
      ]);
    }
    await client.query("COMMIT");

    // Broadcast new transactions to dashboard WebSocket clients
    broadcastToDashboard({
      type: "BATCH_SYNC",
      count: transactions.length,
      store_id: STORE_ID,
    });

    res.json({ ok: true, inserted: transactions.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[SYNC] Transaction ingest error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// Cloud sync ingest — security incidents
app.post("/api/sync/incidents", async (req, res) => {
  const { secret } = req.headers;
  if (secret !== EDGE_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { incidents } = req.body;
  if (!Array.isArray(incidents)) {
    return res.status(400).json({ ok: false, error: "No incidents" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const inc of incidents) {
      await client.query(`
        INSERT INTO security_incidents
          (incident_id, store_id, session_id, camera_id,
           anomaly_score, level, event_class, description, occurred_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000000.0))
        ON CONFLICT (incident_id, store_id) DO NOTHING
      `, [
        inc.incident_id, STORE_ID, inc.session_id || null,
        inc.camera_id || null, inc.anomaly_score,
        inc.level, inc.event_class, inc.description, inc.timestamp_us
      ]);
    }
    await client.query("COMMIT");
    res.json({ ok: true, inserted: incidents.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ─── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/" });

// Two connection pools: edge nodes and dashboard clients
const edgeClients      = new Set();  // Authenticated edge → cloud
const dashboardClients = new Set();  // Dashboard browsers

wss.on("connection", (ws, req) => {
  const clientType = req.headers["x-client-type"];
  const secret     = req.headers["x-edge-secret"];

  if (clientType === "edge" && secret === EDGE_SECRET) {
    // ── Edge node connection ──────────────────────────────────────────────
    console.log("[WS] Edge node connected:", req.socket.remoteAddress);
    edgeClients.add(ws);

    ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        // Relay every edge event to all dashboard clients immediately
        broadcastToDashboard(payload);

        // Persist critical events directly (no batching for CRITICAL incidents)
        if (payload.type === "SECURITY_INCIDENT" && payload.level === "CRITICAL") {
          persistIncidentDirect(payload).catch(console.error);
        }
      } catch { /* ignore malformed */ }
    });

    ws.on("close", () => {
      edgeClients.delete(ws);
      console.log("[WS] Edge node disconnected");
    });

  } else {
    // ── Dashboard browser connection ──────────────────────────────────────
    console.log("[WS] Dashboard client connected");
    dashboardClients.add(ws);

    // Send connection acknowledgement with current store state
    ws.send(JSON.stringify({
      type:     "CONNECTED",
      store_id: STORE_ID,
      ts:       Date.now(),
    }));

    ws.on("close", () => {
      dashboardClients.delete(ws);
    });

    ws.on("error", (err) => {
      console.error("[WS] Dashboard client error:", err.message);
      dashboardClients.delete(ws);
    });
  }
});

// Broadcast to all connected dashboard clients (non-blocking, drop on error)
function broadcastToDashboard(payload) {
  const msg = JSON.stringify(payload);
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg, (err) => {
        if (err) dashboardClients.delete(client);
      });
    }
  }
}

// Persist a CRITICAL incident immediately outside the batch sync path
async function persistIncidentDirect(payload) {
  const client = await pool.connect();
  try {
    await client.query(`SET app.store_id = $1`, [STORE_ID]);
    await client.query(`
      INSERT INTO security_incidents
        (incident_id, store_id, session_id, camera_id,
         anomaly_score, level, event_class, description, occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0))
      ON CONFLICT (incident_id, store_id) DO NOTHING
    `, [
      payload.incident_id, STORE_ID,
      payload.session_id || null, payload.camera_id || null,
      payload.score, 2, payload.event_class ?? 0,
      payload.description,
      Date.now()
    ]);
  } finally {
    client.release();
  }
}

// ─── Materialized view refresh (every 5 minutes) ──────────────────────────────
setInterval(async () => {
  try {
    await pool.query("SELECT fn_refresh_dashboard_views()");
    console.log("[PG] Materialized views refreshed");
  } catch (err) {
    console.error("[PG] View refresh failed:", err.message);
  }
}, 5 * 60 * 1000);

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n=== Retail Cloud API Server ===`);
  console.log(`  HTTP + WebSocket : http://localhost:${PORT}`);
  console.log(`  PostgreSQL       : ${PG_URL.replace(/:\/\/.*@/, "://<credentials>@")}`);
  console.log(`  Store ID         : ${STORE_ID}`);
  console.log(`  Edge connections : 0`);
  console.log(`  Dashboard clients: 0\n`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on("SIGTERM", async () => {
  console.log("[SHUTDOWN] SIGTERM received");
  await pool.end();
  server.close(() => process.exit(0));
});
