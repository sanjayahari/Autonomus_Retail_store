// src/NavBar.jsx
// Autonomous Retail — Global Navigation Bar
// Glassmorphism fixed top nav with responsive hamburger menu

import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

const NAV_LINKS = [
  { to: "/",           label: "Home",            icon: "◆" },
  { to: "/simulation", label: "Live Simulation", icon: "◎" },
  { to: "/dashboard",  label: "Dashboard",       icon: "▦" },
];

export default function NavBar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isHome = location.pathname === "/";
  const showGlass = scrolled || !isHome;

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500
        ${showGlass ? "nav-glass shadow-lg shadow-black/20" : "bg-transparent"}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-700/50
                            flex items-center justify-center transition-all duration-300
                            group-hover:bg-emerald-500/25 group-hover:border-emerald-600
                            group-hover:shadow-lg group-hover:shadow-emerald-900/30">
              <span className="text-emerald-400 text-base font-bold">∅</span>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-semibold tracking-tight text-zinc-100
                             group-hover:text-white transition-colors">
                Autonomous Retail
              </h1>
              <p className="text-[10px] text-zinc-600 font-mono leading-tight">
                Edge Intelligence Platform
              </p>
            </div>
          </Link>

          {/* Desktop navigation */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const active = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm
                    transition-all duration-300
                    ${active
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-800/50"
                      : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                >
                  <span className="text-xs">{link.icon}</span>
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Demo mode badge */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full
                            bg-indigo-950/60 border border-indigo-800/40 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-indigo-400">DEMO</span>
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden flex flex-col gap-1.5 p-2 rounded-lg
                         hover:bg-zinc-800/50 transition-colors"
              aria-label="Toggle menu"
            >
              <span className={`w-5 h-0.5 bg-zinc-400 transition-all duration-300
                ${menuOpen ? "rotate-45 translate-y-2" : ""}`} />
              <span className={`w-5 h-0.5 bg-zinc-400 transition-all duration-300
                ${menuOpen ? "opacity-0" : ""}`} />
              <span className={`w-5 h-0.5 bg-zinc-400 transition-all duration-300
                ${menuOpen ? "-rotate-45 -translate-y-2" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div
        className={`md:hidden overflow-hidden transition-all duration-300
          ${menuOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="glass-strong px-4 pb-4 pt-2 space-y-1 border-t border-zinc-800/50">
          {NAV_LINKS.map((link) => {
            const active = location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm
                  transition-all duration-200
                  ${active
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-800/50"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
              >
                <span>{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
          <div className="flex items-center gap-2 px-4 py-2 mt-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-indigo-400 text-xs font-mono">DEMO MODE</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
