// src/AnimatedCounter.jsx
// Autonomous Retail — Animated Number Counter
// Smoothly counts from 0 to target using requestAnimationFrame

import { useEffect, useRef, useState } from "react";

/**
 * AnimatedCounter — smoothly animates a number from 0 (or `from`) to `to`.
 *
 * @param {number}  to        Target number
 * @param {number}  from      Start number (default 0)
 * @param {number}  duration  Animation duration in ms (default 2000)
 * @param {string}  prefix    Text before the number (e.g. "$")
 * @param {string}  suffix    Text after the number (e.g. "ms")
 * @param {number}  decimals  Decimal places (default 0)
 * @param {boolean} animate   Whether to animate (default true; false = show final)
 * @param {string}  className Additional CSS classes
 */
export default function AnimatedCounter({
  to,
  from = 0,
  duration = 2000,
  prefix = "",
  suffix = "",
  decimals = 0,
  animate = true,
  className = "",
}) {
  const [display, setDisplay] = useState(animate ? from : to);
  const frameRef = useRef(null);
  const startTimeRef = useRef(null);
  const observerRef = useRef(null);
  const elementRef = useRef(null);
  const hasAnimated = useRef(false);

  // Easing: ease-out cubic
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const startAnimation = () => {
    if (hasAnimated.current) return;
    hasAnimated.current = true;
    startTimeRef.current = performance.now();

    const tick = (now) => {
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const current = from + (to - from) * eased;

      setDisplay(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (!animate) {
      setDisplay(to);
      return;
    }

    // Use IntersectionObserver to start animation when visible
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          startAnimation();
          observerRef.current?.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    if (elementRef.current) {
      observerRef.current.observe(elementRef.current);
    }

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      observerRef.current?.disconnect();
    };
  }, [to, from, duration, animate]);

  const formatted = decimals > 0
    ? display.toFixed(decimals)
    : Math.round(display).toLocaleString();

  return (
    <span ref={elementRef} className={`tabular-nums ${className}`}>
      {prefix}{formatted}{suffix}
    </span>
  );
}
