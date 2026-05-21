// src/hooks/useStoreSimulation.js
// Autonomous Retail Infrastructure — Interactive Store Simulation Engine
//
// A sophisticated simulation hook that models the entire autonomous retail
// pipeline: customer lifecycles with spatial positions, weight-sensor events,
// camera corroboration with 2-second confirmation windows, security anomalies,
// and an MQTT-style event stream. Designed to drive the SVG store floor plan.

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Randomness helpers ───────────────────────────────────────────────────────
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max));
const pick    = (arr)      => arr[randInt(0, arr.length)];
const uid     = ()         => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ─── Store layout constants ───────────────────────────────────────────────────
export const STORE_WIDTH  = 800;
export const STORE_HEIGHT = 500;

const SHELF_DEFS = [
  { id: 1, x: 120, y: 80,  w: 160, h: 40, slots: 4 },
  { id: 2, x: 120, y: 180, w: 160, h: 40, slots: 4 },
  { id: 3, x: 520, y: 80,  w: 160, h: 40, slots: 4 },
  { id: 4, x: 520, y: 180, w: 160, h: 40, slots: 4 },
];

const CAMERA_DEFS = [
  { id: 1, x: 50,  y: 50,  fovAngle: 60, rotation: 45   },
  { id: 2, x: 400, y: 30,  fovAngle: 90, rotation: 90   },
  { id: 3, x: 750, y: 50,  fovAngle: 60, rotation: 135  },
  { id: 4, x: 50,  y: 350, fovAngle: 60, rotation: -45  },
  { id: 5, x: 400, y: 380, fovAngle: 90, rotation: -90  },
  { id: 6, x: 750, y: 350, fovAngle: 60, rotation: -135 },
];

const DOOR_DEFS = [
  { id: 1, x: 400, y: 470 }, // entry
  { id: 2, x: 400, y: 30  }, // exit
];

const CHECKOUT_POS = { x: 650, y: 400 };

// ─── Mock catalog ─────────────────────────────────────────────────────────────
const MOCK_ITEMS = [
  { sku: 1001, name: "Sparkling Water 500ml",     price: 199, weight: 520 },
  { sku: 1002, name: "Greek Yogurt 200g",          price: 349, weight: 210 },
  { sku: 1003, name: "Granola Bar — Almond",       price: 249, weight: 45  },
  { sku: 1004, name: "Orange Juice 330ml",         price: 449, weight: 350 },
  { sku: 1005, name: "Organic Banana",             price: 79,  weight: 120 },
  { sku: 1006, name: "Cold Brew Coffee 250ml",     price: 529, weight: 270 },
  { sku: 1007, name: "Protein Shake",              price: 649, weight: 300 },
  { sku: 1008, name: "Salted Almonds 50g",         price: 299, weight: 55  },
];

const ANOMALY_DESCRIPTIONS = [
  { class: 1, desc: "Item concealment detected — jacket occlusion zone" },
  { class: 2, desc: "Customer bypassed shelf sensor zone — aisle camera" },
  { class: 3, desc: "Prolonged loitering at unmanned checkout kiosk" },
  { class: 1, desc: "Repeated shelf interaction without weight corroboration" },
  { class: 2, desc: "Sensor bypass pattern — anomaly class 2 confirmed" },
  { class: 0, desc: "Normal browsing behaviour — confidence high" },
];

const CUSTOMER_COLORS = [
  "#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa",
  "#fb923c", "#2dd4bf", "#f87171", "#818cf8", "#4ade80",
];

const PAYMENT_METHODS = ["EMV", "NFC", "BIOMETRIC"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Linearly interpolate between two values */
function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** Build initial shelf state with populated slots */
function buildShelves() {
  return SHELF_DEFS.map((def) => {
    const slotWidth = def.w / def.slots;
    const slots = Array.from({ length: def.slots }, (_, i) => {
      const item = MOCK_ITEMS[i % MOCK_ITEMS.length];
      return {
        id: `${def.id}-${i + 1}`,
        slotIndex: i,
        sku: item.sku,
        name: item.name,
        price: item.price,
        weight: item.weight,
        occupied: true,
        lastEvent: null,
        cx: def.x + slotWidth * i + slotWidth / 2,
        cy: def.y + def.h / 2,
      };
    });
    return { ...def, slots };
  });
}

/** Build initial camera state */
function buildCameras() {
  return CAMERA_DEFS.map((def) => ({
    ...def,
    active: false,
    anomalyScore: 0,
    zoneColor: "emerald",
    eventClass: "Normal",
  }));
}

/** Build initial door state */
function buildDoors() {
  return DOOR_DEFS.map((def) => ({ ...def, state: "locked" }));
}

/** Get a random position near a shelf for shopping */
function getShelfBrowsePos(shelf) {
  return {
    x: shelf.x + rand(0, shelf.w),
    y: shelf.y + shelf.h + rand(15, 45),
  };
}

// ─── Main simulation hook ─────────────────────────────────────────────────────
/**
 * useStoreSimulation — drives the full autonomous retail simulation.
 *
 * @param {Function}  dispatch        — wsReducer dispatch from WebSocketContext
 * @param {Object}   [externalConfig] — optional overrides
 * @returns {Object}  simulation state (customers, shelves, cameras, etc.)
 */
export function useStoreSimulation(dispatch, externalConfig = {}) {
  // ── Mutable simulation state (ref to avoid re-render storms) ──────────────
  const simRef = useRef({
    customers: [],
    shelves: buildShelves(),
    cameras: buildCameras(),
    doors: buildDoors(),
    checkout: { ...CHECKOUT_POS, active: false, currentSession: null },
    events: [],
    corroborations: [],
    stats: { totalSessions: 0, totalItems: 0, totalRevenue: 0, totalIncidents: 0 },
    nextCustomerId: 1,
    tickCount: 0,
    pendingTimers: [],
  });
  const tickRef = useRef(null);
  const animRef = useRef(null);

  // ── React state (rendered every animation frame) ──────────────────────────
  const [customers, setCustomers]         = useState([]);
  const [shelves, setShelves]             = useState(() => buildShelves());
  const [cameras, setCameras]             = useState(() => buildCameras());
  const [doors, setDoors]                 = useState(() => buildDoors());
  const [checkout, setCheckout]           = useState({ ...CHECKOUT_POS, active: false, currentSession: null });
  const [events, setEvents]              = useState([]);
  const [corroborations, setCorroborations] = useState([]);
  const [stats, setStats]                 = useState({ totalSessions: 0, totalItems: 0, totalRevenue: 0, totalIncidents: 0 });
  const [isPaused, setIsPaused]           = useState(false);
  const [speed, setSpeed]                 = useState(1);

  const togglePause = useCallback(() => setIsPaused((p) => !p), []);

  // ── Initialise mutable sim state ──────────────────────────────────────────
  useEffect(() => {
    // Signal connected to wsReducer
    dispatch({ type: "CONNECTED" });

    return () => {
      // Cleanup timers
      if (simRef.current) {
        simRef.current.pendingTimers.forEach((t) => clearTimeout(t));
      }
    };
  }, [dispatch]);

  // ── Event emitter ─────────────────────────────────────────────────────────
  const emitEvent = useCallback(
    (type, topic, description, level = "INFO", data = {}) => {
      const sim = simRef.current;
      if (!sim) return;

      const evt = {
        id: uid(),
        type,
        topic,
        timestamp: Date.now(),
        description,
        level,
        data,
      };
      sim.events = [evt, ...sim.events].slice(0, 30);
    },
    []
  );

  // ── Corroboration management ──────────────────────────────────────────────
  const addCorroboration = useCallback(
    (shelfId, slotId, itemName, customerId) => {
      const sim = simRef.current;
      if (!sim) return;

      const now = Date.now();
      const corr = {
        id: uid(),
        shelfId,
        slotId,
        customerId,
        timestamp: now,
        expiresAt: now + 2000,
        status: "pending",
        itemName,
        cameraId: null,
      };
      sim.corroborations = [corr, ...sim.corroborations].slice(0, 20);

      // Schedule camera confirmation (500-1800ms)
      const confirmDelay = randInt(500, 1800);
      const timer = setTimeout(() => {
        const s = simRef.current;
        if (!s) return;
        const c = s.corroborations.find((x) => x.id === corr.id);
        if (c && c.status === "pending") {
          c.status = "confirmed";
          // Pick nearest camera
          const shelf = s.shelves.find((sh) => sh.id === shelfId);
          if (shelf) {
            let minDist = Infinity;
            let bestCam = null;
            s.cameras.forEach((cam) => {
              const dx = cam.x - shelf.x;
              const dy = cam.y - shelf.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < minDist) {
                minDist = dist;
                bestCam = cam;
              }
            });
            if (bestCam) {
              c.cameraId = bestCam.id;
              bestCam.active = true;
              // Deactivate camera after a moment
              const camTimer = setTimeout(() => {
                if (simRef.current) {
                  const cam = simRef.current.cameras.find((x) => x.id === bestCam.id);
                  if (cam) cam.active = false;
                }
              }, 1200);
              s.pendingTimers.push(camTimer);
            }
          }
          emitEvent(
            "CORROBORATION",
            `camera/${c.cameraId ?? "?"}/event`,
            `Camera ${c.cameraId ?? "?"} confirmed pickup: ${itemName}`,
            "INFO",
            { shelfId, slotId, itemName, cameraId: c.cameraId }
          );
        }
      }, confirmDelay / speed);
      sim.pendingTimers.push(timer);

      // Schedule expiration check
      const expireTimer = setTimeout(() => {
        const s = simRef.current;
        if (!s) return;
        const c = s.corroborations.find((x) => x.id === corr.id);
        if (c && c.status === "pending") {
          c.status = "expired";
          s.stats.totalIncidents += 1;
          emitEvent(
            "CORROBORATION_EXPIRED",
            `shelf/${shelfId}/${slotId}/weight`,
            `Corroboration window expired: ${itemName} — no camera confirmation`,
            "WARNING",
            { shelfId, slotId, itemName }
          );
          // Dispatch a security incident for expired corroboration
          dispatch({
            type: "SECURITY_INCIDENT",
            payload: {
              type: "SECURITY_INCIDENT",
              incident_id: Math.floor(Math.random() * 0xffffffff),
              session_id: customerId ?? 0,
              camera_id: 0,
              anomaly_score: parseFloat(rand(0.55, 0.75).toFixed(3)),
              level: 1,
              event_class: 1,
              description: `Corroboration window expired for ${itemName} on shelf ${shelfId}, slot ${slotId}`,
              timestamp_us: Date.now() * 1000,
            },
          });
        }
      }, 2000 / speed);
      sim.pendingTimers.push(expireTimer);
    },
    [dispatch, emitEvent, speed]
  );

  // ── Main simulation tick ──────────────────────────────────────────────────
  useEffect(() => {
    if (!simRef.current) return;

    const intervalMs = 800 / speed;

    const tick = () => {
      const sim = simRef.current;
      if (!sim) return;

      sim.tickCount += 1;

      // ── 1. Spawn new customer (15% chance, max 6 at once) ─────────────
      if ((sim.tickCount === 1 || Math.random() < 0.15) && sim.customers.length < 6) {
        const entryDoor = sim.doors[0]; // entry door
        entryDoor.state = "open";

        const customerId = sim.nextCustomerId++;
        const color = CUSTOMER_COLORS[(customerId - 1) % CUSTOMER_COLORS.length];
        const sessionId = Math.floor(Math.random() * 0xffffffff);

        const customer = {
          id: customerId,
          x: entryDoor.x,
          y: entryDoor.y,
          targetX: entryDoor.x,
          targetY: entryDoor.y,
          state: "entering",
          sessionId,
          cart: [],
          color,
          grossCents: 0,
          actionTimer: 0,
          actionDuration: 4,   // ticks to reach first shelf
          visitedShelves: [],
          maxPicks: randInt(1, 4),
          picksDone: 0,
          trail: [{ x: entryDoor.x, y: entryDoor.y }],
        };

        // Choose first shelf target
        const shelf = pick(sim.shelves);
        const browsePos = getShelfBrowsePos(shelf);
        customer.targetX = browsePos.x;
        customer.targetY = browsePos.y;
        customer.targetShelfId = shelf.id;
        customer.actionDuration = randInt(3, 6);

        sim.customers.push(customer);
        sim.stats.totalSessions += 1;

        emitEvent(
          "DOOR_SCAN",
          `door/1/scan`,
          `Customer #${customerId} entered store (session ${String(sessionId).slice(-8)})`,
          "INFO",
          { customerId, sessionId }
        );

        // Dispatch telemetry
        dispatch({
          type: "TELEMETRY",
          payload: {
            type: "TELEMETRY",
            active_sessions: sim.customers.length,
            sessions: sim.customers.map((c) => ({
              id: c.sessionId,
              state: c.state === "entering" ? 1 : c.state === "checkout" ? 3 : 2,
              gross_cents: c.grossCents,
              items: c.cart.length,
            })),
          },
        });

        // Close door after a moment
        const doorTimer = setTimeout(() => {
          if (simRef.current) simRef.current.doors[0].state = "locked";
        }, 1500 / speed);
        sim.pendingTimers.push(doorTimer);
      }

      // ── 2. Process each customer ──────────────────────────────────────
      const toRemove = [];

      sim.customers.forEach((cust) => {
        cust.actionTimer += 1;
        const progress = Math.min(1, cust.actionTimer / cust.actionDuration);

        // Lerp position
        cust.x = lerp(cust.x, cust.targetX, 0.12 + progress * 0.15);
        cust.y = lerp(cust.y, cust.targetY, 0.12 + progress * 0.15);

        // Record trail
        const lastTrail = cust.trail[cust.trail.length - 1];
        if (lastTrail) {
          const dx = cust.x - lastTrail.x;
          const dy = cust.y - lastTrail.y;
          if (dx * dx + dy * dy > 100) {
            cust.trail.push({ x: cust.x, y: cust.y });
            if (cust.trail.length > 20) cust.trail.shift();
          }
        }

        // Check if arrived at target
        const distToTarget = Math.sqrt(
          (cust.x - cust.targetX) ** 2 + (cust.y - cust.targetY) ** 2
        );

        if (distToTarget < 15 && cust.actionTimer >= cust.actionDuration) {
          // Arrived — decide next action based on state
          switch (cust.state) {
            case "entering":
            case "walking": {
              // Arrived at shelf — start shopping
              cust.state = "shopping";
              cust.actionTimer = 0;
              cust.actionDuration = randInt(2, 4); // browse ticks before picking
              break;
            }

            case "shopping": {
              // Pick an item from the target shelf
              cust.state = "picking";
              const shelf = sim.shelves.find((s) => s.id === cust.targetShelfId);
              if (shelf) {
                const occupiedSlots = shelf.slots.filter((s) => s.occupied);
                if (occupiedSlots.length > 0) {
                  const slot = pick(occupiedSlots);
                  slot.occupied = false;
                  slot.lastEvent = Date.now();

                  const item = { sku: slot.sku, name: slot.name, price: slot.price, weight: slot.weight };
                  cust.cart.push(item);
                  cust.grossCents += item.price;
                  cust.picksDone += 1;
                  sim.stats.totalItems += 1;

                  // Weight event
                  emitEvent(
                    "WEIGHT_EVENT",
                    `shelf/${shelf.id}/${slot.slotIndex + 1}/weight`,
                    `Weight change on Shelf ${shelf.id}, Slot ${slot.slotIndex + 1}: -${item.weight}g (${item.name})`,
                    "INFO",
                    { shelfId: shelf.id, slotId: slot.id, sku: item.sku, weight: -item.weight }
                  );

                  // Add corroboration window
                  addCorroboration(shelf.id, slot.id, item.name, cust.sessionId);

                  // Dispatch cart update
                  dispatch({
                    type: "CART_UPDATE",
                    payload: {
                      type: "CART_UPDATE",
                      session_id: cust.sessionId,
                      event: "ADDED",
                      sku: item.sku,
                      name: item.name,
                      price_cents: item.price,
                    },
                  });

                  // Restock the slot after a delay (simulate restocking)
                  const restockTimer = setTimeout(() => {
                    if (simRef.current) {
                      const sh = simRef.current.shelves.find((s) => s.id === shelf.id);
                      if (sh) {
                        const sl = sh.slots.find((s) => s.id === slot.id);
                        if (sl) {
                          sl.occupied = true;
                          sl.lastEvent = null;
                        }
                      }
                    }
                  }, 15000 / speed);
                  sim.pendingTimers.push(restockTimer);
                }
              }

              // Decide: go to another shelf or checkout
              cust.actionTimer = 0;
              if (cust.picksDone < cust.maxPicks && Math.random() > 0.3) {
                // Walk to another shelf
                cust.state = "walking";
                const remainingShelves = sim.shelves.filter(
                  (s) => s.id !== cust.targetShelfId
                );
                const nextShelf = remainingShelves.length > 0 ? pick(remainingShelves) : pick(sim.shelves);
                const browsePos = getShelfBrowsePos(nextShelf);
                cust.targetX = browsePos.x;
                cust.targetY = browsePos.y;
                cust.targetShelfId = nextShelf.id;
                cust.actionDuration = randInt(3, 5);
                cust.visitedShelves.push(cust.targetShelfId);
              } else {
                // Head to checkout
                cust.state = "walking";
                cust.targetX = CHECKOUT_POS.x;
                cust.targetY = CHECKOUT_POS.y;
                cust.targetShelfId = null;
                cust.actionDuration = randInt(3, 6);
              }
              break;
            }

            case "picking": {
              // Transition already handled above; this shouldn't normally trigger
              cust.state = "walking";
              cust.actionTimer = 0;
              break;
            }

            case "checkout":
            default:
              break;
          }

          // Check if arrived at checkout area (no targetShelfId and near checkout)
          if (
            cust.targetShelfId === null &&
            cust.state === "walking" &&
            distToTarget < 30
          ) {
            cust.state = "checkout";
            cust.actionTimer = 0;
            cust.actionDuration = randInt(3, 5);

            sim.checkout.active = true;
            sim.checkout.currentSession = cust.sessionId;

            emitEvent(
              "CHECKOUT",
              `terminal/1/checkout`,
              `Customer #${cust.id} at checkout — ${cust.cart.length} items, ${(cust.grossCents / 100).toFixed(2)}`,
              "INFO",
              { customerId: cust.id, sessionId: cust.sessionId, items: cust.cart.length, total: cust.grossCents }
            );
          }

          // Process checkout completion
          if (cust.state === "checkout" && cust.actionTimer >= cust.actionDuration) {
            const gross  = cust.grossCents;
            const profit = Math.round(gross * 0.40);
            const cogs   = gross - profit;
            const txnId  = randInt(10000, 99999);
            const method = pick(PAYMENT_METHODS);

            dispatch({
              type: "TRANSACTION",
              payload: {
                type: "TRANSACTION",
                transaction_id: txnId,
                session_id: cust.sessionId,
                gross_cents: gross,
                profit_cents: profit,
                cogs_cents: cogs,
                item_count: cust.cart.length,
                authorized: Math.random() > 0.05,
                method,
              },
            });

            sim.stats.totalRevenue += gross;
            sim.checkout.active = false;
            sim.checkout.currentSession = null;

            emitEvent(
              "PAYMENT",
              `terminal/1/checkout`,
              `Payment ${method}: $${(gross / 100).toFixed(2)} — TXN #${txnId}`,
              "INFO",
              { txnId, method, gross }
            );

            // Head to exit
            cust.state = "leaving";
            cust.actionTimer = 0;
            const exitDoor = sim.doors[1]; // exit door
            cust.targetX = exitDoor.x;
            cust.targetY = exitDoor.y;
            cust.actionDuration = randInt(4, 7);

            exitDoor.state = "open";
            const doorTimer = setTimeout(() => {
              if (simRef.current) simRef.current.doors[1].state = "locked";
            }, 3000 / speed);
            sim.pendingTimers.push(doorTimer);
          }
        }

        // Check if leaving customer reached exit
        if (cust.state === "leaving") {
          const exitDoor = sim.doors[1];
          const dToExit = Math.sqrt(
            (cust.x - exitDoor.x) ** 2 + (cust.y - exitDoor.y) ** 2
          );
          if (dToExit < 25) {
            toRemove.push(cust.id);
            emitEvent(
              "DOOR_EXIT",
              `door/2/scan`,
              `Customer #${cust.id} exited store`,
              "INFO",
              { customerId: cust.id }
            );
          }
        }
      });

      // Remove exited customers
      if (toRemove.length > 0) {
        sim.customers = sim.customers.filter((c) => !toRemove.includes(c.id));
      }

      // ── 3. Security incidents (3% per tick) ───────────────────────────
      if (Math.random() < 0.03) {
        const score   = parseFloat(rand(0.55, 0.99).toFixed(3));
        const level   = score >= 0.85 ? 2 : score >= 0.60 ? 1 : 0;
        const anomaly = pick(ANOMALY_DESCRIPTIONS);
        const camId   = randInt(1, 7);
        const session = sim.customers.length > 0 ? pick(sim.customers) : null;

        const cam = sim.cameras.find((c) => c.id === camId);
        if (cam) {
          cam.anomalyScore = score;
          cam.active = true;
          cam.eventClass = anomaly.class === 1 ? "Concealment"
                         : anomaly.class === 2 ? "Bypass"
                         : anomaly.class === 3 ? "Loiter"
                         : "Normal";
          cam.zoneColor = score >= 0.85 ? "red" : score >= 0.60 ? "amber" : "emerald";

          // Reset camera after a delay
          const camResetTimer = setTimeout(() => {
            if (simRef.current) {
              const c = simRef.current.cameras.find((x) => x.id === camId);
              if (c) {
                c.anomalyScore = 0;
                c.active = false;
                c.zoneColor = "emerald";
                c.eventClass = "Normal";
              }
            }
          }, 5000 / speed);
          sim.pendingTimers.push(camResetTimer);
        }

        sim.stats.totalIncidents += 1;

        emitEvent(
          "SECURITY",
          `camera/${camId}/event`,
          anomaly.desc,
          level >= 2 ? "CRITICAL" : level >= 1 ? "WARNING" : "INFO",
          { cameraId: camId, score, eventClass: anomaly.class }
        );

        dispatch({
          type: "SECURITY_INCIDENT",
          payload: {
            type: "SECURITY_INCIDENT",
            incident_id: Math.floor(Math.random() * 0xffffffff),
            session_id: session?.sessionId ?? 0,
            camera_id: camId,
            anomaly_score: score,
            level,
            event_class: anomaly.class,
            description: anomaly.desc,
            timestamp_us: Date.now() * 1000,
          },
        });
      }

      // ── 4. Decay camera anomaly scores gradually ──────────────────────
      sim.cameras.forEach((cam) => {
        if (cam.anomalyScore > 0 && !cam.active) {
          cam.anomalyScore = Math.max(0, cam.anomalyScore - 0.02);
          if (cam.anomalyScore < 0.05) {
            cam.zoneColor = "emerald";
            cam.eventClass = "Normal";
          }
        }
      });

      // ── 5. Clean up old corroborations ────────────────────────────────
      const now = Date.now();
      sim.corroborations = sim.corroborations.filter(
        (c) => now - c.timestamp < 10000 // keep for 10s for display
      );

      // ── 6. Telemetry heartbeat ────────────────────────────────────────
      dispatch({
        type: "TELEMETRY",
        payload: {
          type: "TELEMETRY",
          active_sessions: sim.customers.length,
          sessions: sim.customers.map((c) => ({
            id: c.sessionId,
            state: c.state === "entering" ? 1 : c.state === "checkout" ? 3 : c.state === "leaving" ? 4 : 2,
            gross_cents: c.grossCents,
            items: c.cart.length,
          })),
        },
      });

      // Clean old timers
      sim.pendingTimers = sim.pendingTimers.filter(() => true); // keep ref valid
    };

    tickRef.current = setInterval(() => {
      if (!isPaused) tick();
    }, intervalMs);

    return () => clearInterval(tickRef.current);
  }, [dispatch, isPaused, speed, emitEvent, addCorroboration]);

  // ── Animation frame: push mutable state → React state ─────────────────────
  useEffect(() => {
    let running = true;

    const syncState = () => {
      if (!running || !simRef.current) return;
      const sim = simRef.current;

      setCustomers(
        sim.customers.map((c) => ({
          id: c.id,
          x: c.x,
          y: c.y,
          state: c.state,
          sessionId: c.sessionId,
          cart: [...c.cart],
          color: c.color,
          trail: [...c.trail],
        }))
      );

      setShelves(
        sim.shelves.map((s) => ({
          ...s,
          slots: s.slots.map((sl) => ({ ...sl })),
        }))
      );

      setCameras(sim.cameras.map((c) => ({ ...c })));
      setDoors(sim.doors.map((d) => ({ ...d })));
      setCheckout({ ...sim.checkout });
      setEvents([...sim.events]);
      setCorroborations([...sim.corroborations]);
      setStats({ ...sim.stats });

      animRef.current = requestAnimationFrame(syncState);
    };

    animRef.current = requestAnimationFrame(syncState);

    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  return {
    customers,
    shelves,
    cameras,
    doors,
    checkout,
    events,
    corroborations,
    stats,
    isPaused,
    togglePause,
    speed,
    setSpeed,
  };
}
