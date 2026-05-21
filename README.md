<img width="1910" height="861" alt="Screenshot 2026-05-21 210142" src="https://github.com/user-attachments/assets/8dbb9a59-e988-4a55-8378-1eedc2acbd07" />
<img width="1914" height="869" alt="Screenshot 2026-05-21 210253" src="https://github.com/user-attachments/assets/1ea73bed-055b-49c2-87e3-2d413586c757" />
<img width="1919" height="865" alt="Screenshot 2026-05-21 210235" src="https://github.com/user-attachments/assets/2edddf56-4238-403c-970a-d84fa895b3b5" />
<img width="1917" height="857" alt="Screenshot 2026-05-21 210212" src="https://github.com/user-attachments/assets/c967f630-8818-4abd-8788-e45c7ecf124f" />
<img width="1917" height="868" alt="Screenshot 2026-05-21 210157" src="https://github.com/user-attachments/assets/444b4414-ccf4-4657-b159-cc6d0d8c36e1" />
<img width="1910" height="861" alt="Screenshot 2026-05-21 210142" src="https://github.com/user-attachments/assets/ec104ccf-a521-4845-8306-d32e33aba93e" />
# Autonomous Retail Infrastructure — Deployment Runbook

## System Overview

```
Physical Hardware (Jetson cluster)
    │   MQTT over LAN (sub-10ms)
    ▼
Edge Engine (C++ binary on Jetson)
    │   WebSocket / HTTPS
    ▼
Cloud API Server (Node.js, Docker)
    │   REST / WebSocket
    ▼
Owner Dashboard (React, browser)
```

---

## Repository Structure

```
autonomous-retail/
├── edge-engine/
│   ├── include/
│   │   ├── retail_types.hpp          # All shared types and constants
│   │   ├── spsc_ring_buffer.hpp      # Lock-free sensor event buffer
│   │   ├── item_catalog.hpp          # O(1) SKU weight profile lookup
│   │   ├── session_manager.hpp       # 50+ concurrent session lifecycle
│   │   ├── sensor_fusion_engine.hpp  # Weight × camera corroboration engine
│   │   ├── reconciliation_engine.hpp # Checkout, margin, inventory sync
│   │   ├── mqtt_subscriber.hpp       # Paho MQTT topic routing
│   │   └── sqlite_store.hpp          # WAL-mode SQLite persistence
│   ├── src/
│   │   └── edge_engine.cpp           # Main orchestrator + thread pool
│   └── CMakeLists.txt                # aarch64 Jetson build config
├── db-schemas/
│   ├── edge_schema.sql               # SQLite schema (WAL, indices, views)
│   └── cloud_schema.sql              # PostgreSQL schema (partitioned, RLS)
├── cloud-api/
│   ├── server.js                     # Node.js API + WebSocket relay
│   ├── package.json
│   └── Dockerfile
├── dashboard/
│   ├── src/
│   │   ├── App.jsx                   # Root — live/mock mode toggle
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── OwnerDashboard.jsx        # Full dashboard with 4 tabs
│   │   ├── contexts/
│   │   │   └── WebSocketContext.jsx  # Live WS state + reducer
│   │   └── hooks/
│   │       └── useMockData.js        # Simulation hook (dev/demo)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
├── infra/
│   ├── mosquitto.conf                # MQTT broker config
│   └── nginx.conf                    # Production reverse proxy
└── docker-compose.yml                # Full stack orchestration
```

---

## 1. Edge Engine — Jetson Cluster Setup

### Prerequisites (Ubuntu 22.04 / JetPack 6.x)

```bash
sudo apt update
sudo apt install -y \
  build-essential cmake ninja-build \
  libsqlite3-dev libpaho-mqtt3-dev \
  libcurl4-openssl-dev libwebsockets-dev \
  pkg-config
```

### Build

```bash
cd edge-engine
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DJETSON_ARCH=armv8.2-a \
  -DBUILD_TESTS=OFF
cmake --build build -j$(nproc)
```

### Configure

Copy and edit the environment file:

```bash
cp .env.example .env
```

| Variable          | Description                              | Default                      |
|-------------------|------------------------------------------|------------------------------|
| `MQTT_BROKER`     | MQTT broker address                      | `tcp://127.0.0.1:1883`      |
| `SQLITE_DB_PATH`  | Edge SQLite database path                | `/data/retail_edge.db`       |
| `CLOUD_SYNC_URL`  | Cloud API base URL for sync              | `http://cloud-api:3001`      |
| `EDGE_SECRET`     | Shared secret for cloud API auth         | *(required)*                 |
| `STORE_ID`        | Numeric store identifier                 | `1`                          |
| `WS_PORT`         | WebSocket gateway port                   | `8080`                       |

### Run as a systemd service

```bash
sudo cp infra/retail-edge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now retail-edge
sudo journalctl -u retail-edge -f
```

---

## 2. Cloud Stack — Docker Compose

### Prerequisites

- Docker 24+ and Docker Compose v2
- A server with at least 2 GB RAM (4 GB recommended)

### First run

```bash
# Create environment file
cp .env.example .env
# Edit: set PG_PASSWORD, EDGE_SECRET, DASHBOARD_ORIGIN

# Start all services
docker compose up -d

# Apply schema (runs automatically via docker-entrypoint-initdb.d on first start)
# Verify:
docker compose exec postgres psql -U retail_app -d retail -c "\dt"
```

### Development (with Vite HMR)

```bash
docker compose --profile dev up
# Dashboard: http://localhost:5173
# API:       http://localhost:3001
# MQTT:      localhost:1883
```

### Production

```bash
# Build dashboard assets first
cd dashboard && npm ci && npm run build && cd ..

docker compose --profile prod up -d
# Dashboard: http://localhost (nginx)
```

---

## 3. Dashboard — Standalone Development

```bash
cd dashboard
npm install
VITE_MOCK_DATA=true npm run dev
# Opens http://localhost:5173 with simulated sensor events
```

To connect to a live edge node or cloud API:

```bash
VITE_MOCK_DATA=false \
VITE_WS_URL=ws://your-cloud-api:3001 \
npm run dev
```

---

## 4. Hardware Wiring Guide

### MQTT Topic Schema

| Topic                              | Publisher         | QoS | Payload struct       |
|------------------------------------|-------------------|-----|----------------------|
| `shelf/<shelf_id>/<slot>/weight`   | Load cell node    | 1   | `WireShelfPayload`   |
| `camera/<cam_id>/event`            | Jetson camera AI  | 1   | `WireCameraPayload`  |
| `door/<door_id>/scan`              | Door controller   | 2   | `WireDoorPayload`    |
| `terminal/<terminal_id>/checkout`  | Payment terminal  | 2   | `WireCheckoutPayload`|

### Wire Payload Sizes

```
WireShelfPayload   →  20 bytes  (packed)
WireCameraPayload  →  44 bytes  (packed)
WireDoorPayload    →  64 bytes  (fixed, null-padded token)
WireCheckoutPayload→  24 bytes  (packed)
```

All payloads are binary-packed structs (see `mqtt_subscriber.hpp`).
No JSON on the sensor bus — minimum wire overhead for 50+ concurrent sessions.

### Planogram Configuration

After first startup, populate the planogram table to map shelf slots to SKUs
and camera zones:

```sql
-- Example: Shelf 1, Slot 0 = Sparkling Water, covered by Camera 1
INSERT INTO planogram (shelf_id, slot_id, sku, camera_id, zone_label)
VALUES (1, 0, 1001, 1, 'aisle-1-left');
```

The edge engine loads this at startup. To reload without restart:
send a SIGHUP to the `retail_edge` process.

---

## 5. Data Consistency Guarantees

| Scenario                                  | Engine behaviour                                              |
|-------------------------------------------|---------------------------------------------------------------|
| Weight event, no camera within 2s         | Cart NOT updated; WARNING incident raised for human review    |
| Camera anomaly score ≥ 0.85               | Session SUSPENDED immediately; CRITICAL alert pushed to owner |
| Camera anomaly score 0.60–0.84            | Session monitored; WARNING incident logged                    |
| Unknown item weight (no SKU match)        | Weight event held; WARNING incident with weight value         |
| Store at 50+ session capacity             | Door scan rejected; entry denied until a session closes       |
| Cloud sync failure                        | Transactions buffered in SQLite; retried with exponential backoff |
| Edge process restart                      | SQLite WAL preserves all committed events; sessions rebuilt from DB |

---

## 6. Monitoring & Observability

### Edge health check

```bash
# Active sessions
sqlite3 /data/retail_edge.db "SELECT COUNT(*) FROM sessions WHERE state=2;"

# Unsynced transactions
sqlite3 /data/retail_edge.db "SELECT COUNT(*) FROM transactions WHERE synced_to_cloud=0;"

# Recent incidents
sqlite3 /data/retail_edge.db \
  "SELECT level, description FROM security_incidents ORDER BY timestamp_us DESC LIMIT 10;"
```

### Cloud API health

```bash
curl http://localhost:3001/health
# → {"status":"ok","store_id":1,"ts":1749123456789}
```

### PostgreSQL profit summary

```sql
SELECT * FROM mv_daily_revenue ORDER BY day DESC LIMIT 7;
```

---

## 7. Production Hardening Checklist

- [ ] Rotate `EDGE_SECRET` from default value
- [ ] Enable MQTT TLS on port 8883 (`mosquitto.conf` — add `certfile`/`keyfile`)
- [ ] Set `POSTGRES_PASSWORD` to a strong random value
- [ ] Enable PostgreSQL SSL (`sslmode=require` in `DATABASE_URL`)
- [ ] Set `DASHBOARD_ORIGIN` to your actual domain (no wildcard `*`)
- [ ] Add HTTPS to nginx with Let's Encrypt (`certbot --nginx`)
- [ ] Restrict `allow_anonymous false` in Mosquitto and add a password file
- [ ] Enable Jetson Secure Boot for hardware attestation
- [ ] Configure automated PostgreSQL backups (`pg_dump` to S3 or equivalent)
- [ ] Set up pg_cron for `fn_refresh_dashboard_views()` every 5 minutes
- [ ] Pin Docker image digests (replace `:latest` tags)
