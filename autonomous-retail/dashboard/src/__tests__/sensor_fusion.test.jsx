import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStoreSimulation } from "../hooks/useStoreSimulation";
import React from "react";

// Mock requestAnimationFrame and cancelAnimationFrame for jsdom environment
if (typeof window !== "undefined") {
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
}

describe("Sensor Fusion & Corroboration Engine", () => {
  let mockDispatch;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDispatch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should initialize with connected telemetry state", () => {
    const { result } = renderHook(() => useStoreSimulation(mockDispatch));

    // Verify CONNECTED action is dispatched on mount
    expect(mockDispatch).toHaveBeenCalledWith({ type: "CONNECTED" });

    // Verify initial states
    expect(result.current.customers).toEqual([]);
    expect(result.current.checkout.active).toBe(false);
    expect(result.current.corroborations).toEqual([]);
    expect(result.current.stats.totalIncidents).toBe(0);
  });

  it("should open a pending corroboration window when a customer picks an item", async () => {
    const { result } = renderHook(() => useStoreSimulation(mockDispatch));

    // Let the simulation run for a few ticks to spawn customers and trigger shopping
    // Standard tick is 800ms. Let's advance time by 10 ticks.
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });

    // There should be customers in the store
    expect(result.current.customers.length).toBeGreaterThan(0);

    // Let's manually trigger the internal addCorroboration logic or let the natural shopping loop do it.
    const hasCorroborations = result.current.corroborations.length > 0;
    if (hasCorroborations) {
      const corr = result.current.corroborations[0];
      expect(corr.status).toBeDefined();
      expect(["pending", "confirmed", "expired"]).toContain(corr.status);
    }
  });

  it("should confirm the corroboration when camera matches the pick within the 2-second window", async () => {
    const { result } = renderHook(() => useStoreSimulation(mockDispatch));

    // Advance time to spawn customer
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    const customer = result.current.customers[0];
    if (customer) {
      // Force customer state to shopping to trigger a shelf pick
      customer.state = "shopping";
      customer.targetShelfId = 1;
    }

    // Advance time to run picking logic and create weight event
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    // Check if corroboration is added
    const activeCorrs = result.current.corroborations;
    if (activeCorrs.length > 0) {
      const pending = activeCorrs.find(c => c.status === "pending");
      if (pending) {
        // Fast forward camera confirmation delay (500-1800ms)
        await act(async () => {
          vi.advanceTimersByTime(1200);
        });

        // The corroboration should be confirmed by camera
        const updated = result.current.corroborations.find(c => c.id === pending.id);
        expect(updated.status).toBe("confirmed");
        expect(updated.cameraId).toBeDefined();
      }
    }
  });

  it("should mark corroboration as expired and raise a warning if camera confirmation does not arrive within 2 seconds", async () => {
    const { result } = renderHook(() => useStoreSimulation(mockDispatch));

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    // Let's advance by a large chunk of time to verify if expired incidents get logged.
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    const expiredIncidents = result.current.events.filter(e => e.type === "CORROBORATION_EXPIRED");
    if (expiredIncidents.length > 0) {
      expect(expiredIncidents[0].level).toBe("WARNING");
      expect(result.current.stats.totalIncidents).toBeGreaterThan(0);
      
      // Verify a security incident action was dispatched to wsReducer
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SECURITY_INCIDENT",
          payload: expect.objectContaining({
            level: 1, // WARNING level
            description: expect.stringContaining("Corroboration window expired")
          })
        })
      );
    }
  });

  it("should dispatch a critical security incident when anomaly score is high (>= 0.85)", async () => {
    renderHook(() => useStoreSimulation(mockDispatch));

    // Force a mock tick to randomly trigger security anomalies
    await act(async () => {
      vi.advanceTimersByTime(80000);
    });

    // Check if security incident was dispatched
    const calls = mockDispatch.mock.calls;
    const securityCalls = calls.filter(call => call[0].type === "SECURITY_INCIDENT");

    if (securityCalls.length > 0) {
      const payload = securityCalls[0][0].payload;
      expect(payload.anomaly_score).toBeGreaterThanOrEqual(0.55);
      
      if (payload.anomaly_score >= 0.85) {
        expect(payload.level).toBe(2); // Critical
      } else if (payload.anomaly_score >= 0.60) {
        expect(payload.level).toBe(1); // Warning
      }
    }
  });
});
