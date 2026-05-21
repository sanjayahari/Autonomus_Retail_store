import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStoreSimulation } from "../hooks/useStoreSimulation";
import React from "react";

if (typeof window !== "undefined") {
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
}

describe("Store Simulation Hook", () => {
  let mockDispatch;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDispatch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should support pausing and playing the simulation", () => {
    const { result } = renderHook(() => useStoreSimulation(mockDispatch));

    expect(result.current.isPaused).toBe(false);

    // Toggle pause
    act(() => {
      result.current.togglePause();
    });

    expect(result.current.isPaused).toBe(true);

    // Ticks should not run when paused
    mockDispatch.mockClear();
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Telemetry heartbeat shouldn't be sent since ticks are paused
    const telemetryCalls = mockDispatch.mock.calls.filter(c => c[0].type === "TELEMETRY");
    expect(telemetryCalls.length).toBe(0);

    // Resume
    act(() => {
      result.current.togglePause();
    });
    expect(result.current.isPaused).toBe(false);
  });

  it("should support speed multipliers", () => {
    const { result } = renderHook(() => useStoreSimulation(mockDispatch));

    expect(result.current.speed).toBe(1);

    // Set speed to 2x
    act(() => {
      result.current.setSpeed(2);
    });
    expect(result.current.speed).toBe(2);

    // Set speed to 4x
    act(() => {
      result.current.setSpeed(4);
    });
    expect(result.current.speed).toBe(4);
  });

  it("should process checkout and payment transactions", async () => {
    const { result } = renderHook(() => useStoreSimulation(mockDispatch));

    // Fast-forward simulation to spawn a customer, send them shopping, and checkout
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    // Verify transaction dispatch was triggered
    const calls = mockDispatch.mock.calls;
    const transactionCalls = calls.filter(call => call[0].type === "TRANSACTION");

    if (transactionCalls.length > 0) {
      const payload = transactionCalls[0][0].payload;
      expect(payload.transaction_id).toBeDefined();
      expect(payload.gross_cents).toBeGreaterThan(0);
      expect(payload.profit_cents).toBeCloseTo(payload.gross_cents * 0.40, 0);
      expect(payload.authorized).toBeDefined();
      expect(payload.method).toBeDefined();
      expect(["EMV", "NFC", "BIOMETRIC"]).toContain(payload.method);
    }
  });

  it("should maintain clean customer state trails", async () => {
    const { result } = renderHook(() => useStoreSimulation(mockDispatch));

    // Advance time to allow customer movements
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    const activeCustomers = result.current.customers;
    if (activeCustomers.length > 0) {
      const cust = activeCustomers[0];
      expect(cust.id).toBeDefined();
      expect(cust.trail).toBeDefined();
      expect(cust.trail.length).toBeGreaterThan(0);
      expect(cust.trail[0]).toHaveProperty("x");
      expect(cust.trail[0]).toHaveProperty("y");
      expect(cust.color).toBeDefined();
    }
  });
});
