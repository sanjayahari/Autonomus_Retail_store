// src/contexts/WebSocketContext.jsx
// Autonomous Retail Infrastructure — Live WebSocket Data Context
//
// Maintains a persistent WebSocket connection to the edge engine gateway.
// Distributes parsed event payloads to all subscribed dashboard components
// via React Context + useReducer, with automatic reconnect logic.

import { createContext, useContext, useEffect, useReducer, useRef, useCallback } from "react";

// ─── Event type constants (match edge engine WS serializer) ──────────────────
export const WS_EVENTS = {
  TELEMETRY:          "TELEMETRY",
  CART_UPDATE:        "CART_UPDATE",
  SECURITY_INCIDENT:  "SECURITY_INCIDENT",
  TRANSACTION:        "TRANSACTION",
};

// ─── State shape ─────────────────────────────────────────────────────────────
export const initialState = {
  connected:         false,
  activeSessions:    0,
  sessions:          [],            // Array of { id, state, gross_cents, items }
  securityLog:       [],            // Last 100 incidents, newest first
  transactions:      [],            // Last 50 transactions, newest first
  revenueTimeSeries: [],            // { timestamp, gross_cents, profit_cents }
  cartUpdates:       [],            // Last 20 cart events for activity feed
  lastPing:          null,
};

// ─── Reducer ─────────────────────────────────────────────────────────────────
export function wsReducer(state, action) {
  switch (action.type) {
    case "CONNECTED":
      return { ...state, connected: true, lastPing: Date.now() };

    case "DISCONNECTED":
      return { ...state, connected: false };

    case "PING":
      return { ...state, lastPing: Date.now() };

    case WS_EVENTS.TELEMETRY:
      return {
        ...state,
        activeSessions: action.payload.active_sessions,
        sessions: action.payload.sessions ?? state.sessions,
      };

    case WS_EVENTS.SECURITY_INCIDENT: {
      const incident = {
        ...action.payload,
        received_at: Date.now(),
      };
      return {
        ...state,
        securityLog: [incident, ...state.securityLog].slice(0, 100),
      };
    }

    case WS_EVENTS.TRANSACTION: {
      const txn = { ...action.payload, received_at: Date.now() };
      const newTimeSeries = [
        ...state.revenueTimeSeries,
        {
          timestamp:    txn.received_at,
          gross_cents:  txn.gross_cents,
          profit_cents: txn.profit_cents,
        },
      ].slice(-288); // Keep 24h @ 5min intervals

      return {
        ...state,
        transactions: [txn, ...state.transactions].slice(0, 50),
        revenueTimeSeries: newTimeSeries,
      };
    }

    case WS_EVENTS.CART_UPDATE: {
      const update = { ...action.payload, received_at: Date.now() };
      return {
        ...state,
        cartUpdates: [update, ...state.cartUpdates].slice(0, 20),
      };
    }

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────
export const WebSocketContext = createContext(null);

export function WebSocketProvider({ children, wsUrl = "ws://localhost:8080" }) {
  const [state, dispatch] = useReducer(wsReducer, initialState);
  const wsRef             = useRef(null);
  const reconnectTimer    = useRef(null);
  const mountedRef        = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        dispatch({ type: "CONNECTED" });
        // Clear any pending reconnect
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      ws.onmessage = (event) => {
        dispatch({ type: "PING" });
        try {
          const payload = JSON.parse(event.data);
          if (payload.type) {
            dispatch({ type: payload.type, payload });
          }
        } catch {
          // Malformed JSON — ignore gracefully
        }
      };

      ws.onclose = () => {
        dispatch({ type: "DISCONNECTED" });
        if (mountedRef.current) {
          // Exponential backoff: 2s → 4s → 8s → max 30s
          const delay = Math.min(30000, 2000 * (reconnectTimer.attempts ?? 1));
          reconnectTimer.current = setTimeout(connect, delay);
          reconnectTimer.attempts = (reconnectTimer.attempts ?? 1) * 2;
        }
      };

      ws.onerror = () => ws.close();

    } catch {
      dispatch({ type: "DISCONNECTED" });
    }
  }, [wsUrl]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return (
    <WebSocketContext.Provider value={state}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useRetailData() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useRetailData must be used within WebSocketProvider");
  return ctx;
}

// Convenience selector hooks
export function useActiveSessions() {
  return useRetailData().activeSessions;
}

export function useSecurityLog() {
  return useRetailData().securityLog;
}

export function useTransactions() {
  return useRetailData().transactions;
}

export function useConnectionStatus() {
  const { connected, lastPing } = useRetailData();
  return { connected, lastPing };
}
