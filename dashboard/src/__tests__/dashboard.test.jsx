import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import OwnerDashboard from "../OwnerDashboard";

// Mock Recharts to avoid rendering inside jsdom
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  LineChart: ({ children }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  BarChart: ({ children }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
}));

// Mock WebSocket context values
vi.mock("../contexts/WebSocketContext", () => ({
  useRetailData: () => ({
    connected: true,
    activeSessions: 5,
    sessions: [
      { id: 1, state: 2, gross_cents: 1250, items: 3 },
    ],
    securityLog: [
      { incident_id: 1, level: 2, anomaly_score: 0.89, description: "Concealment alert in zone 4", received_at: Date.now() },
    ],
    transactions: [
      { transaction_id: 10001, method: "NFC", item_count: 2, gross_cents: 1500, profit_cents: 600, authorized: true, received_at: Date.now() },
    ],
    revenueTimeSeries: [
      { timestamp: Date.now(), gross_cents: 1500, profit_cents: 600 },
    ],
    cartUpdates: [
      { event: "ADDED", name: "Sparkling Water", price_cents: 199, session_id: 1 },
    ],
  }),
  useConnectionStatus: () => ({
    connected: true,
    lastPing: Date.now(),
  }),
}));

describe("OwnerDashboard Page", () => {
  it("should render the dashboard layout properly", () => {
    render(<OwnerDashboard />);

    // Check title in header
    expect(screen.getByText("Autonomous Retail")).toBeInTheDocument();

    // Check tabs
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Revenue")).toBeInTheDocument();

    // Check KPI counts
    expect(screen.getByText("Active Sessions")).toBeInTheDocument();
    expect(screen.getAllByText("5").length).toBeGreaterThanOrEqual(1); // activeSessions mock value
  });

  it("should support tab switching", async () => {
    render(<OwnerDashboard />);

    // Default tab is overview. Let's switch to sessions.
    const sessionsTab = screen.getByRole("button", { name: "Sessions" });
    fireEvent.click(sessionsTab);

    // Verify sessions tab content
    expect(screen.getByText("Active Sessions (5)")).toBeInTheDocument();
    expect(screen.getByText("Recent Transactions")).toBeInTheDocument();
  });

  it("should support selecting different stores from the store dropdown", () => {
    render(<OwnerDashboard />);

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();

    // Default selected should be Store #1
    expect(select.value).toBe("store-1");

    // Change value to Store #2 (Downtown)
    fireEvent.change(select, { target: { value: "store-2" } });
    expect(select.value).toBe("store-2");

    // Verify that the sub-title changes
    expect(screen.getByText("Edge Dashboard · Downtown")).toBeInTheDocument();

    // Verify offline banner shows
    expect(screen.getByText("OFFLINE · CACHED")).toBeInTheDocument();

    // Change value to Store #3 (Airport)
    fireEvent.change(select, { target: { value: "store-3" } });
    expect(select.value).toBe("store-3");
    expect(screen.getByText("Edge Dashboard · Airport")).toBeInTheDocument();
    expect(screen.getByText("SYNCING EDGE…")).toBeInTheDocument();
  });
});
