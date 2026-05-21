// src/App.jsx
// Autonomous Retail Infrastructure — React Application Entry Point
//
// Three-page routing: Landing Page, Live Simulation, Owner Dashboard
// Always runs in demo/mock mode for the web showcase.

import { lazy, Suspense, useReducer } from "react";
import { Routes, Route } from "react-router-dom";
import {
  WebSocketContext,
  wsReducer,
  initialState,
} from "./contexts/WebSocketContext";
import { useMockData } from "./hooks/useMockData";
import NavBar from "./NavBar";
import ErrorBoundary from "./ErrorBoundary";

// Lazy-load heavy pages for code splitting
const LandingPage      = lazy(() => import("./LandingPage"));
const StoreSimulation  = lazy(() => import("./StoreSimulation"));
const OwnerDashboard   = lazy(() => import("./OwnerDashboard"));

// ─── Loading screen ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-700/50
                        flex items-center justify-center animate-pulse-glow">
          <span className="text-emerald-400 text-xl font-bold">∅</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-zinc-500 font-mono">Loading...</span>
        </div>
      </div>
    </div>
  );
}

// ─── Global mock data provider ────────────────────────────────────────────────
// Wraps the entire app in mock mode, feeding simulated events into the
// same Context shape used by the live WebSocket provider. The dashboard
// sees realistic data without any backend.
function MockDataProvider({ children }) {
  const [state, dispatch] = useReducer(wsReducer, initialState);
  useMockData(dispatch);

  return (
    <WebSocketContext.Provider value={state}>
      {children}
    </WebSocketContext.Provider>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <MockDataProvider>
        <NavBar />
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/simulation" element={<StoreSimulation />} />
            <Route path="/dashboard" element={<OwnerDashboard />} />
          </Routes>
        </Suspense>
      </MockDataProvider>
    </ErrorBoundary>
  );
}
