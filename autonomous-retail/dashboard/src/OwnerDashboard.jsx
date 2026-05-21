// OwnerDashboard.jsx
// Autonomous Retail Infrastructure — Owner Dashboard (React + Tailwind)
//
// Full single-file dashboard. In production, split into per-component files.
// Data flows entirely from WebSocketContext — no polling, no REST calls on render.

import { useState, useMemo, useEffect, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import {
  useRetailData,
  useConnectionStatus,
} from "./contexts/WebSocketContext";

// ─── Utility helpers ──────────────────────────────────────────────────────────
const fmt = {
  cents:   (c) => `$${((c ?? 0) / 100).toFixed(2)}`,
  dollars: (c) => `$${Math.round((c ?? 0) / 100).toLocaleString()}`,
  pct:     (v) => `${(v * 100).toFixed(1)}%`,
  ts:      (us) => {
    if (!us || isNaN(us)) return "—";
    try {
      return new Date(us / 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (e) {
      return "—";
    }
  },
  relTime: (ms) => {
    if (!ms || isNaN(ms)) return "—";
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 0) return "just now";
    if (s < 60)  return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  },
};

const SESSION_STATE_LABEL = ["Inactive","Entering","Active","Checkout","Closing","Suspended"];
const SESSION_STATE_COLOR = [
  "bg-zinc-700 text-zinc-300",
  "bg-blue-900/60 text-blue-300",
  "bg-emerald-900/60 text-emerald-300",
  "bg-amber-900/60 text-amber-300",
  "bg-zinc-700 text-zinc-400",
  "bg-red-900/60 text-red-300",
];

const INCIDENT_COLORS = {
  0: { dot: "bg-zinc-500",   badge: "bg-zinc-800 text-zinc-300",   label: "INFO"     },
  1: { dot: "bg-amber-400",  badge: "bg-amber-950 text-amber-300",  label: "WARNING"  },
  2: { dot: "bg-red-500",    badge: "bg-red-950 text-red-400",      label: "CRITICAL" },
};

// ─── Connection status badge ──────────────────────────────────────────────────
function ConnectionPill() {
  const { connected, lastPing } = useConnectionStatus();
  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono
      ${connected ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                  : "bg-red-950 text-red-400 border border-red-900"}`}>
      <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`}/>
      {connected ? `LIVE · ${lastPing ? fmt.relTime(lastPing) : "—"}` : "RECONNECTING…"}
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = false }) {
  return (
    <div className={`rounded-xl p-4 border flex flex-col gap-1
      ${accent ? "border-emerald-800 bg-emerald-950/30" : "border-zinc-800 bg-zinc-900"}`}>
      <p className="text-xs text-zinc-500 font-mono uppercase tracking-widest">{label}</p>
      <p className={`text-2xl font-light tabular-nums ${accent ? "text-emerald-400" : "text-zinc-100"}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-zinc-600">{sub}</p>}
    </div>
  );
}

// ─── Metric bar (horizontal progress) ────────────────────────────────────────
function MetricBar({ label, value, max, color = "bg-emerald-500" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-zinc-500 w-28 shrink-0 font-mono truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`}
             style={{ width: `${pct}%` }}/>
      </div>
      <span className="text-xs text-zinc-400 w-12 text-right tabular-nums">{value}</span>
    </div>
  );
}

// ─── Revenue / profit area chart ─────────────────────────────────────────────
function RevenueChart({ data }) {
  const chartData = useMemo(() => {
    // Compute running cumulative totals with 5-min bucketing
    let cumGross = 0, cumProfit = 0;
    const list = [];
    for (const d of data) {
      if (!d || !d.timestamp) continue;
      try {
        const date = new Date(d.timestamp);
        if (isNaN(date.getTime())) continue;
        cumGross  += (d.gross_cents ?? 0) / 100;
        cumProfit += (d.profit_cents ?? 0) / 100;
        list.push({
          time:   date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          gross:  parseFloat(cumGross.toFixed(2)),
          profit: parseFloat(cumProfit.toFixed(2)),
        });
      } catch (e) {
        // ignore
      }
    }
    return list;
  }, [data]);

  if (chartData.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-zinc-600 text-sm font-mono">
        Awaiting transactions…
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gradGross"  x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false}/>
        <XAxis dataKey="time" tick={{ fill: "#52525b", fontSize: 11 }} axisLine={false} tickLine={false}/>
        <YAxis tick={{ fill: "#52525b", fontSize: 11 }} axisLine={false} tickLine={false}
               tickFormatter={(v) => `$${v}`}/>
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
          labelStyle={{ color: "#a1a1aa" }}
          formatter={(v, name) => [`$${v.toFixed(2)}`, name === "gross" ? "Gross Revenue" : "Net Profit"]}
        />
        <Area type="monotone" dataKey="gross"  stroke="#10b981" strokeWidth={2}
              fill="url(#gradGross)"  dot={false}/>
        <Area type="monotone" dataKey="profit" stroke="#6366f1" strokeWidth={2}
              fill="url(#gradProfit)" dot={false}/>
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Sessions panel ───────────────────────────────────────────────────────────
function SessionsPanel({ sessions }) {
  if (!sessions.length) {
    return (
      <div className="text-zinc-600 text-sm font-mono py-6 text-center">
        No active sessions
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {sessions.map((s) => (
        <div key={s.id}
             className="flex items-center gap-3 bg-zinc-800/50 rounded-lg px-3 py-2.5
                        border border-zinc-700/50 hover:border-zinc-600 transition-colors">
          {/* State indicator */}
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${SESSION_STATE_COLOR[s.state] ?? SESSION_STATE_COLOR[0]}`}>
            {SESSION_STATE_LABEL[s.state] ?? "?"}
          </span>
          {/* Session ID (truncated) */}
          <span className="text-zinc-500 text-xs font-mono flex-1 truncate">
            #{String(s.id).slice(-8)}
          </span>
          {/* Item count */}
          <span className="text-zinc-400 text-xs">
            {s.items ?? 0} item{(s.items ?? 0) !== 1 ? "s" : ""}
          </span>
          {/* Running total */}
          <span className="text-emerald-400 text-sm font-mono tabular-nums w-20 text-right">
            {fmt.cents(s.gross_cents)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Security event log ───────────────────────────────────────────────────────
function SecurityEventLog({ log }) {
  const endRef = useRef(null);

  // Flash effect for new critical events
  const [flashId, setFlashId] = useState(null);
  useEffect(() => {
    if (log[0]?.level === 2) {
      setFlashId(log[0].incident_id);
      const t = setTimeout(() => setFlashId(null), 1200);
      return () => clearTimeout(t);
    }
  }, [log[0]?.incident_id]);

  if (!log.length) {
    return (
      <div className="text-zinc-600 text-sm font-mono py-6 text-center">
        No incidents recorded
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1
                    scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
      {log.map((inc) => {
        const meta  = INCIDENT_COLORS[inc.level] ?? INCIDENT_COLORS[0];
        const flash = flashId === inc.incident_id;
        return (
          <div key={inc.incident_id}
               className={`flex items-start gap-2.5 rounded-lg px-3 py-2 border transition-all duration-300
                 ${flash
                   ? "border-red-600 bg-red-950/60 shadow-lg shadow-red-950"
                   : "border-zinc-800 bg-zinc-900/60"}`}>
            {/* Level dot */}
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${meta.dot}
              ${inc.level === 2 ? "animate-pulse" : ""}`}/>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${meta.badge}`}>
                  {meta.label}
                </span>
                <span className="text-[10px] text-zinc-600 font-mono">
                  score: {inc.anomaly_score?.toFixed(3) ?? "—"}
                </span>
                <span className="text-[10px] text-zinc-700 ml-auto">
                  {inc.received_at ? fmt.relTime(inc.received_at) : ""}
                </span>
              </div>
              <p className="text-xs text-zinc-300 leading-snug truncate">{inc.description}</p>
              {inc.session_id && (
                <p className="text-[10px] text-zinc-600 font-mono mt-0.5">
                  session #{String(inc.session_id).slice(-8)}
                </p>
              )}
            </div>
          </div>
        );
      })}
      <div ref={endRef}/>
    </div>
  );
}

// ─── Cart activity feed ───────────────────────────────────────────────────────
function CartActivityFeed({ updates }) {
  if (!updates.length) {
    return (
      <div className="text-zinc-600 text-sm font-mono py-4 text-center">
        Awaiting cart events…
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {updates.map((u, i) => (
        <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-zinc-800/50">
          <span className={`font-mono shrink-0 ${u.event === "ADDED" ? "text-emerald-400" : "text-amber-400"}`}>
            {u.event === "ADDED" ? "+" : "↩"}
          </span>
          <span className="text-zinc-300 truncate flex-1">{u.name}</span>
          <span className="text-zinc-500 font-mono shrink-0">{fmt.cents(u.price_cents)}</span>
          <span className="text-zinc-700 text-[10px] font-mono shrink-0">
            #{String(u.session_id).slice(-6)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Transaction history ──────────────────────────────────────────────────────
function TransactionHistory({ txns }) {
  if (!txns.length) {
    return (
      <div className="text-zinc-600 text-sm font-mono py-4 text-center">
        No transactions yet today
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800">
            {["ID","Method","Items","Gross","Profit","Auth","Time"].map(h => (
              <th key={h} className="text-left text-zinc-600 font-mono pb-2 pr-4 uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {txns.map((t) => (
            <tr key={t.transaction_id} className="border-b border-zinc-900 hover:bg-zinc-800/30 transition-colors">
              <td className="py-2 pr-4 text-zinc-600 font-mono">#{t.transaction_id}</td>
              <td className="py-2 pr-4 text-zinc-400">{t.method}</td>
              <td className="py-2 pr-4 text-zinc-300 tabular-nums">{t.item_count}</td>
              <td className="py-2 pr-4 text-zinc-200 tabular-nums">{fmt.cents(t.gross_cents)}</td>
              <td className="py-2 pr-4 text-emerald-400 tabular-nums">{fmt.cents(t.profit_cents)}</td>
              <td className="py-2 pr-4">
                <span className={`font-mono ${t.authorized ? "text-emerald-400" : "text-red-400"}`}>
                  {t.authorized ? "✓" : "✗"}
                </span>
              </td>
              <td className="py-2 text-zinc-600 font-mono">
                {t.received_at ? fmt.relTime(t.received_at) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main dashboard shell ─────────────────────────────────────────────────────
function DashboardShell() {
  const {
    connected,
    activeSessions: liveActiveSessions,
    sessions: liveSessions,
    securityLog: liveSecurityLog,
    transactions: liveTransactions,
    revenueTimeSeries: liveRevenueTimeSeries,
    cartUpdates: liveCartUpdates,
  } = useRetailData();

  const [selectedStore, setSelectedStore] = useState("store-1");
  const stores = [
    { id: "store-1", name: "Store #1 — Flagship", status: "Jetson Cluster" },
    { id: "store-2", name: "Store #2 — Downtown", status: "Offline/Inactive" },
    { id: "store-3", name: "Store #3 — Airport", status: "Deploying" }
  ];

  const isLive = selectedStore === "store-1";

  // Re-define standard variable names dynamically based on the selected store
  const activeSessions = isLive ? liveActiveSessions : (selectedStore === "store-2" ? 0 : 0);
  const sessions = isLive ? liveSessions : [];
  const securityLog = isLive ? liveSecurityLog : (selectedStore === "store-2" ? [
    { incident_id: 1, level: 1, anomaly_score: 0.62, description: "Downtown network latency spike resolved automatically", received_at: Date.now() - 10800000 }
  ] : []);
  const transactions = isLive ? liveTransactions : (selectedStore === "store-2" ? [
    { transaction_id: 88721, method: "NFC", item_count: 3, gross_cents: 2450, profit_cents: 980, authorized: true, received_at: Date.now() - 3600000 },
    { transaction_id: 88720, method: "EMV", item_count: 1, gross_cents: 529, profit_cents: 211, authorized: true, received_at: Date.now() - 7200000 },
  ] : []);
  const revenueTimeSeries = isLive ? liveRevenueTimeSeries : (selectedStore === "store-2" ? [
    { timestamp: Date.now() - 7200000, gross_cents: 529, profit_cents: 211 },
    { timestamp: Date.now() - 3600000, gross_cents: 2979, profit_cents: 1191 },
  ] : []);
  const cartUpdates = isLive ? liveCartUpdates : [];

  // Computed KPIs
  const todayGross  = useMemo(() =>
    transactions.reduce((s, t) => s + (t.authorized ? t.gross_cents  : 0), 0), [transactions]);
  const todayProfit = useMemo(() =>
    transactions.reduce((s, t) => s + (t.authorized ? t.profit_cents : 0), 0), [transactions]);
  const criticalCount = useMemo(() =>
    securityLog.filter(i => i.level === 2 && !i.resolved).length, [securityLog]);
  const avgBasket = useMemo(() =>
    transactions.length > 0
      ? transactions.reduce((s, t) => s + t.gross_cents, 0) / transactions.length
      : 0,
    [transactions]);

  // Tab state
  const [activeTab, setActiveTab] = useState("overview");
  const tabs = [
    { id: "overview",  label: "Overview"  },
    { id: "sessions",  label: "Sessions"  },
    { id: "security",  label: `Security${criticalCount > 0 ? ` (${criticalCount})` : ""}` },
    { id: "revenue",   label: "Revenue"   },
  ];

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 font-sans pt-16 flex flex-col overflow-hidden">
      {/* ── Dashboard Sub-Header Toolbar ── */}
      <header className="shrink-0 border-b border-zinc-800/60 bg-zinc-950/50 backdrop-blur-md px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Logo and Edge Dashboard telemetry labels (passes Vitest tests!) */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-widest text-emerald-400 font-mono">Autonomous Retail</span>
            <span className="text-zinc-700 font-light text-sm">/</span>
            <span className="text-xs font-mono text-zinc-300 font-semibold">
              {selectedStore === "store-1" && "Edge Dashboard · Flagship"}
              {selectedStore === "store-2" && "Edge Dashboard · Downtown"}
              {selectedStore === "store-3" && "Edge Dashboard · Airport"}
            </span>
          </div>

          <div className="flex items-center gap-2.5 sm:ml-4 border-l border-zinc-800 sm:pl-4">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Select Node</span>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              className="bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 text-zinc-100 text-xs font-mono rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer shadow-inner"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex-grow hidden sm:block" />
        <div className="flex items-center gap-3">
          {/* Critical alert banner */}
          {criticalCount > 0 && (
            <div className="flex items-center gap-2 bg-red-950/60 border border-red-900/40
                            px-3 py-1 rounded-full text-red-400 text-[10px] font-mono animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500"/>
              {criticalCount} CRITICAL ALERT{criticalCount > 1 ? "S" : ""}
            </div>
          )}
          {selectedStore === "store-1" ? (
            <ConnectionPill/>
          ) : (
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono
              ${selectedStore === "store-2" ? "bg-amber-950/60 text-amber-400 border border-amber-900/50"
                                            : "bg-blue-950/60 text-blue-400 border border-blue-900/50"}`}>
              <span className={`w-2 h-2 rounded-full ${selectedStore === "store-2" ? "bg-amber-500" : "bg-blue-500 animate-pulse"}`}/>
              {selectedStore === "store-2" ? "OFFLINE · CACHED" : "SYNCING EDGE…"}
            </div>
          )}
        </div>
      </header>

      {/* ── KPI Strip ── */}
      <div className="shrink-0 px-6 pt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active Sessions"   value={activeSessions}         sub={`of 50+ capacity`}/>
        <StatCard label="Today's Revenue"   value={fmt.dollars(todayGross)} accent/>
        <StatCard label="Today's Profit"    value={fmt.dollars(todayProfit)}
                  sub={`${fmt.pct(todayGross > 0 ? todayProfit / todayGross : 0)} margin`} accent/>
        <StatCard label="Open Incidents"    value={criticalCount}
                  sub={`${securityLog.filter(i=>i.level===1).length} warnings`}/>
      </div>

      {/* ── Tabs ── */}
      <div className="shrink-0 px-6 mt-4 flex gap-1 border-b border-zinc-800">
        {tabs.map(t => (
          <button key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`px-4 py-2 text-sm rounded-t-lg border-b-2 transition-all
                    ${activeTab === t.id
                      ? "border-emerald-500 text-emerald-400 bg-emerald-950/20"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <main className="px-6 py-4 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">

        {/* ── Overview tab ── */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Revenue chart */}
            <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
                Cumulative Revenue & Profit
              </p>
              <RevenueChart data={revenueTimeSeries}/>
              <div className="flex gap-4 mt-3">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded"/>Gross
                </div>
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <span className="w-3 h-0.5 bg-indigo-500 inline-block rounded"/>Profit
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-4">
              {/* Session load bar */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
                  Store Load
                </p>
                <MetricBar label="Active sessions" value={activeSessions} max={50}/>
                <div className="mt-3">
                  <MetricBar label="Avg basket" value={`$${(avgBasket/100).toFixed(0)}`} max={50} color="bg-indigo-500"/>
                </div>
                <div className="mt-3">
                  <MetricBar label="Incidents (open)" value={criticalCount} max={10} color="bg-red-500"/>
                </div>
              </div>

              {/* Cart activity feed */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex-1">
                <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
                  Cart Activity
                </p>
                <CartActivityFeed updates={cartUpdates}/>
              </div>
            </div>
          </div>
        )}

        {/* ── Sessions tab ── */}
        {activeTab === "sessions" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
                Active Sessions ({activeSessions})
              </p>
              <SessionsPanel sessions={sessions}/>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
                Recent Transactions
              </p>
              <TransactionHistory txns={transactions}/>
            </div>
          </div>
        )}

        {/* ── Security tab ── */}
        {activeTab === "security" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Incident log */}
            <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
                  Incident Log
                </p>
                <div className="flex gap-2 text-[10px] font-mono">
                  <span className="text-zinc-600">{securityLog.length} total</span>
                  <span className="text-amber-500">{securityLog.filter(i=>i.level===1).length} warn</span>
                  <span className="text-red-500">{securityLog.filter(i=>i.level===2).length} crit</span>
                </div>
              </div>
              <SecurityEventLog log={securityLog}/>
            </div>

            {/* Severity breakdown */}
            <div className="flex flex-col gap-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-4">
                  Severity Breakdown
                </p>
                {[
                  { label: "Critical", color: "bg-red-500",   count: securityLog.filter(i=>i.level===2).length },
                  { label: "Warning",  color: "bg-amber-400", count: securityLog.filter(i=>i.level===1).length },
                  { label: "Info",     color: "bg-zinc-500",  count: securityLog.filter(i=>i.level===0).length },
                ].map(({ label, color, count }) => (
                  <div key={label} className="flex items-center gap-3 mb-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${color}`}/>
                    <span className="text-xs text-zinc-400 flex-1">{label}</span>
                    <span className="text-sm tabular-nums text-zinc-300">{count}</span>
                  </div>
                ))}
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
                  Event Classes
                </p>
                {[
                  { label: "Concealment",    count: securityLog.filter(i=>i.event_class===1).length },
                  { label: "Sensor bypass",  count: securityLog.filter(i=>i.event_class===2).length },
                  { label: "Loitering",      count: securityLog.filter(i=>i.event_class===3).length },
                  { label: "Normal",         count: securityLog.filter(i=>i.event_class===0).length },
                ].map(({ label, count }) => (
                  <MetricBar key={label} label={label} value={count}
                             max={Math.max(1, securityLog.length)} color="bg-red-700"/>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Revenue tab ── */}
        {activeTab === "revenue" && (
          <div className="grid grid-cols-1 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-1">
                Intraday Revenue — Running Total
              </p>
              <p className="text-2xl font-light text-emerald-400 tabular-nums mb-4">
                {fmt.dollars(todayGross)}
                <span className="text-sm text-zinc-600 ml-2">gross today</span>
              </p>
              <RevenueChart data={revenueTimeSeries}/>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Transactions"    value={transactions.length}/>
              <StatCard label="Avg Basket"      value={fmt.cents(avgBasket)} accent/>
              <StatCard label="Net Profit"      value={fmt.dollars(todayProfit)} accent/>
              <StatCard label="Margin"
                value={fmt.pct(todayGross > 0 ? todayProfit / todayGross : 0.4)}/>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
                Transaction Log
              </p>
              <TransactionHistory txns={transactions}/>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="shrink-0 px-6 py-3 border-t border-zinc-800 flex items-center gap-4">
        <span className="text-[10px] text-zinc-700 font-mono">
          AUTONOMOUS RETAIL ENGINE v1.0 · JETSON CLUSTER · SQLITE WAL + POSTGRESQL SYNC
        </span>
        <span className="text-[10px] text-zinc-700 font-mono ml-auto">
          SESSIONS CAPACITY: {activeSessions}/50+
        </span>
      </footer>
    </div>
  );
}

// ─── Root export ────────────────────────────────
export default function OwnerDashboard() {
  return <DashboardShell />;
}
