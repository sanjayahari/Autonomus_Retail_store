// ============================================================================
// retail_types.hpp
// Autonomous Retail Infrastructure — Core Type Definitions
//
// All shared types, enumerations, and constants used across the engine.
// Designed for aarch64 (NVIDIA Jetson) with cache-line alignment in mind.
// ============================================================================
#pragma once

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace retail {

// ----------------------------------------------------------------------------
// Compile-time configuration constants
// ----------------------------------------------------------------------------
namespace config {
    // Maximum concurrent customer sessions per store instance.
    // Must be a power of two for the open-addressing hash map.
    inline constexpr std::size_t MAX_SESSIONS       = 64;

    // Sensor fusion: both signals must arrive within this window to be
    // treated as corroborating evidence for a single cart event.
    inline constexpr std::chrono::milliseconds FUSION_WINDOW_MS{2000};

    // Theft detection: anomaly scores at or above this threshold trigger
    // a critical security event pushed immediately to the cloud.
    inline constexpr float THEFT_CONFIDENCE_THRESHOLD = 0.85f;

    // Item weight tolerance: ± grams within which a weight delta is
    // considered a match for a known SKU weight profile.
    inline constexpr float WEIGHT_TOLERANCE_GRAMS     = 5.0f;

    // SQLite WAL checkpoint interval (writes before forced checkpoint).
    inline constexpr int   SQLITE_WAL_CHECKPOINT_SIZE = 1000;

    // Cloud sync batch: events are buffered locally and flushed to
    // PostgreSQL in batches of this size or after SYNC_INTERVAL_MS.
    inline constexpr int   CLOUD_SYNC_BATCH_SIZE      = 100;
    inline constexpr std::chrono::milliseconds CLOUD_SYNC_INTERVAL_MS{5000};

    // MQTT broker address (local LAN, set via environment override).
    inline constexpr std::string_view MQTT_BROKER_DEFAULT = "tcp://127.0.0.1:1883";

    // Thread pool: sized to 2× hardware concurrency for I/O-bound overlap.
    inline constexpr std::size_t THREAD_POOL_MULTIPLIER = 2;

    // Standard retail margin for profit calculations (40%).
    inline constexpr float RETAIL_MARGIN = 0.40f;
}

// ----------------------------------------------------------------------------
// Strongly typed identifiers (prevent accidental integer mix-ups)
// ----------------------------------------------------------------------------
enum class SessionId  : uint64_t { INVALID = 0 };
enum class ShelfId    : uint32_t { INVALID = 0 };
enum class CameraId   : uint32_t { INVALID = 0 };
enum class Sku        : uint32_t { INVALID = 0 };

// ----------------------------------------------------------------------------
// Session lifecycle states
// ----------------------------------------------------------------------------
enum class SessionState : uint8_t {
    INACTIVE    = 0,  // Slot is free
    ENTERING    = 1,  // Door unlocked, customer not yet fully inside
    ACTIVE      = 2,  // Shopping in progress
    CHECKOUT    = 3,  // Payment terminal engaged
    CLOSING     = 4,  // Payment complete, awaiting door release
    SUSPENDED   = 5,  // Frozen pending security review
};

// ----------------------------------------------------------------------------
// Cart event types — every cart mutation is typed
// ----------------------------------------------------------------------------
enum class CartEventType : uint8_t {
    ITEM_ADDED       = 0,
    ITEM_REMOVED     = 1,
    ITEM_RETURNED    = 2,  // Returned to shelf after prior add
    PRICE_CORRECTION = 3,  // Reconciliation-time correction
    SESSION_FINALIZED= 4,
};

// ----------------------------------------------------------------------------
// Security event severity levels
// ----------------------------------------------------------------------------
enum class SecurityLevel : uint8_t {
    INFO     = 0,  // Routine log entry
    WARNING  = 1,  // Score elevated, monitoring increased
    CRITICAL = 2,  // Threshold breached, owner notified immediately
};

// ----------------------------------------------------------------------------
// Raw MQTT event payload from shelf load cells
// Published on: shelf/<shelf_id>/<slot_id>/weight
// ----------------------------------------------------------------------------
struct alignas(64) ShelfWeightEvent {
    ShelfId     shelf_id;
    uint32_t    slot_id;
    float       weight_delta_grams;   // Negative = item removed, positive = returned
    float       absolute_weight_grams;
    int64_t     timestamp_us;         // Microseconds since Unix epoch
    uint8_t     sensor_confidence;    // 0–100, reported by load cell firmware
    uint8_t     _pad[3];
};

// ----------------------------------------------------------------------------
// Raw MQTT event payload from overhead AI cameras
// Published on: camera/<camera_id>/event
// ----------------------------------------------------------------------------
struct alignas(64) CameraEvent {
    CameraId    camera_id;
    SessionId   inferred_session_id;  // Best-effort from face/body tracking
    float       anomaly_score;        // 0.0–1.0 from on-device model
    float       bbox_x, bbox_y;       // Normalized bounding box of detected action
    float       bbox_w, bbox_h;
    int64_t     timestamp_us;
    uint8_t     event_class;          // 0=normal, 1=concealment, 2=bypass, 3=loiter
    uint8_t     _pad[7];
};

// ----------------------------------------------------------------------------
// Resolved cart line item
// ----------------------------------------------------------------------------
struct CartItem {
    Sku         sku;
    std::string name;
    float       unit_price_cents;
    float       weight_grams;
    int32_t     quantity;             // Signed: negative means net-returned
};

// ----------------------------------------------------------------------------
// Immutable item weight profile stored in the O(1) lookup map
// Keyed by Sku (uint32_t), stored in a flat array indexed by SKU hash.
// ----------------------------------------------------------------------------
struct ItemProfile {
    Sku         sku;
    float       weight_grams;
    float       unit_price_cents;
    char        name[64];             // Fixed-width for cache friendliness
    bool        valid;
};

// ----------------------------------------------------------------------------
// Security incident record (persisted to SQLite + forwarded to cloud)
// ----------------------------------------------------------------------------
struct SecurityIncident {
    uint64_t    incident_id;          // Monotonic, store-scoped
    SessionId   session_id;
    CameraId    camera_id;
    float       anomaly_score;
    SecurityLevel level;
    int64_t     timestamp_us;
    uint8_t     event_class;
    char        description[128];
};

// ----------------------------------------------------------------------------
// Financial transaction record (written at checkout)
// ----------------------------------------------------------------------------
struct Transaction {
    uint64_t    transaction_id;
    SessionId   session_id;
    int64_t     session_start_us;
    int64_t     session_end_us;
    float       gross_total_cents;
    float       cost_of_goods_cents;  // gross × (1 - RETAIL_MARGIN)
    float       net_profit_cents;     // gross × RETAIL_MARGIN
    uint32_t    item_count;
    bool        payment_authorized;
    char        payment_method[16];   // "EMV", "NFC", "BIOMETRIC"
};

} // namespace retail
