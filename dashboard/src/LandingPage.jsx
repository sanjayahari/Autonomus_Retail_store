// src/LandingPage.jsx
// Autonomous Retail — Scroll-driven 3D Landing Page
// GSAP ScrollTrigger + react-three-fiber overlay experience

import { useRef, useState, useEffect, useCallback } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Canvas } from '@react-three/fiber';
import StoreScene from './StoreScene';
import AnimatedCounter from './AnimatedCounter';
import { Link } from 'react-router-dom';

gsap.registerPlugin(ScrollTrigger);

// ─── SVG Icons (inline) ──────────────────────────────────────────────────────

const ShelfIcon = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <rect x="6" y="4" width="3" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
    <rect x="11" y="4" width="2" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
    <rect x="7" y="10" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
    <rect x="14" y="10" width="3" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
  </svg>
);

const CameraIcon = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const CheckIcon = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12l3 3 5-6" />
  </svg>
);

const TimerIcon = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="12" cy="13" r="9" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="13" x2="15" y2="15" />
    <line x1="10" y1="2" x2="14" y2="2" />
  </svg>
);

const QueueIcon = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="4" width="6" height="6" rx="1" />
    <rect x="9" y="4" width="6" height="6" rx="1" />
    <rect x="16" y="4" width="6" height="6" rx="1" />
    <path d="M5 14v4h14v-4" strokeDasharray="2 2" />
    <path d="M8 10l4 4 4-4" />
  </svg>
);

const HashIcon = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </svg>
);

const CpuIcon = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
    <line x1="8" y1="2" x2="8" y2="4" /><line x1="12" y1="2" x2="12" y2="4" /><line x1="16" y1="2" x2="16" y2="4" />
    <line x1="8" y1="20" x2="8" y2="22" /><line x1="12" y1="20" x2="12" y2="22" /><line x1="16" y1="20" x2="16" y2="22" />
    <line x1="2" y1="8" x2="4" y2="8" /><line x1="2" y1="12" x2="4" y2="12" /><line x1="2" y1="16" x2="4" y2="16" />
    <line x1="20" y1="8" x2="22" y2="8" /><line x1="20" y1="12" x2="22" y2="12" /><line x1="20" y1="16" x2="22" y2="16" />
  </svg>
);

const ChevronDown = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

// ─── Anomaly Gauge SVG ────────────────────────────────────────────────────────

function AnomalyGauge({ score = 0.72, threshold = 0.85, className = '' }) {
  const radius = 70;
  const circumference = Math.PI * radius; // half-circle
  const scoreOffset = circumference * (1 - score);
  const thresholdAngle = -180 + threshold * 180;

  return (
    <svg viewBox="0 0 200 115" className={className}>
      {/* Background arc */}
      <path
        d="M 15 100 A 70 70 0 0 1 185 100"
        fill="none"
        stroke="#27272a"
        strokeWidth="10"
        strokeLinecap="round"
      />
      {/* Score arc */}
      <path
        d="M 15 100 A 70 70 0 0 1 185 100"
        fill="none"
        stroke="url(#gaugeGrad)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${circumference}`}
        strokeDashoffset={scoreOffset}
        className="transition-all duration-1000"
      />
      {/* Threshold line */}
      <line
        x1={100 + radius * Math.cos((thresholdAngle * Math.PI) / 180)}
        y1={100 + radius * Math.sin((thresholdAngle * Math.PI) / 180)}
        x2={100 + (radius + 14) * Math.cos((thresholdAngle * Math.PI) / 180)}
        y2={100 + (radius + 14) * Math.sin((thresholdAngle * Math.PI) / 180)}
        stroke="#ef4444"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <text
        x={100 + (radius + 22) * Math.cos((thresholdAngle * Math.PI) / 180)}
        y={100 + (radius + 22) * Math.sin((thresholdAngle * Math.PI) / 180)}
        fill="#ef4444"
        fontSize="8"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {threshold}
      </text>
      {/* Score text */}
      <text x="100" y="90" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold">
        {score.toFixed(2)}
      </text>
      <text x="100" y="108" textAnchor="middle" fill="#a1a1aa" fontSize="8">
        Anomaly Score
      </text>
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="60%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Glass Panel ──────────────────────────────────────────────────────────────

function GlassPanel({ children, className = '' }) {
  return (
    <div className={`bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl ${className}`}>
      {children}
    </div>
  );
}

// ─── Timeline Step ────────────────────────────────────────────────────────────

function TimelineStep({ icon: Icon, label, description, active, index }) {
  return (
    <div className={`flex items-start gap-4 transition-all duration-500 ${active ? 'opacity-100 translate-x-0' : 'opacity-20 translate-x-4'}`}>
      <div className="flex flex-col items-center">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-500 ${
          active
            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-400 shadow-lg shadow-emerald-500/20'
            : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500'
        }`}>
          <Icon className="w-5 h-5" />
        </div>
        {index < 3 && (
          <div className={`w-px h-8 transition-colors duration-500 ${active ? 'bg-emerald-500/40' : 'bg-zinc-700/30'}`} />
        )}
      </div>
      <div className="pt-2">
        <p className={`text-sm font-semibold transition-colors duration-500 ${active ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {label}
        </p>
        <p className={`text-xs mt-0.5 transition-colors duration-500 ${active ? 'text-zinc-300' : 'text-zinc-600'}`}>
          {description}
        </p>
      </div>
    </div>
  );
}

// ─── Event Badge ──────────────────────────────────────────────────────────────

function EventBadge({ label, type = 'normal' }) {
  const styles = {
    normal:      'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    concealment: 'bg-red-500/10 border-red-500/30 text-red-400',
    bypass:      'bg-amber-500/10 border-amber-500/30 text-amber-400',
    loiter:      'bg-indigo-500/10 border-indigo-500/30 text-indigo-400',
  };
  return (
    <span className={`inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-mono font-medium ${styles[type]}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-2 ${
        type === 'normal' ? 'bg-emerald-400' : type === 'concealment' ? 'bg-red-400' : type === 'bypass' ? 'bg-amber-400' : 'bg-indigo-400'
      }`} />
      {label}
    </span>
  );
}

// ─── Tech Badge ───────────────────────────────────────────────────────────────

function TechBadge({ label }) {
  return (
    <div className="group relative bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 hover:border-emerald-500/30 rounded-xl px-5 py-3 text-center transition-all duration-300 cursor-default">
      <span className="text-sm font-mono text-zinc-300 group-hover:text-emerald-400 transition-colors">
        {label}
      </span>
      {/* Glow effect on hover */}
      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-emerald-500/5 blur-sm pointer-events-none" />
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ value, label, prefix = '', suffix = '', decimals = 0 }) {
  return (
    <div className="text-center px-4">
      <div className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300 font-mono">
        <AnimatedCounter to={value} prefix={prefix} suffix={suffix} duration={2200} decimals={decimals} />
      </div>
      <div className="text-xs text-zinc-500 mt-1 font-medium uppercase tracking-wider">{label}</div>
    </div>
  );
}

// ─── Active Session Dots ──────────────────────────────────────────────────────

function SessionDots({ count = 50 }) {
  const dots = Array.from({ length: count });
  return (
    <div className="flex flex-wrap justify-center gap-1.5 max-w-md mx-auto">
      {dots.map((_, i) => (
        <div
          key={i}
          className="w-2 h-2 rounded-full bg-emerald-500/60"
          style={{
            animation: `pulse 2s ease-in-out ${i * 0.05}s infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Camera Feed Mockup ───────────────────────────────────────────────────────

function CameraFeedPanel({ label, boundingBoxes = [] }) {
  return (
    <div className="relative bg-zinc-900/80 border border-zinc-700/50 rounded-lg overflow-hidden aspect-video">
      {/* Static noise background */}
      <div className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.5'/%3E%3C/svg%3E")`,
          backgroundSize: '128px 128px',
        }}
      />
      {/* Bounding boxes */}
      {boundingBoxes.map((box, i) => (
        <div
          key={i}
          className="absolute border-2 border-emerald-400/60 rounded"
          style={{
            left: `${box.x}%`, top: `${box.y}%`,
            width: `${box.w}%`, height: `${box.h}%`,
            animation: `pulse 1.5s ease-in-out ${i * 0.3}s infinite alternate`,
          }}
        >
          <span className="absolute -top-5 left-0 text-[10px] font-mono text-emerald-400 bg-zinc-900/80 px-1 rounded">
            {box.label}
          </span>
        </div>
      ))}
      {/* Label */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[10px] font-mono text-zinc-400">{label}</span>
      </div>
      {/* Timestamp */}
      <div className="absolute bottom-2 right-2 text-[10px] font-mono text-zinc-500">
        {new Date().toISOString().slice(11, 19)}
      </div>
    </div>
  );
}

// ─── Architecture Flow ────────────────────────────────────────────────────────

function ArchitectureFlow({ className = '' }) {
  const nodes = [
    { label: 'Physical Hardware', sub: 'HX711 · USB Cameras', color: 'from-zinc-600 to-zinc-700' },
    { label: 'Edge Engine (C++)', sub: 'RT Processing', color: 'from-emerald-600 to-emerald-800' },
    { label: 'Cloud API (Node.js)', sub: 'REST + WebSocket', color: 'from-indigo-600 to-indigo-800' },
    { label: 'Dashboard (React)', sub: 'Real-time UI', color: 'from-teal-600 to-teal-800' },
  ];
  const connections = ['MQTT', 'WebSocket', 'PostgreSQL'];

  return (
    <div className={`flex flex-col md:flex-row items-center justify-center gap-0 ${className}`}>
      {nodes.map((node, i) => (
        <div key={i} className="flex items-center">
          <div className={`bg-gradient-to-br ${node.color} rounded-xl px-5 py-4 border border-white/10 min-w-[160px] text-center`}>
            <div className="text-sm font-semibold text-white">{node.label}</div>
            <div className="text-[10px] text-white/50 mt-0.5">{node.sub}</div>
          </div>
          {i < nodes.length - 1 && (
            <div className="flex flex-col items-center mx-1">
              <div className="text-[9px] font-mono text-zinc-500 mb-1">{connections[i]}</div>
              <div className="w-8 md:w-12 h-px bg-gradient-to-r from-emerald-500/60 to-indigo-500/60 relative">
                <div
                  className="absolute top-0 left-0 h-full w-3 bg-emerald-400/80 rounded-full"
                  style={{ animation: 'slideRight 2s ease-in-out infinite' }}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN LANDING PAGE ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export default function LandingPage() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [alertFlash, setAlertFlash] = useState(false);
  const [activeTimelineStep, setActiveTimelineStep] = useState(0);

  // Section refs
  const containerRef     = useRef(null);
  const heroRef          = useRef(null);
  const heroContentRef   = useRef(null);
  const sensorRef        = useRef(null);
  const sensorPanelRef   = useRef(null);
  const sessionRef       = useRef(null);
  const sessionCardsRef  = useRef(null);
  const securityRef      = useRef(null);
  const securityInnerRef = useRef(null);
  const techRef          = useRef(null);
  const ctaRef           = useRef(null);

  // ── GSAP setup ────────────────────────────────────────────────────────────

  useEffect(() => {
    const ctx = gsap.context(() => {
      // ─ Global scroll progress (drives 3D scene camera) ────────────────
      ScrollTrigger.create({
        trigger: containerRef.current,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.5,
        onUpdate: (self) => setScrollProgress(self.progress),
      });

      // ─ Hero: fade out content on scroll ────────────────────────────────
      gsap.to(heroContentRef.current, {
        opacity: 0,
        y: -60,
        scale: 0.95,
        ease: 'power2.in',
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'top top',
          end: '60% top',
          scrub: 1,
        },
      });

      // ─ Section 2: Sensor Fusion — pinned ──────────────────────────────
      const sensorTl = gsap.timeline({
        scrollTrigger: {
          trigger: sensorRef.current,
          start: 'top top',
          end: '+=150%',
          pin: true,
          scrub: 1,
        },
      });

      // Animate panel in
      sensorTl.fromTo(
        sensorPanelRef.current,
        { opacity: 0, x: -80 },
        { opacity: 1, x: 0, duration: 0.3 },
      );

      // Timeline steps
      sensorTl.to({}, {
        duration: 0.2,
        onUpdate() { setActiveTimelineStep(0); },
      });
      sensorTl.to({}, {
        duration: 0.2,
        onUpdate() { setActiveTimelineStep(1); },
      });
      sensorTl.to({}, {
        duration: 0.2,
        onUpdate() { setActiveTimelineStep(2); },
      });
      sensorTl.to({}, {
        duration: 0.2,
        onUpdate() { setActiveTimelineStep(3); },
      });

      // ─ Section 3: Session Management — entrance ───────────────────────
      gsap.from(sessionCardsRef.current?.children || [], {
        y: 60,
        opacity: 0,
        stagger: 0.1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: sessionRef.current,
          start: 'top 70%',
          end: 'top 30%',
          scrub: 1,
        },
      });

      // ─ Section 4: Security — pinned ───────────────────────────────────
      const secTl = gsap.timeline({
        scrollTrigger: {
          trigger: securityRef.current,
          start: 'top top',
          end: '+=120%',
          pin: true,
          scrub: 1,
        },
      });

      secTl.fromTo(
        securityInnerRef.current,
        { opacity: 0, y: 40 },
        { opacity: 1, y: 0, duration: 0.4 },
      );

      // Alert flash at midpoint
      secTl.to({}, {
        duration: 0.1,
        onComplete: () => {
          setAlertFlash(true);
          setTimeout(() => setAlertFlash(false), 600);
        },
      });

      // ─ Section 5: Tech Stack — entrance ───────────────────────────────
      gsap.from(techRef.current, {
        y: 80,
        opacity: 0,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: techRef.current,
          start: 'top 80%',
          end: 'top 40%',
          scrub: 1,
        },
      });

      // ─ Section 6: CTA — entrance ──────────────────────────────────────
      gsap.from(ctaRef.current, {
        y: 60,
        opacity: 0,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: ctaRef.current,
          start: 'top 85%',
          end: 'top 55%',
          scrub: 1,
        },
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Pulse animation keyframes ─────────────────────────────────────── */}
      <style>{`
        @keyframes pulse {
          0%   { opacity: 0.4; transform: scale(0.9); }
          100% { opacity: 1;   transform: scale(1.1); }
        }
        @keyframes slideRight {
          0%   { transform: translateX(0); }
          100% { transform: translateX(calc(100% + 2rem)); }
        }
        @keyframes bounceArrow {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(8px); }
        }
      `}</style>

      {/* ── Fixed 3D Canvas Background ────────────────────────────────────── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: false }}
          camera={{ fov: 50, near: 0.1, far: 100 }}
          style={{ background: '#09090b' }}
        >
          <StoreScene scrollProgress={scrollProgress} />
        </Canvas>
      </div>

      {/* ── Alert flash overlay ───────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 z-50 pointer-events-none border-4 border-red-500/0 transition-all duration-200 ${
          alertFlash ? 'border-red-500/60 bg-red-500/5' : ''
        }`}
      />

      {/* ── Scrollable Content Container ──────────────────────────────────── */}
      <div ref={containerRef} className="relative z-10">

        {/* ════════ SECTION 1 — HERO ════════════════════════════════════════ */}
        <section ref={heroRef} className="relative h-screen flex flex-col items-center justify-center px-6">
          <div ref={heroContentRef} className="text-center max-w-4xl mx-auto">
            {/* Overline */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 mb-8">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-mono text-emerald-400 tracking-wider uppercase">System Online</span>
            </div>

            {/* Title */}
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-extrabold leading-none mb-6">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400">
                Autonomous
              </span>
              <br />
              <span className="text-white">Retail</span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg md:text-xl text-zinc-400 max-w-xl mx-auto mb-12 leading-relaxed">
              Zero checkout. Zero friction. <span className="text-zinc-200 font-medium">Total intelligence.</span>
            </p>

            {/* Stats bar */}
            <div className="flex flex-wrap justify-center gap-6 md:gap-10">
              {[
                { value: '50+', label: 'Concurrent Sessions' },
                { value: '<2s', label: 'Corroboration' },
                { value: '<10ms', label: 'MQTT Latency' },
                { value: '40%', label: 'Gross Margins' },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-xl md:text-2xl font-bold font-mono text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
                    {stat.value}
                  </div>
                  <div className="text-[10px] md:text-xs text-zinc-500 uppercase tracking-wider mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Scroll to explore</span>
            <ChevronDown className="w-5 h-5 text-zinc-500" style={{ animation: 'bounceArrow 1.5s ease-in-out infinite' }} />
          </div>
        </section>

        {/* ════════ SECTION 2 — SENSOR FUSION ═══════════════════════════════ */}
        <section ref={sensorRef} className="relative h-screen flex items-center px-6 md:px-12 lg:px-20">
          <div ref={sensorPanelRef} className="w-full max-w-lg">
            <GlassPanel className="p-8">
              <div className="mb-6">
                <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">Core Algorithm</span>
                <h2 className="text-2xl md:text-3xl font-bold text-white mt-2 leading-tight">
                  Dual-Signal<br />Corroboration
                </h2>
              </div>

              {/* Timeline */}
              <div className="space-y-1 mb-6">
                <TimelineStep
                  icon={ShelfIcon}
                  label="Weight Event Detected"
                  description="HX711 load-cell registers delta ≥ 5g"
                  active={activeTimelineStep >= 0}
                  index={0}
                />
                <TimelineStep
                  icon={TimerIcon}
                  label="2-Second Window Opens"
                  description="Corroboration timer starts counting"
                  active={activeTimelineStep >= 1}
                  index={1}
                />
                <TimelineStep
                  icon={CameraIcon}
                  label="Camera Corroborates"
                  description="YOLO v8 confirms hand-in-shelf event"
                  active={activeTimelineStep >= 2}
                  index={2}
                />
                <TimelineStep
                  icon={CheckIcon}
                  label="Cart Updated"
                  description="Session cart mutated, client notified via WS"
                  active={activeTimelineStep >= 3}
                  index={3}
                />
              </div>

              <div className="border-t border-white/5 pt-4">
                <p className="text-xs text-zinc-400 leading-relaxed italic">
                  "No cart mutation from weight alone. No theft flag from camera alone."
                </p>
              </div>
            </GlassPanel>
          </div>
        </section>

        {/* ════════ SECTION 3 — SESSION MANAGEMENT ══════════════════════════ */}
        <section ref={sessionRef} className="relative min-h-screen flex flex-col items-center justify-center py-20 px-6">
          {/* Scrim for readability */}
          <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm" />

          <div className="relative z-10 w-full max-w-5xl mx-auto text-center">
            {/* Big number */}
            <div className="mb-4">
              <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">Capacity</span>
            </div>
            <div className="text-8xl md:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400 mb-2 font-mono">
              64
            </div>
            <p className="text-lg text-zinc-400 mb-8">Max Concurrent Sessions</p>

            {/* Session dots */}
            <div className="mb-14">
              <SessionDots count={50} />
            </div>

            {/* Feature cards */}
            <div ref={sessionCardsRef} className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <GlassPanel className="p-6 text-left">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
                  <QueueIcon className="w-5 h-5" />
                </div>
                <h3 className="text-base font-semibold text-white mb-1">Lock-Free Ring Buffer</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  SPSC wait-free queue — zero mutex contention between sensor ingest and event processing threads.
                </p>
              </GlassPanel>

              <GlassPanel className="p-6 text-left">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4">
                  <HashIcon className="w-5 h-5" />
                </div>
                <h3 className="text-base font-semibold text-white mb-1">O(1) SKU Lookup</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Perfect hash table for shelf→SKU mapping — constant-time product identification on every weight event.
                </p>
              </GlassPanel>

              <GlassPanel className="p-6 text-left">
                <div className="w-10 h-10 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-4">
                  <CpuIcon className="w-5 h-5" />
                </div>
                <h3 className="text-base font-semibold text-white mb-1">Cache-Line Aligned</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  64-byte aligned session structs — eliminates false sharing across CPU cores for maximum throughput.
                </p>
              </GlassPanel>
            </div>
          </div>
        </section>

        {/* ════════ SECTION 4 — SECURITY & AI ═══════════════════════════════ */}
        <section ref={securityRef} className="relative h-screen flex items-center px-6 md:px-12 lg:px-20">
          <div ref={securityInnerRef} className="w-full max-w-5xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left: Camera feeds */}
              <div className="space-y-4">
                <div className="mb-4">
                  <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">Security Layer</span>
                  <h2 className="text-2xl md:text-3xl font-bold text-white mt-2">AI-Powered Surveillance</h2>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <CameraFeedPanel
                    label="CAM-01 Entrance"
                    boundingBoxes={[
                      { x: 25, y: 30, w: 20, h: 45, label: 'Person 0.94' },
                      { x: 60, y: 35, w: 18, h: 40, label: 'Person 0.91' },
                    ]}
                  />
                  <CameraFeedPanel
                    label="CAM-03 Aisle A"
                    boundingBoxes={[
                      { x: 35, y: 25, w: 22, h: 50, label: 'Person 0.88' },
                    ]}
                  />
                </div>

                {/* Event badges */}
                <div className="flex flex-wrap gap-2 mt-4">
                  <EventBadge label="Normal" type="normal" />
                  <EventBadge label="Concealment" type="concealment" />
                  <EventBadge label="Bypass" type="bypass" />
                  <EventBadge label="Loiter" type="loiter" />
                </div>
              </div>

              {/* Right: Gauge + explanation */}
              <div className="flex flex-col items-center justify-center">
                <GlassPanel className="p-6 w-full max-w-sm">
                  <AnomalyGauge score={0.72} threshold={0.85} className="w-full max-w-[220px] mx-auto mb-4" />

                  <div className="space-y-3 text-sm text-zinc-300">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-px bg-emerald-500/60" />
                      <span className="text-xs text-zinc-400">
                        Below <span className="text-emerald-400 font-mono">0.85</span> — normal behavior
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-px bg-red-500/60" />
                      <span className="text-xs text-zinc-400">
                        Above <span className="text-red-400 font-mono">0.85</span> — security escalation
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-white/5">
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      Theft confidence threshold set at <span className="text-white font-mono">0.85</span> to minimize
                      false positives while catching <span className="text-white">concealment</span> and
                      <span className="text-white"> bypass</span> behaviors in real time.
                    </p>
                  </div>
                </GlassPanel>
              </div>
            </div>
          </div>
        </section>

        {/* ════════ SECTION 5 — TECH STACK ══════════════════════════════════ */}
        <section ref={techRef} className="relative min-h-screen flex flex-col items-center justify-center py-20 px-6">
          <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm" />

          <div className="relative z-10 w-full max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">Infrastructure</span>
              <h2 className="text-3xl md:text-4xl font-bold text-white mt-3">Full-Stack Architecture</h2>
            </div>

            {/* Architecture flow */}
            <div className="mb-16 overflow-x-auto pb-4">
              <ArchitectureFlow />
            </div>

            {/* Tech badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-16">
              {['C++17', 'MQTT', 'SQLite WAL', 'PostgreSQL', 'React 18', 'CUDA', 'Docker', 'NGINX'].map((tech) => (
                <TechBadge key={tech} label={tech} />
              ))}
            </div>

            {/* Performance stats */}
            <div className="flex flex-wrap justify-center gap-10 md:gap-16">
              <StatCard value={10} prefix="<" suffix="ms" label="Sensor Latency" />
              <StatCard value={2} suffix="s" label="Corroboration Window" />
              <StatCard value={50} prefix="" suffix="+" label="Concurrent Sessions" />
              <StatCard value={99.9} suffix="%" decimals={1} label="Uptime Target" />
            </div>
          </div>
        </section>

        {/* ════════ SECTION 6 — CTA ═════════════════════════════════════════ */}
        <section ref={ctaRef} className="relative min-h-[50vh] flex flex-col items-center justify-center py-20 px-6">
          <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm" />

          <div className="relative z-10 text-center max-w-2xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-4">
              See It <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">In Action</span>
            </h2>
            <p className="text-zinc-400 mb-10">
              Experience the future of retail — real-time sensor fusion, AI surveillance, and frictionless checkout.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/simulation"
                className="group relative inline-flex items-center justify-center px-8 py-3.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 transition-all duration-300 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40"
              >
                Live Store Simulation
                <span className="ml-2 transition-transform group-hover:translate-x-1">→</span>
              </Link>
              <Link
                to="/dashboard"
                className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl text-sm font-semibold text-zinc-300 border border-white/10 hover:border-emerald-500/30 hover:text-emerald-400 hover:bg-emerald-500/5 transition-all duration-300"
              >
                Owner Dashboard
              </Link>
            </div>

            {/* Footer */}
            <div className="mt-16 pt-8 border-t border-white/5">
              <p className="text-[11px] text-zinc-600 font-mono tracking-wide">
                Built with C++ · MQTT · SQLite · PostgreSQL · React · CUDA
              </p>
            </div>
          </div>
        </section>

      </div>
    </>
  );
}
