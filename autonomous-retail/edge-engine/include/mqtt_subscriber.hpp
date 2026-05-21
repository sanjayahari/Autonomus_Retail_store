// ============================================================================
// mqtt_subscriber.hpp
// Autonomous Retail Infrastructure — Paho MQTT C Subscriber
//
// Manages a single persistent MQTT connection per edge node.
// Subscribes to four topic families and routes raw payloads to the
// correct engine method via a dispatch table.
//
// Topic schema:
//   shelf/<shelf_id>/<slot_id>/weight    → SensorFusionEngine::ingest_weight_event
//   camera/<camera_id>/event             → SensorFusionEngine::ingest_camera_event
//   door/<door_id>/scan                  → SessionManager::open_session
//   terminal/<terminal_id>/checkout      → ReconciliationEngine::process_checkout
//
// All topic parsing is done with zero heap allocation using string_view.
// Payload deserialization is hand-rolled (no JSON library dependency)
// because sensor payloads are binary-packed structs, not JSON, for
// minimum wire size and maximum throughput.
//
// Compile dependency: libpaho-mqtt3as (async, SSL-capable Paho C client)
//   apt install libpaho-mqtt3-dev   (on Jetson / Ubuntu 22.04)
// ============================================================================
#pragma once

#include "retail_types.hpp"
#include "sensor_fusion_engine.hpp"
#include "session_manager.hpp"
#include "reconciliation_engine.hpp"

#include <MQTTAsync.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <functional>
#include <iostream>
#include <string>
#include <string_view>
#include <thread>

namespace retail {

// ─── Wire format: binary-packed payloads for minimal overhead ────────────────
// Each hardware node serialises its events into these exact structs and
// publishes the raw bytes. QoS 1 guarantees at-least-once delivery;
// deduplication is handled by the fusion engine's time-window logic.

#pragma pack(push, 1)

// shelf/<shelf_id>/<slot_id>/weight  →  48 bytes
struct WireShelfPayload {
    float   weight_delta_grams;
    float   absolute_weight_grams;
    int64_t timestamp_us;
    uint8_t sensor_confidence;   // 0–100
    uint8_t _pad[3];
};

// camera/<camera_id>/event  →  44 bytes
struct WireCameraPayload {
    uint64_t inferred_session_id;
    float    anomaly_score;
    float    bbox_x, bbox_y, bbox_w, bbox_h;
    int64_t  timestamp_us;
    uint8_t  event_class;
    uint8_t  _pad[7];
};

// door/<door_id>/scan  →  variable (customer_token is null-terminated string)
struct WireDoorPayload {
    char customer_token[64];     // SHA-256 hex or biometric template ID
};

// terminal/<terminal_id>/checkout  →  fixed
struct WireCheckoutPayload {
    uint64_t session_id;
    char     payment_method[16]; // "EMV", "NFC", "BIOMETRIC"
};

#pragma pack(pop)

// ─── MQTTSubscriber ──────────────────────────────────────────────────────────
class MQTTSubscriber {
public:
    MQTTSubscriber(SensorFusionEngine&   fusion,
                   SessionManager&       sessions,
                   ReconciliationEngine& reconciliation,
                   std::string_view      broker_url,
                   std::string_view      client_id = "retail-edge-01")
        : fusion_(fusion)
        , sessions_(sessions)
        , reconciliation_(reconciliation)
        , broker_url_(broker_url)
        , client_id_(client_id)
        , client_(nullptr)
        , connected_(false)
    {}

    ~MQTTSubscriber() {
        disconnect();
    }

    // -------------------------------------------------------------------------
    // connect_and_run — establishes the MQTT connection, subscribes to all
    // topics, then blocks in the Paho async dispatch loop until shutdown.
    // Call from a dedicated thread.
    // -------------------------------------------------------------------------
    bool connect_and_run(std::atomic<bool>& shutdown_flag) {
        if (!create_client()) return false;

        MQTTAsync_connectOptions opts = MQTTAsync_connectOptions_initializer;
        opts.keepAliveInterval = 20;
        opts.cleansession      = 1;
        opts.automaticReconnect= 1;
        opts.minRetryInterval  = 1;
        opts.maxRetryInterval  = 30;
        opts.onSuccess         = &MQTTSubscriber::on_connect;
        opts.onFailure         = &MQTTSubscriber::on_connect_failure;
        opts.context           = this;

        int rc = MQTTAsync_connect(client_, &opts);
        if (rc != MQTTASYNC_SUCCESS) {
            std::cerr << "[MQTT] Connect failed: " << rc << '\n';
            return false;
        }

        // Wait for connection to establish
        while (!connected_.load(std::memory_order_acquire)
               && !shutdown_flag.load(std::memory_order_acquire)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        std::cout << "[MQTT] Connected to " << broker_url_ << '\n';

        // Block until shutdown is requested
        while (!shutdown_flag.load(std::memory_order_acquire)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }

        disconnect();
        return true;
    }

private:
    // -------------------------------------------------------------------------
    // Client creation
    // -------------------------------------------------------------------------
    bool create_client() {
        int rc = MQTTAsync_create(&client_,
                                  broker_url_.c_str(),
                                  client_id_.c_str(),
                                  MQTTCLIENT_PERSISTENCE_NONE,
                                  nullptr);
        if (rc != MQTTASYNC_SUCCESS) {
            std::cerr << "[MQTT] Create client failed: " << rc << '\n';
            return false;
        }

        // Register message callback — this is our main dispatch entry point
        MQTTAsync_setCallbacks(client_, this,
                               &MQTTSubscriber::on_connection_lost,
                               &MQTTSubscriber::on_message_arrived,
                               nullptr);
        return true;
    }

    void disconnect() {
        if (!client_) return;
        MQTTAsync_disconnectOptions opts = MQTTAsync_disconnectOptions_initializer;
        opts.timeout = 1000;
        MQTTAsync_disconnect(client_, &opts);
        MQTTAsync_destroy(&client_);
        client_ = nullptr;
    }

    // -------------------------------------------------------------------------
    // Subscribe to all four topic families after successful connect
    // -------------------------------------------------------------------------
    void subscribe_all() {
        // Topic list and corresponding QoS levels
        static const char* topics[] = {
            "shelf/+/+/weight",
            "camera/+/event",
            "door/+/scan",
            "terminal/+/checkout",
        };
        static const int qos[] = { 1, 1, 2, 2 };
        // QoS 2 (exactly-once) for door and checkout: correctness critical
        // QoS 1 (at-least-once) for sensor streams: fusion engine deduplicates

        MQTTAsync_responseOptions resp = MQTTAsync_responseOptions_initializer;
        resp.onSuccess = &MQTTSubscriber::on_subscribe;
        resp.context   = this;

        for (int i = 0; i < 4; ++i) {
            int rc = MQTTAsync_subscribe(client_, topics[i], qos[i], &resp);
            if (rc != MQTTASYNC_SUCCESS) {
                std::cerr << "[MQTT] Subscribe to '" << topics[i]
                          << "' failed: " << rc << '\n';
            } else {
                std::cout << "[MQTT] Subscribed: " << topics[i]
                          << " (QoS " << qos[i] << ")\n";
            }
        }
    }

    // -------------------------------------------------------------------------
    // Message dispatch — the hot path.
    // Parses the topic string to determine the handler, then casts the
    // binary payload to the correct wire struct and builds the engine type.
    // -------------------------------------------------------------------------
    void dispatch(const std::string& topic,
                  const void* payload,
                  int         payload_len) {

        const std::string_view tv{topic};

        // ── shelf/<shelf_id>/<slot_id>/weight ──
        if (tv.starts_with("shelf/") && tv.ends_with("/weight")) {
            if (payload_len < static_cast<int>(sizeof(WireShelfPayload))) return;

            const auto* w = static_cast<const WireShelfPayload*>(payload);

            // Parse shelf_id and slot_id from topic: shelf/{sid}/{slotid}/weight
            uint32_t shelf_id_raw = 0, slot_id_raw = 0;
            sscanf(topic.c_str(), "shelf/%u/%u/weight", &shelf_id_raw, &slot_id_raw);

            ShelfWeightEvent ev;
            ev.shelf_id              = static_cast<ShelfId>(shelf_id_raw);
            ev.slot_id               = slot_id_raw;
            ev.weight_delta_grams    = w->weight_delta_grams;
            ev.absolute_weight_grams = w->absolute_weight_grams;
            ev.timestamp_us          = w->timestamp_us;
            ev.sensor_confidence     = w->sensor_confidence;

            fusion_.ingest_weight_event(ev);
            return;
        }

        // ── camera/<camera_id>/event ──
        if (tv.starts_with("camera/") && tv.ends_with("/event")) {
            if (payload_len < static_cast<int>(sizeof(WireCameraPayload))) return;

            const auto* c = static_cast<const WireCameraPayload*>(payload);

            uint32_t camera_id_raw = 0;
            sscanf(topic.c_str(), "camera/%u/event", &camera_id_raw);

            CameraEvent ev;
            ev.camera_id           = static_cast<CameraId>(camera_id_raw);
            ev.inferred_session_id = static_cast<SessionId>(c->inferred_session_id);
            ev.anomaly_score       = c->anomaly_score;
            ev.bbox_x              = c->bbox_x;
            ev.bbox_y              = c->bbox_y;
            ev.bbox_w              = c->bbox_w;
            ev.bbox_h              = c->bbox_h;
            ev.timestamp_us        = c->timestamp_us;
            ev.event_class         = c->event_class;

            fusion_.ingest_camera_event(ev);
            return;
        }

        // ── door/<door_id>/scan ──
        if (tv.starts_with("door/") && tv.ends_with("/scan")) {
            if (payload_len < 1) return;

            const auto* d = static_cast<const WireDoorPayload*>(payload);

            // Build a null-terminated token string from the payload bytes
            char token[65] = {};
            const int copy_len = std::min(payload_len, 64);
            std::memcpy(token, d->customer_token, copy_len);

            const SessionId sid = sessions_.open_session(token);
            if (sid == SessionId::INVALID) {
                std::cerr << "[MQTT] Store at capacity — door scan rejected\n";
            } else {
                std::cout << "[MQTT] Session opened: "
                          << static_cast<uint64_t>(sid) << '\n';
            }
            return;
        }

        // ── terminal/<terminal_id>/checkout ──
        if (tv.starts_with("terminal/") && tv.ends_with("/checkout")) {
            if (payload_len < static_cast<int>(sizeof(WireCheckoutPayload))) return;

            const auto* ch = static_cast<const WireCheckoutPayload*>(payload);
            const SessionId sid = static_cast<SessionId>(ch->session_id);

            auto result = reconciliation_.process_checkout(sid, ch->payment_method);
            if (!result) {
                std::cerr << "[MQTT] Checkout failed for session "
                          << ch->session_id << '\n';
            } else {
                std::cout << "[MQTT] Checkout complete. Txn #"
                          << result->transaction_id
                          << " gross=$" << (result->gross_total_cents / 100.0f)
                          << " profit=$" << (result->net_profit_cents / 100.0f)
                          << '\n';
            }
            return;
        }

        // Unrecognised topic — log and ignore (never crash the subscriber)
        std::cerr << "[MQTT] Unrouted topic: " << topic << '\n';
    }

    // ─── Paho static callback shims ──────────────────────────────────────────
    // Paho requires free-function callbacks; we recover `this` from context.

    static void on_connect(void* ctx, MQTTAsync_successData* /*resp*/) {
        auto* self = static_cast<MQTTSubscriber*>(ctx);
        self->connected_.store(true, std::memory_order_release);
        self->subscribe_all();
    }

    static void on_connect_failure(void* ctx, MQTTAsync_failureData* resp) {
        std::cerr << "[MQTT] Connection failure, code="
                  << (resp ? resp->code : -1) << '\n';
        (void)ctx;
    }

    static void on_connection_lost(void* ctx, char* cause) {
        auto* self = static_cast<MQTTSubscriber*>(ctx);
        self->connected_.store(false, std::memory_order_release);
        std::cerr << "[MQTT] Connection lost: "
                  << (cause ? cause : "unknown") << '\n';
        // Paho's automaticReconnect=1 will re-establish and re-subscribe
    }

    static int on_message_arrived(void* ctx, char* topic_str,
                                  int topic_len,
                                  MQTTAsync_message* msg) {
        (void)topic_len;
        auto* self = static_cast<MQTTSubscriber*>(ctx);
        self->dispatch(topic_str, msg->payload, msg->payloadlen);
        MQTTAsync_freeMessage(&msg);
        MQTTAsync_free(topic_str);
        return 1;  // 1 = message handled, Paho frees it
    }

    static void on_subscribe(void* ctx, MQTTAsync_successData* /*resp*/) {
        (void)ctx;
        // Subscription acknowledgement — no action needed
    }

    // ─── Members ─────────────────────────────────────────────────────────────
    SensorFusionEngine&    fusion_;
    SessionManager&        sessions_;
    ReconciliationEngine&  reconciliation_;
    std::string            broker_url_;
    std::string            client_id_;
    MQTTAsync              client_;
    std::atomic<bool>      connected_;
};

} // namespace retail
