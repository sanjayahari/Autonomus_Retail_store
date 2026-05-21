// src/hooks/useMockData.js
// Autonomous Retail Infrastructure — Mock WebSocket Data Provider
//
// Simulates realistic edge engine WebSocket events so the React dashboard
// can be developed and demoed without a live Jetson cluster.
// Import this in App.jsx and swap WebSocketProvider for MockDataProvider.

import { useEffect, useRef } from "react";

// ─── Randomness helpers ───────────────────────────────────────────────────────
const rand     = (min, max)  => Math.random() * (max - min) + min;
const randInt  = (min, max)  => Math.floor(rand(min, max));
const pick     = (arr)       => arr[randInt(0, arr.length)];
const randId   = ()          => Math.floor(Math.random() * 0xFFFFFFFF);

// ─── Mock catalog ─────────────────────────────────────────────────────────────
const MOCK_ITEMS = [
  { sku: 1001, name: "Sparkling Water 500ml",       price: 199  },
  { sku: 1002, name: "Greek Yogurt 200g",            price: 349  },
  { sku: 1003, name: "Granola Bar — Almond",         price: 249  },
  { sku: 1004, name: "Pressed Orange Juice 330ml",   price: 449  },
  { sku: 1005, name: "Organic Banana (each)",        price: 79   },
  { sku: 1006, name: "Cold Brew Coffee 250ml",       price: 529  },
  { sku: 1007, name: "Protein Shake — Vanilla",      price: 649  },
  { sku: 1008, name: "Salted Almonds 50g",           price: 299  },
  { sku: 1009, name: "Whole Grain Crackers 100g",    price: 399  },
  { sku: 1010, name: "Sparkling Water 1L",           price: 299  },
];

const ANOMALY_DESCRIPTIONS = [
  { class: 1, desc: "Item concealment detected — jacket occlusion zone" },
  { class: 2, desc: "Customer bypassed shelf sensor zone — aisle 3 camera" },
  { class: 3, desc: "Prolonged loitering at unmanned checkout kiosk" },
  { class: 1, desc: "Repeated shelf interaction without weight event corroboration" },
  { class: 2, desc: "Sensor bypass pattern — anomaly class 2 confirmed" },
];

const PAYMENT_METHODS = ["EMV", "NFC", "BIOMETRIC"];

// ─── Session pool state ───────────────────────────────────────────────────────
let mockSessions = [];

function createSession() {
  return {
    id:          randId(),
    state:       2, // ACTIVE
    gross_cents: 0,
    items:       0,
    cart:        [],
  };
}

// ─── Main hook ────────────────────────────────────────────────────────────────
/**
 * useMockData — injects realistic mock events into a dispatch function.
 *
 * @param {Function} dispatch — the wsReducer dispatch from WebSocketContext
 */
export function useMockData(dispatch) {
  const tickRef = useRef(null);

  useEffect(() => {
    // Seed with a few initial sessions
    mockSessions = Array.from({ length: randInt(2, 6) }, createSession);

    // Signal connected immediately
    dispatch({ type: "CONNECTED" });

    // ── Initial telemetry push ────────────────────────────────────────────
    dispatch({
      type:    "TELEMETRY",
      payload: {
        type:            "TELEMETRY",
        active_sessions: mockSessions.length,
        sessions:        mockSessions,
      },
    });

    // ── Simulation tick ───────────────────────────────────────────────────
    const interval = setInterval(() => {
      const roll = Math.random();

      if (roll < 0.05 && mockSessions.length < 12) {
        // ── New session opens ─────────────────────────────────────────────
        const session = createSession();
        mockSessions.push(session);

      } else if (roll < 0.35 && mockSessions.length > 0) {
        // ── Cart update — customer picks up item ──────────────────────────
        const session = pick(mockSessions);
        const item    = pick(MOCK_ITEMS);

        session.gross_cents += item.price;
        session.items       += 1;
        session.cart.push(item);

        dispatch({
          type:    "CART_UPDATE",
          payload: {
            type:       "CART_UPDATE",
            session_id: session.id,
            event:      "ADDED",
            sku:        item.sku,
            name:       item.name,
            price_cents: item.price,
          },
        });

      } else if (roll < 0.40 && mockSessions.some(s => s.items > 0)) {
        // ── Item returned to shelf ────────────────────────────────────────
        const session = pick(mockSessions.filter(s => s.items > 0));
        if (!session) return;
        const item = pick(session.cart);
        if (!item) return;

        session.gross_cents = Math.max(0, session.gross_cents - item.price);
        session.items       = Math.max(0, session.items - 1);
        const idx = session.cart.indexOf(item);
        if (idx !== -1) session.cart.splice(idx, 1);

        dispatch({
          type:    "CART_UPDATE",
          payload: {
            type:       "CART_UPDATE",
            session_id: session.id,
            event:      "REMOVED",
            sku:        item.sku,
            name:       item.name,
            price_cents: item.price,
          },
        });

      } else if (roll < 0.45 && mockSessions.some(s => s.items > 0 && s.gross_cents > 0)) {
        // ── Checkout ──────────────────────────────────────────────────────
        const candidates = mockSessions.filter(s => s.items > 0 && s.gross_cents > 0);
        if (!candidates.length) return;
        const session = pick(candidates);
        const gross   = session.gross_cents;
        const profit  = Math.round(gross * 0.40);
        const cogs    = gross - profit;
        const txnId   = randInt(10000, 99999);

        dispatch({
          type:    "TRANSACTION",
          payload: {
            type:           "TRANSACTION",
            transaction_id: txnId,
            session_id:     session.id,
            gross_cents:    gross,
            profit_cents:   profit,
            cogs_cents:     cogs,
            item_count:     session.items,
            authorized:     Math.random() > 0.05, // 95% auth rate
            method:         pick(PAYMENT_METHODS),
          },
        });

        // Remove from active sessions
        mockSessions = mockSessions.filter(s => s.id !== session.id);

      } else if (roll < 0.48) {
        // ── Security incident ─────────────────────────────────────────────
        const score     = rand(0.55, 0.99);
        const level     = score >= 0.85 ? 2 : score >= 0.65 ? 1 : 0;
        const anomaly   = pick(ANOMALY_DESCRIPTIONS);
        const session   = mockSessions.length > 0 ? pick(mockSessions) : null;

        dispatch({
          type:    "SECURITY_INCIDENT",
          payload: {
            type:         "SECURITY_INCIDENT",
            incident_id:  randId(),
            session_id:   session?.id ?? 0,
            camera_id:    randInt(1, 6),
            anomaly_score: parseFloat(score.toFixed(3)),
            level,
            event_class:  anomaly.class,
            description:  anomaly.desc,
            timestamp_us: Date.now() * 1000,
          },
        });
      }

      // ── Telemetry heartbeat (always) ──────────────────────────────────
      dispatch({
        type:    "TELEMETRY",
        payload: {
          type:            "TELEMETRY",
          active_sessions: mockSessions.length,
          sessions:        mockSessions.map(s => ({
            id:          s.id,
            state:       s.state,
            gross_cents: s.gross_cents,
            items:       s.items,
          })),
        },
      });

    }, 1500); // fire every 1.5 seconds

    tickRef.current = interval;
    return () => clearInterval(interval);
  }, [dispatch]);
}
