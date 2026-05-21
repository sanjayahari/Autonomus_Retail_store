// src/StoreSimulation.jsx
// Autonomous Retail Infrastructure — Interactive Store Simulation Page
//
// Full-page interactive SVG store floor plan with real-time simulation of
// customers, shelf sensors, camera corroboration windows, and MQTT event stream.

import { useState, useReducer, useMemo, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useStoreSimulation, STORE_WIDTH, STORE_HEIGHT } from "./hooks/useStoreSimulation";
import { wsReducer, initialState } from "./contexts/WebSocketContext";

// ─── Utility helpers ──────────────────────────────────────────────────────────
const fmt = {
  cents: (c) => `$${((c ?? 0) / 100).toFixed(2)}`,
  dollars: (c) => `$${Math.round((c ?? 0) / 100).toLocaleString()}`,
  ts: (ms) => {
    if (!ms || isNaN(ms)) return "—";
    try {
      return new Date(ms).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (e) {
      return "—";
    }
  },
  relTime: (ms) => {
    if (!ms || isNaN(ms)) return "—";
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 0) return "just now";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  },
};

const TOPIC_COLORS = {
  door: "text-blue-400",
  shelf: "text-emerald-400",
  camera: "text-purple-400",
  terminal: "text-amber-400",
};

function getTopicColor(topic) {
  if (topic.startsWith("door")) return TOPIC_COLORS.door;
  if (topic.startsWith("shelf")) return TOPIC_COLORS.shelf;
  if (topic.startsWith("camera")) return TOPIC_COLORS.camera;
  if (topic.startsWith("terminal")) return TOPIC_COLORS.terminal;
  return "text-zinc-400";
}

const LEVEL_BADGE = {
  INFO: "bg-zinc-800 text-zinc-300",
  WARNING: "bg-amber-950 text-amber-400",
  CRITICAL: "bg-red-950 text-red-400",
};

// ─── SVG Defs: filters, patterns, gradients ─────────────────────────────────
function SvgDefs() {
  return (
    <defs>
      {/* Grid pattern */}
      <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1a1a1a" strokeWidth="0.5" />
      </pattern>

      {/* Glow filters */}
      <filter id="glowGreen" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="glowAmber" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
        <feColorMatrix in="blur" type="matrix"
          values="1 0.5 0 0 0  0.5 0.3 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="glowRed" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
        <feColorMatrix in="blur" type="matrix"
          values="1 0 0 0 0.1  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="glowBlue" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Camera FOV gradient */}
      <radialGradient id="fovGradEmerald" cx="0" cy="0" r="1" gradientUnits="objectBoundingBox">
        <stop offset="0%" stopColor="#34d399" stopOpacity="0.15" />
        <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="fovGradAmber" cx="0" cy="0" r="1" gradientUnits="objectBoundingBox">
        <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.2" />
        <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="fovGradRed" cx="0" cy="0" r="1" gradientUnits="objectBoundingBox">
        <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
        <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
      </radialGradient>

      {/* Checkout zone gradient */}
      <radialGradient id="checkoutGlow">
        <stop offset="0%" stopColor="#34d399" stopOpacity="0.1" />
        <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

// ─── Camera FOV cone ────────────────────────────────────────────────────────
function CameraFov({ cam }) {
  const fovRad = (cam.fovAngle * Math.PI) / 180;
  const rotRad = (cam.rotation * Math.PI) / 180;
  const reach = 120;

  const x1 = cam.x + reach * Math.cos(rotRad - fovRad / 2);
  const y1 = cam.y + reach * Math.sin(rotRad - fovRad / 2);
  const x2 = cam.x + reach * Math.cos(rotRad + fovRad / 2);
  const y2 = cam.y + reach * Math.sin(rotRad + fovRad / 2);

  const fillColor =
    cam.zoneColor === "red" ? "rgba(239,68,68,0.08)" :
    cam.zoneColor === "amber" ? "rgba(251,191,36,0.06)" :
    "rgba(52,211,153,0.04)";

  const strokeColor =
    cam.zoneColor === "red" ? "#ef4444" :
    cam.zoneColor === "amber" ? "#fbbf24" :
    "#34d399";

  const glowFilter =
    cam.zoneColor === "red" ? "url(#glowRed)" :
    cam.zoneColor === "amber" ? "url(#glowAmber)" :
    cam.active ? "url(#glowGreen)" : "none";

  return (
    <g>
      <polygon
        points={`${cam.x},${cam.y} ${x1},${y1} ${x2},${y2}`}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth="0.5"
        strokeOpacity="0.4"
        filter={glowFilter}
      >
        {cam.zoneColor === "red" && (
          <animate attributeName="opacity" values="0.6;1;0.6" dur="0.8s" repeatCount="indefinite" />
        )}
      </polygon>

      {/* Camera body */}
      <circle cx={cam.x} cy={cam.y} r="6" fill="#18181b" stroke={strokeColor}
        strokeWidth="1.5" filter={cam.active ? "url(#glowGreen)" : "none"} />
      <circle cx={cam.x} cy={cam.y} r="2.5"
        fill={cam.active ? strokeColor : "#3f3f46"} />

      {/* Camera label */}
      <text x={cam.x} y={cam.y - 10} textAnchor="middle"
        className="text-[8px]" fill="#71717a" fontFamily="monospace">
        CAM {cam.id}
      </text>
    </g>
  );
}

// ─── Shelf with slots ───────────────────────────────────────────────────────
function ShelfSvg({ shelf, corroborations }) {
  const slotWidth = shelf.w / shelf.slots.length;
  const now = Date.now();

  return (
    <g>
      {/* Shelf body */}
      <rect x={shelf.x} y={shelf.y} width={shelf.w} height={shelf.h}
        rx="4" ry="4" fill="#1c1c1c" stroke="#3f3f46" strokeWidth="1">
        <animate attributeName="stroke-opacity" values="0.4;0.7;0.4" dur="4s" repeatCount="indefinite" />
      </rect>

      {/* Shelf label */}
      <text x={shelf.x + shelf.w / 2} y={shelf.y - 6} textAnchor="middle"
        className="text-[9px]" fill="#52525b" fontFamily="monospace" fontWeight="500">
        SHELF {shelf.id}
      </text>

      {/* Slots */}
      {shelf.slots.map((slot, i) => {
        const sx = shelf.x + slotWidth * i + 2;
        const sy = shelf.y + 2;
        const sw = slotWidth - 4;
        const sh = shelf.h - 4;

        const hasRecentEvent = slot.lastEvent && (now - slot.lastEvent < 3000);
        const pendingCorr = corroborations.find(
          (c) => c.shelfId === shelf.id && c.slotId === slot.id && c.status === "pending"
        );

        let slotFill = slot.occupied ? "#27272a" : "#1a1a1a";
        let slotStroke = "#3f3f46";
        let filter = "none";

        if (pendingCorr) {
          slotFill = "#44240a";
          slotStroke = "#fbbf24";
          filter = "url(#glowAmber)";
        } else if (hasRecentEvent) {
          slotFill = "#052e16";
          slotStroke = "#34d399";
          filter = "url(#glowGreen)";
        }

        return (
          <g key={slot.id}>
            <rect x={sx} y={sy} width={sw} height={sh} rx="2" ry="2"
              fill={slotFill} stroke={slotStroke} strokeWidth="0.8"
              filter={filter}>
              {(hasRecentEvent || pendingCorr) && (
                <animate attributeName="opacity" values="0.7;1;0.7" dur="0.6s" repeatCount="3" />
              )}
            </rect>

            {/* Occupied indicator dot */}
            {slot.occupied && (
              <circle cx={sx + sw / 2} cy={sy + sh / 2} r="2" fill="#4ade80" opacity="0.6" />
            )}

            {/* Pending corroboration timer arc */}
            {pendingCorr && (() => {
              const elapsed = now - pendingCorr.timestamp;
              const total = pendingCorr.expiresAt - pendingCorr.timestamp;
              let frac = total > 0 ? Math.min(0.999, Math.max(0.001, elapsed / total)) : 0.001;
              if (isNaN(frac) || !isFinite(frac)) frac = 0.001;
              const radius = 8;
              const cx = sx + sw / 2;
              const cy = sy - 6;
              const angle = frac * 2 * Math.PI;
              const arcX = cx + radius * Math.sin(angle);
              const arcY = cy - radius * Math.cos(angle);
              const largeArc = angle > Math.PI ? 1 : 0;

              return (
                <g>
                  <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#3f3f46" strokeWidth="1.5" />
                  <path
                    d={`M ${cx} ${cy - radius} A ${radius} ${radius} 0 ${largeArc} 1 ${arcX} ${arcY}`}
                    fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round"
                  />
                </g>
              );
            })()}
          </g>
        );
      })}
    </g>
  );
}

// ─── Door SVG ───────────────────────────────────────────────────────────────
function DoorSvg({ door, label }) {
  const isOpen = door.state === "open";
  const halfW = 20;
  const h = 10;

  return (
    <g>
      {/* Door frame */}
      <rect x={door.x - halfW - 3} y={door.y - h / 2 - 2}
        width={halfW * 2 + 6} height={h + 4}
        rx="2" fill="none" stroke="#3f3f46" strokeWidth="1" strokeDasharray="3 2" />

      {/* Left panel */}
      <rect
        x={door.x - halfW} y={door.y - h / 2}
        width={halfW - 2} height={h} rx="1"
        fill={isOpen ? "#052e16" : "#1c1c1c"}
        stroke={isOpen ? "#34d399" : "#52525b"}
        strokeWidth="1"
        style={{
          transform: isOpen ? `translateX(-8px)` : "translateX(0)",
          transition: "transform 0.5s ease-in-out, fill 0.3s, stroke 0.3s",
        }}
      />

      {/* Right panel */}
      <rect
        x={door.x + 2} y={door.y - h / 2}
        width={halfW - 2} height={h} rx="1"
        fill={isOpen ? "#052e16" : "#1c1c1c"}
        stroke={isOpen ? "#34d399" : "#52525b"}
        strokeWidth="1"
        style={{
          transform: isOpen ? `translateX(8px)` : "translateX(0)",
          transition: "transform 0.5s ease-in-out, fill 0.3s, stroke 0.3s",
        }}
      />

      {/* Label */}
      <text x={door.x} y={door.y + (label === "ENTRY" ? 18 : -14)}
        textAnchor="middle" className="text-[8px]" fontFamily="monospace"
        fill={isOpen ? "#34d399" : "#71717a"} fontWeight="600" letterSpacing="2">
        {label}
      </text>

      {/* Open glow */}
      {isOpen && (
        <rect x={door.x - halfW - 5} y={door.y - h / 2 - 4}
          width={halfW * 2 + 10} height={h + 8}
          rx="4" fill="none" stroke="#34d399" strokeWidth="0.5" opacity="0.5"
          filter="url(#glowGreen)">
          <animate attributeName="opacity" values="0.3;0.7;0.3" dur="1s" repeatCount="indefinite" />
        </rect>
      )}
    </g>
  );
}

// ─── Customer SVG ───────────────────────────────────────────────────────────
function CustomerSvg({ customer }) {
  return (
    <g>
      {/* Trail dots */}
      {customer.trail && customer.trail.map((pt, i) => (
        <circle key={i} cx={pt.x} cy={pt.y} r="1.5"
          fill={customer.color} opacity={0.08 + (i / customer.trail.length) * 0.15} />
      ))}

      {/* Body glow */}
      <circle cx={customer.x} cy={customer.y} r="16"
        fill={customer.color} opacity="0.08" />

      {/* Main circle */}
      <circle cx={customer.x} cy={customer.y} r="10"
        fill={customer.color} opacity="0.85" stroke="#0a0a0a" strokeWidth="1.5"
        style={{ transition: "cx 0.15s linear, cy 0.15s linear" }}>
        {customer.state === "picking" && (
          <animate attributeName="r" values="10;13;10" dur="0.4s" repeatCount="2" />
        )}
      </circle>

      {/* Customer ID */}
      <text x={customer.x} y={customer.y + 3.5} textAnchor="middle"
        fill="#0a0a0a" fontSize="8" fontWeight="700" fontFamily="monospace">
        {customer.id}
      </text>

      {/* State label */}
      <text x={customer.x} y={customer.y - 15} textAnchor="middle"
        fill={customer.color} fontSize="7" fontFamily="monospace" opacity="0.7">
        {customer.state === "checkout" ? "💳" : customer.state === "picking" ? "📦" : ""}
      </text>

      {/* Cart count badge */}
      {customer.cart.length > 0 && (
        <g>
          <circle cx={customer.x + 10} cy={customer.y - 8} r="6"
            fill="#18181b" stroke={customer.color} strokeWidth="1" />
          <text x={customer.x + 10} y={customer.y - 5} textAnchor="middle"
            fill={customer.color} fontSize="7" fontWeight="700" fontFamily="monospace">
            {customer.cart.length}
          </text>
        </g>
      )}
    </g>
  );
}

// ─── Checkout zone SVG ──────────────────────────────────────────────────────
function CheckoutZoneSvg({ checkout }) {
  return (
    <g>
      <rect x={checkout.x - 35} y={checkout.y - 25}
        width="70" height="50" rx="8"
        fill={checkout.active ? "rgba(52,211,153,0.05)" : "transparent"}
        stroke={checkout.active ? "#34d399" : "#3f3f46"}
        strokeWidth={checkout.active ? "1.5" : "1"}
        strokeDasharray={checkout.active ? "none" : "4 3"}>
        {checkout.active && (
          <animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="1.2s" repeatCount="indefinite" />
        )}
      </rect>
      <text x={checkout.x} y={checkout.y + 3} textAnchor="middle"
        fill={checkout.active ? "#34d399" : "#52525b"} fontSize="9" fontFamily="monospace"
        fontWeight="600" letterSpacing="1">
        CHECKOUT
      </text>
      {checkout.active && (
        <circle cx={checkout.x} cy={checkout.y} r="30" fill="none"
          stroke="#34d399" strokeWidth="0.5" opacity="0.3" filter="url(#glowGreen)">
          <animate attributeName="r" values="28;35;28" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  );
}

// ─── Corroboration connection lines ─────────────────────────────────────────
function CorroborationLines({ corroborations, shelves, cameras }) {
  return (
    <g>
      {corroborations
        .filter((c) => c.status === "confirmed" && c.cameraId)
        .map((c) => {
          const shelf = shelves.find((s) => s.id === c.shelfId);
          const cam = cameras.find((ca) => ca.id === c.cameraId);
          if (!shelf || !cam) return null;
          return (
            <line key={c.id}
              x1={cam.x} y1={cam.y}
              x2={shelf.x + shelf.w / 2} y2={shelf.y + shelf.h / 2}
              stroke="#34d399" strokeWidth="0.8" strokeDasharray="4 3" opacity="0.5">
              <animate attributeName="opacity" values="0.3;0.7;0.3" dur="1s" repeatCount="3" />
            </line>
          );
        })}
    </g>
  );
}

// ─── Store Floor Plan SVG ───────────────────────────────────────────────────
function StoreFloorPlan({ simulation }) {
  const { customers, shelves, cameras, doors, checkout, corroborations } = simulation;

  return (
    <div className="relative w-full bg-[#0a0a0a] rounded-xl border border-zinc-800 overflow-hidden">
      <svg
        viewBox={`0 0 ${STORE_WIDTH} ${STORE_HEIGHT}`}
        className="w-full h-auto"
        style={{ minHeight: 350 }}
      >
        <SvgDefs />

        {/* Background grid */}
        <rect width={STORE_WIDTH} height={STORE_HEIGHT} fill="#0a0a0a" />
        <rect width={STORE_WIDTH} height={STORE_HEIGHT} fill="url(#gridPattern)" />

        {/* Store boundary */}
        <rect x="15" y="15" width={STORE_WIDTH - 30} height={STORE_HEIGHT - 30}
          rx="8" fill="none" stroke="#27272a" strokeWidth="1" />

        {/* Ambient particles */}
        {[...Array(8)].map((_, i) => (
          <circle key={`p${i}`}
            cx={100 + i * 90} cy={250} r="1" fill="#34d399" opacity="0.15">
            <animate attributeName="cy" values={`${200 + i * 20};${180 + i * 15};${200 + i * 20}`}
              dur={`${3 + i * 0.7}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.05;0.2;0.05"
              dur={`${4 + i * 0.5}s`} repeatCount="indefinite" />
          </circle>
        ))}

        {/* Camera FOV cones (rendered first, behind everything) */}
        {cameras.map((cam) => (
          <CameraFov key={cam.id} cam={cam} />
        ))}

        {/* Corroboration connection lines */}
        <CorroborationLines corroborations={corroborations} shelves={shelves} cameras={cameras} />

        {/* Shelves */}
        {shelves.map((shelf) => (
          <ShelfSvg key={shelf.id} shelf={shelf} corroborations={corroborations} />
        ))}

        {/* Checkout zone */}
        <CheckoutZoneSvg checkout={checkout} />

        {/* Doors */}
        <DoorSvg door={doors[0]} label="ENTRY" />
        <DoorSvg door={doors[1]} label="EXIT" />

        {/* Customers */}
        {customers.map((c) => (
          <CustomerSvg key={c.id} customer={c} />
        ))}

        {/* Store title watermark */}
        <text x={STORE_WIDTH / 2} y={STORE_HEIGHT / 2} textAnchor="middle"
          fill="#1a1a1a" fontSize="48" fontFamily="monospace" fontWeight="700"
          letterSpacing="8">
          STORE
        </text>
      </svg>
    </div>
  );
}

// ─── Sidebar: Corroboration Window Monitor ──────────────────────────────────
function CorroborationMonitor({ corroborations }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  const active = corroborations.filter(
    (c) => c.status === "pending" || (now - c.timestamp < 5000)
  );

  return (
    <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-xl p-4">
      <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        Corroboration Windows
      </h3>

      {active.length === 0 ? (
        <p className="text-xs text-zinc-600 font-mono text-center py-3">No active windows</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
          {active.map((c) => {
            const remaining = Math.max(0, c.expiresAt - now);
            const frac = c.status === "pending" ? remaining / 2000 : 0;

            return (
              <div key={c.id}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs
                  ${c.status === "confirmed"
                    ? "border-emerald-800/50 bg-emerald-950/30"
                    : c.status === "expired"
                    ? "border-red-800/50 bg-red-950/30"
                    : "border-amber-800/50 bg-amber-950/20"}`}>

                {/* Status icon */}
                <span className="text-sm shrink-0">
                  {c.status === "confirmed" ? "✅" : c.status === "expired" ? "❌" : "⏳"}
                </span>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-300 truncate font-mono text-[11px]">{c.itemName}</p>
                  <p className="text-zinc-600 text-[9px] font-mono">
                    Shelf {c.shelfId} · Slot {c.slotId}
                  </p>
                </div>

                {/* Timer / Badge */}
                {c.status === "pending" ? (
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-amber-400 font-mono tabular-nums text-[11px]">
                      {(remaining / 1000).toFixed(1)}s
                    </span>
                    <div className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden mt-0.5">
                      <div className="h-full bg-amber-400 rounded-full transition-all duration-100"
                        style={{ width: `${frac * 100}%` }} />
                    </div>
                  </div>
                ) : (
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0
                    ${c.status === "confirmed"
                      ? "bg-emerald-900 text-emerald-400"
                      : "bg-red-900 text-red-400"}`}>
                    {c.status.toUpperCase()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar: MQTT Event Stream ─────────────────────────────────────────────
function MqttEventStream({ events }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length]);

  return (
    <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-xl p-4">
      <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        MQTT Event Stream
      </h3>
      <div ref={scrollRef}
        className="bg-[#0a0a0a] rounded-lg p-2 max-h-56 overflow-y-auto font-mono text-[10px] leading-relaxed
                   scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
        {events.length === 0 ? (
          <p className="text-zinc-700 text-center py-4">Awaiting events…</p>
        ) : (
          events.map((evt) => (
            <div key={evt.id} className="flex gap-2 py-0.5 border-b border-zinc-900/50 hover:bg-zinc-900/50">
              <span className="text-zinc-700 shrink-0 tabular-nums w-16">
                {fmt.ts(evt.timestamp)}
              </span>
              <span className={`shrink-0 w-32 truncate ${getTopicColor(evt.topic)}`}>
                {evt.topic}
              </span>
              <span className="text-zinc-400 truncate flex-1">{evt.description}</span>
              {evt.level !== "INFO" && (
                <span className={`shrink-0 px-1 py-0 rounded text-[8px]
                  ${LEVEL_BADGE[evt.level] ?? LEVEL_BADGE.INFO}`}>
                  {evt.level}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Sidebar: Active Sessions ───────────────────────────────────────────────
function ActiveSessionsPanel({ customers }) {
  if (customers.length === 0) {
    return (
      <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-xl p-4">
        <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-3">
          Active Sessions
        </h3>
        <p className="text-xs text-zinc-600 font-mono text-center py-3">No customers in store</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-xl p-4">
      <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-3">
        Active Sessions ({customers.length})
      </h3>
      <div className="flex flex-col gap-1.5">
        {customers.map((c) => (
          <div key={c.id}
            className="flex items-center gap-2 bg-zinc-800/40 rounded-lg px-2.5 py-2 border border-zinc-700/30">
            {/* Color dot */}
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />

            {/* Session info */}
            <div className="flex-1 min-w-0">
              <span className="text-zinc-400 text-[10px] font-mono">
                #{String(c.sessionId).slice(-8)}
              </span>
            </div>

            {/* Item count */}
            <span className="text-zinc-500 text-[10px] font-mono">
              {c.cart.length} item{c.cart.length !== 1 ? "s" : ""}
            </span>

            {/* Total */}
            <span className="text-emerald-400 text-[11px] font-mono tabular-nums">
              {fmt.cents(c.cart.reduce((s, item) => s + item.price, 0))}
            </span>

            {/* State badge */}
            <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full shrink-0
              ${c.state === "checkout" ? "bg-amber-950 text-amber-400"
                : c.state === "entering" ? "bg-blue-950 text-blue-400"
                : c.state === "leaving" ? "bg-zinc-800 text-zinc-400"
                : "bg-emerald-950 text-emerald-400"}`}>
              {c.state === "checkout" ? "CHECKOUT"
                : c.state === "entering" ? "ENTERING"
                : c.state === "leaving" ? "LEAVING"
                : "ACTIVE"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sidebar: Camera AI Feed ────────────────────────────────────────────────
function CameraAiFeed({ cameras }) {
  return (
    <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-xl p-4">
      <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-purple-400" />
        Camera AI Feed
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {cameras.map((cam) => {
          const scoreColor =
            cam.anomalyScore >= 0.85 ? "bg-red-500" :
            cam.anomalyScore >= 0.60 ? "bg-amber-400" :
            cam.anomalyScore >= 0.30 ? "bg-emerald-400" :
            "bg-zinc-600";

          return (
            <div key={cam.id}
              className={`rounded-lg border p-2 relative overflow-hidden
                ${cam.anomalyScore >= 0.85
                  ? "border-red-800 bg-red-950/20"
                  : cam.anomalyScore >= 0.60
                  ? "border-amber-800/50 bg-amber-950/10"
                  : "border-zinc-800 bg-zinc-900/50"}`}>

              {/* Simulated bounding box overlay */}
              {cam.active && cam.anomalyScore >= 0.60 && (
                <div className="absolute inset-1 border border-dashed rounded
                  pointer-events-none"
                  style={{
                    borderColor: cam.anomalyScore >= 0.85 ? "#ef4444" : "#fbbf24",
                    opacity: 0.4,
                  }} />
              )}

              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-mono text-zinc-400">CAM {cam.id}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${cam.active ? "bg-emerald-400" : "bg-zinc-600"}`} />
              </div>

              {/* Anomaly score bar */}
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mb-1">
                <div className={`h-full rounded-full transition-all duration-500 ${scoreColor}`}
                  style={{ width: `${cam.anomalyScore * 100}%` }} />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[8px] text-zinc-600 font-mono">
                  {cam.anomalyScore.toFixed(2)}
                </span>
                <span className={`text-[7px] font-mono px-1 rounded
                  ${cam.eventClass === "Concealment" ? "text-red-400 bg-red-950"
                    : cam.eventClass === "Bypass" ? "text-amber-400 bg-amber-950"
                    : cam.eventClass === "Loiter" ? "text-purple-400 bg-purple-950"
                    : "text-zinc-500 bg-zinc-800"}`}>
                  {cam.eventClass}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Top Bar (Simulation Controls Toolbar) ──────────────────────────────────
function TopBar({ simulation }) {
  const { stats, isPaused, togglePause, speed, setSpeed } = simulation;

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/60 backdrop-blur-md px-4 py-2.5 flex items-center gap-4 flex-wrap">
      {/* Controls indicator */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">SIM CONTROL</span>
        {/* Play / Pause */}
        <button onClick={togglePause}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all
            ${isPaused
              ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-950/60"
              : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}>
          {isPaused ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          )}
          {isPaused ? "PLAY" : "PAUSE"}
        </button>

        {/* Speed selector */}
        <div className="flex items-center border border-zinc-850 rounded-lg overflow-hidden">
          {[1, 2, 4].map((s) => (
            <button key={s} onClick={() => setSpeed(s)}
              className={`px-2.5 py-1.5 text-[10px] font-mono transition-all
                ${speed === s
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"}`}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1" />

      {/* Stats */}
      <div className="flex items-center gap-5 text-[10px] font-mono">
        <div className="flex flex-col items-end">
          <span className="text-zinc-650 text-[9px] uppercase tracking-wider">SESSIONS</span>
          <span className="text-zinc-200 tabular-nums font-semibold">{stats.totalSessions}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-zinc-650 text-[9px] uppercase tracking-wider">ITEMS IN CART</span>
          <span className="text-emerald-400 tabular-nums font-semibold">{stats.totalItems}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-zinc-650 text-[9px] uppercase tracking-wider">REVENUE</span>
          <span className="text-emerald-400 tabular-nums font-semibold">{fmt.cents(stats.totalRevenue)}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-zinc-650 text-[9px] uppercase tracking-wider">INCIDENTS</span>
          <span className={`tabular-nums font-semibold ${stats.totalIncidents > 0 ? "text-rose-450" : "text-zinc-400"}`}>
            {stats.totalIncidents}
          </span>
        </div>
      </div>
    </header>
  );
}

// ─── Main StoreSimulation Component ─────────────────────────────────────────
export default function StoreSimulation() {
  const [state, dispatch] = useReducer(wsReducer, initialState);
  const simulation = useStoreSimulation(dispatch);

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col pt-16 overflow-hidden">
      {/* Top Bar */}
      <TopBar simulation={simulation} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
        {/* Left: Store Floor Plan (65%) */}
        <div className="lg:w-[65%] flex flex-col gap-3 overflow-hidden">
          <StoreFloorPlan simulation={simulation} />

          {/* Mini legend */}
          <div className="flex items-center gap-4 px-2 text-[9px] font-mono text-zinc-600 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Camera OK
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> Warning
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" /> Critical
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 rounded bg-emerald-900 border border-emerald-700" /> Shelf slot
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 rounded bg-amber-900 border border-amber-700" /> Pending corroboration
            </span>
          </div>
        </div>

        {/* Right: Sidebar (35%) */}
        <div className="lg:w-[35%] flex flex-col gap-3 overflow-y-auto h-full
                        scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent pb-4">
          <CorroborationMonitor corroborations={simulation.corroborations} />
          <MqttEventStream events={simulation.events} />
          <ActiveSessionsPanel customers={simulation.customers} />
          <CameraAiFeed cameras={simulation.cameras} />
        </div>
      </div>
    </div>
  );
}
