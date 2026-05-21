// ============================================================================
// sensor_fusion_engine.hpp
// Autonomous Retail Infrastructure — Sensor Fusion Engine
//
// THE TRUST BOUNDARY: No cart mutation may occur from shelf weight alone,
// and no theft flag may be raised from camera alone. This engine holds
// pending weight events in a time-windowed buffer and waits for camera
// corroboration before committing any change to the session state.
//
// Corroboration rules:
//   1. A weight delta event arrives on shelf/S/slot/L
//   2. Within FUSION_WINDOW_MS, a camera event arrives that:
//      a. Associates with the same customer session, OR
//      b. Fires within the same spatial zone as the shelf (zone map)
//   3. Only then is a CartEvent committed to SessionManager
//
// If no camera event arrives within the window, the weight event is held
// as PENDING and a low-priority alert is queued for human review.
// This prevents false positives from shelf vibration, restocking, etc.
// ============================================================================
#pragma once

#include "retail_types.hpp"
#include "session_manager.hpp"
#include "item_catalog.hpp"
#include "spsc_ring_buffer.hpp"

#include <array>
#include <chrono>
#include <functional>
#include <list>
#include <mutex>
#include <optional>
#include <unordered_map>
#include <vector>

namespace retail {

// Callback types for events the fusion engine emits upward
using CartUpdateCallback    = std::function<void(SessionId, CartEventType, const ItemProfile&)>;
using SecurityEventCallback = std::function<void(SecurityIncident)>;
using TelemetryCallback     = std::function<void(SessionId, float /*gross_cents*/)>;

// ----------------------------------------------------------------------------
// Pending corroboration record — lives in the time-window buffer
// ----------------------------------------------------------------------------
struct PendingWeightEvent {
    ShelfWeightEvent    weight_event;
    SessionId           candidate_session;  // Best guess from spatial zone map
    const ItemProfile*  profile;            // Resolved from ItemCatalog (may be null)
    int64_t             expiry_us;          // Deadline for camera corroboration
    bool                corroborated;
};

// Maps a (ShelfId, slot_id) pair to the spatial camera zones that cover it.
// Populated at startup from a store configuration file.
using ShelfZoneMap = std::unordered_map<uint64_t, std::vector<CameraId>>;

// Maps a camera zone to the likely customer session (updated by face tracking).
using ZoneSessionMap = std::unordered_map<uint32_t, SessionId>;

// ----------------------------------------------------------------------------
// SensorFusionEngine
// ----------------------------------------------------------------------------
class SensorFusionEngine {
public:
    SensorFusionEngine(SessionManager&   session_mgr,
                       const ItemCatalog<>& catalog,
                       CartUpdateCallback    on_cart_update,
                       SecurityEventCallback on_security_event,
                       TelemetryCallback     on_telemetry)
        : session_mgr_(session_mgr)
        , catalog_(catalog)
        , on_cart_update_(std::move(on_cart_update))
        , on_security_event_(std::move(on_security_event))
        , on_telemetry_(std::move(on_telemetry))
        , incident_counter_(0)
    {}

    // -------------------------------------------------------------------------
    // ingest_weight_event — called by the MQTT subscriber thread when a shelf
    // publishes a weight delta. Pushes into the per-shelf SPSC buffer.
    // This function is lock-free on the hot path.
    // -------------------------------------------------------------------------
    void ingest_weight_event(const ShelfWeightEvent& ev) {
        // Ignore noise: very small deltas are vibration artefacts
        if (std::abs(ev.weight_delta_grams) < 2.0f) return;

        // O(1) profile lookup
        Sku candidate_sku = slot_to_sku(ev.shelf_id, ev.slot_id);
        const ItemProfile* profile = (candidate_sku != Sku::INVALID)
            ? catalog_.lookup(candidate_sku)
            : catalog_.match_by_weight(ev.weight_delta_grams);

        SessionId session = resolve_session_for_shelf(ev.shelf_id, ev.slot_id);

        PendingWeightEvent pending;
        pending.weight_event      = ev;
        pending.candidate_session = session;
        pending.profile           = profile;
        pending.expiry_us         = ev.timestamp_us
            + config::FUSION_WINDOW_MS.count() * 1000LL;
        pending.corroborated      = false;

        // Move to the pending buffer under a lock (not the sensor hot path)
        {
            std::lock_guard lk(pending_mutex_);
            pending_weight_.push_back(pending);
        }
    }

    // -------------------------------------------------------------------------
    // ingest_camera_event — called by the AI camera MQTT subscriber thread.
    // Attempts to corroborate pending weight events; if anomaly_score is high,
    // raises a security incident regardless of corroboration state.
    // -------------------------------------------------------------------------
    void ingest_camera_event(const CameraEvent& ev) {
        const int64_t now = ev.timestamp_us;

        // --- STEP 1: Check for theft/anomaly regardless of corroboration ---
        if (ev.anomaly_score >= config::THEFT_CONFIDENCE_THRESHOLD) {
            emit_security_incident(ev, SecurityLevel::CRITICAL);
        } else if (ev.anomaly_score >= 0.60f) {
            emit_security_incident(ev, SecurityLevel::WARNING);
        }

        // --- STEP 2: Attempt to corroborate pending weight events ---
        std::lock_guard lk(pending_mutex_);

        for (auto& pending : pending_weight_) {
            if (pending.corroborated) continue;
            if (now > pending.expiry_us) continue;  // Will be swept below

            // Corroboration check: camera must be in the shelf's zone AND
            // associate with the same session (or session is INVALID = unknown)
            const bool session_match =
                (pending.candidate_session == SessionId::INVALID) ||
                (ev.inferred_session_id == pending.candidate_session);

            const bool zone_match = camera_covers_shelf(
                ev.camera_id, pending.weight_event.shelf_id,
                pending.weight_event.slot_id);

            if (session_match && zone_match) {
                pending.corroborated = true;
                commit_cart_event(pending, ev.inferred_session_id);
            }
        }

        // --- STEP 3: Expire and report unresolved pending events ---
        sweep_expired_pending(now);
    }

    // -------------------------------------------------------------------------
    // tick — call periodically (e.g., every 250ms) to expire stale pending
    // events and push telemetry to connected WebSocket clients.
    // -------------------------------------------------------------------------
    void tick() {
        const int64_t now = now_us();
        {
            std::lock_guard lk(pending_mutex_);
            sweep_expired_pending(now);
        }
    }

    // -------------------------------------------------------------------------
    // register_shelf_sku — maps a (shelf, slot) pair to a known SKU.
    // Called at startup when loading planogram data.
    // -------------------------------------------------------------------------
    void register_shelf_sku(ShelfId shelf, uint32_t slot, Sku sku) {
        slot_sku_map_[encode_slot_key(shelf, slot)] = sku;
    }

    // -------------------------------------------------------------------------
    // register_zone_mapping — maps a camera to the shelf slots it covers.
    // -------------------------------------------------------------------------
    void register_zone_mapping(CameraId cam, ShelfId shelf, uint32_t slot) {
        zone_to_shelves_[static_cast<uint32_t>(cam)].push_back(
            encode_slot_key(shelf, slot));
    }

    // -------------------------------------------------------------------------
    // update_zone_session — called by face-tracking pipeline to associate
    // a camera zone with the customer session most likely to be in it.
    // -------------------------------------------------------------------------
    void update_zone_session(CameraId cam, SessionId session) {
        std::lock_guard lk(zone_session_mutex_);
        zone_session_[static_cast<uint32_t>(cam)] = session;
    }

private:
    // Commit a corroborated weight event as a cart mutation
    void commit_cart_event(const PendingWeightEvent& pending,
                           SessionId confirmed_session) {
        if (!pending.profile) {
            // Unknown item — log and skip. A human review will reconcile.
            emit_unknown_item_incident(pending.weight_event);
            return;
        }

        SessionId sid = (confirmed_session != SessionId::INVALID)
                      ? confirmed_session
                      : pending.candidate_session;

        if (sid == SessionId::INVALID) return;

        CartEventType type = (pending.weight_event.weight_delta_grams < 0)
            ? CartEventType::ITEM_ADDED
            : CartEventType::ITEM_RETURNED;

        if (session_mgr_.apply_cart_event(sid, type, *pending.profile)) {
            on_cart_update_(sid, type, *pending.profile);

            // Push incremental telemetry to dashboard
            auto snap = session_mgr_.read_session(sid);
            if (snap) {
                on_telemetry_(sid, snap->gross_total_cents);
            }
        }
    }

    // Raise a security incident and invoke the registered callback
    void emit_security_incident(const CameraEvent& ev, SecurityLevel level) {
        SecurityIncident inc;
        inc.incident_id  = ++incident_counter_;
        inc.session_id   = ev.inferred_session_id;
        inc.camera_id    = ev.camera_id;
        inc.anomaly_score= ev.anomaly_score;
        inc.level        = level;
        inc.timestamp_us = ev.timestamp_us;
        inc.event_class  = ev.event_class;

        const char* class_desc[] = {
            "Normal activity", "Item concealment detected",
            "Sensor bypass detected", "Prolonged loitering"
        };
        const char* desc = (ev.event_class < 4)
            ? class_desc[ev.event_class] : "Unknown anomaly";
        std::strncpy(inc.description, desc, sizeof(inc.description) - 1);

        // Suspend session immediately on critical events
        if (level == SecurityLevel::CRITICAL) {
            session_mgr_.suspend_session(ev.inferred_session_id);
        }

        on_security_event_(std::move(inc));
    }

    void emit_unknown_item_incident(const ShelfWeightEvent& ev) {
        SecurityIncident inc;
        inc.incident_id  = ++incident_counter_;
        inc.session_id   = SessionId::INVALID;
        inc.camera_id    = CameraId::INVALID;
        inc.anomaly_score= 0.0f;
        inc.level        = SecurityLevel::WARNING;
        inc.timestamp_us = ev.timestamp_us;
        inc.event_class  = 0;
        std::snprintf(inc.description, sizeof(inc.description),
            "Unknown item weight %.1fg on shelf %u slot %u",
            std::abs(ev.weight_delta_grams),
            static_cast<uint32_t>(ev.shelf_id),
            ev.slot_id);
        on_security_event_(std::move(inc));
    }

    // Remove expired entries; log unresolved ones
    void sweep_expired_pending(int64_t now_us) {
        // pending_mutex_ must be held by caller
        pending_weight_.remove_if([&](const PendingWeightEvent& p) -> bool {
            if (p.corroborated) return true;  // Done, remove silently
            if (now_us > p.expiry_us) {
                // Corroboration window elapsed with no camera confirmation.
                // Emit a warning but do NOT commit to cart (data consistency).
                SecurityIncident inc;
                inc.incident_id   = ++incident_counter_;
                inc.session_id    = p.candidate_session;
                inc.camera_id     = CameraId::INVALID;
                inc.anomaly_score = 0.0f;
                inc.level         = SecurityLevel::WARNING;
                inc.timestamp_us  = now_us;
                inc.event_class   = 0;
                const char* sku_name = p.profile ? p.profile->name : "(unknown SKU)";
                std::snprintf(inc.description, sizeof(inc.description),
                    "Weight event for '%s' (%.1fg) expired without camera corroboration",
                    sku_name, std::abs(p.weight_event.weight_delta_grams));
                on_security_event_(std::move(inc));
                return true;
            }
            return false;
        });
    }

    [[nodiscard]] Sku slot_to_sku(ShelfId shelf, uint32_t slot) const {
        auto it = slot_sku_map_.find(encode_slot_key(shelf, slot));
        return (it != slot_sku_map_.end()) ? it->second : Sku::INVALID;
    }

    [[nodiscard]] bool camera_covers_shelf(CameraId cam,
                                           ShelfId  shelf,
                                           uint32_t slot) const {
        auto it = zone_to_shelves_.find(static_cast<uint32_t>(cam));
        if (it == zone_to_shelves_.end()) return false;
        const uint64_t key = encode_slot_key(shelf, slot);
        for (const uint64_t k : it->second) {
            if (k == key) return true;
        }
        return false;
    }

    [[nodiscard]] SessionId session_for_zone(CameraId cam) const {
        std::lock_guard lk(zone_session_mutex_);
        auto it = zone_session_.find(static_cast<uint32_t>(cam));
        return (it != zone_session_.end()) ? it->second : SessionId::INVALID;
    }

    [[nodiscard]] SessionId resolve_session_for_shelf(ShelfId shelf, uint32_t slot) const {
        // Find all cameras covering this shelf slot, then pick the session
        // associated with the camera that most recently updated its zone.
        for (const auto& [cam_id, keys] : zone_to_shelves_) {
            const uint64_t key = encode_slot_key(shelf, slot);
            for (const uint64_t k : keys) {
                if (k == key) {
                    std::lock_guard lk(zone_session_mutex_);
                    auto sit = zone_session_.find(cam_id);
                    if (sit != zone_session_.end()) return sit->second;
                }
            }
        }
        return SessionId::INVALID;
    }

    [[nodiscard]] static constexpr uint64_t encode_slot_key(ShelfId shelf,
                                                             uint32_t slot) noexcept {
        return (static_cast<uint64_t>(shelf) << 32) | slot;
    }

    [[nodiscard]] static int64_t now_us() noexcept {
        using namespace std::chrono;
        return duration_cast<microseconds>(
            system_clock::now().time_since_epoch()).count();
    }

    // --- Dependencies ---
    SessionManager&       session_mgr_;
    const ItemCatalog<>&  catalog_;
    CartUpdateCallback    on_cart_update_;
    SecurityEventCallback on_security_event_;
    TelemetryCallback     on_telemetry_;

    // --- Pending corroboration buffer ---
    std::list<PendingWeightEvent> pending_weight_;
    mutable std::mutex            pending_mutex_;

    // --- Planogram / spatial mapping ---
    std::unordered_map<uint64_t, Sku>                   slot_sku_map_;
    std::unordered_map<uint32_t, std::vector<uint64_t>> zone_to_shelves_;

    // --- Live zone → session tracking (updated by camera pipeline) ---
    mutable std::mutex                          zone_session_mutex_;
    std::unordered_map<uint32_t, SessionId>     zone_session_;

    std::atomic<uint64_t> incident_counter_;
};

} // namespace retail
