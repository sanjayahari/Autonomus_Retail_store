// ============================================================================
// spsc_ring_buffer.hpp
// Autonomous Retail Infrastructure — Lock-Free Single-Producer Single-Consumer
//
// One ring buffer instance is allocated per sensor node (shelf or camera).
// The sensor MQTT callback thread is the sole producer; the fusion engine
// reader thread is the sole consumer. This eliminates mutex acquisition
// on the hot path entirely, reducing sensor-to-cart-update latency.
//
// Capacity must be a power of two.
// Cache-line padded to prevent false sharing between producer/consumer state.
// ============================================================================
#pragma once

#include <atomic>
#include <array>
#include <cassert>
#include <cstddef>
#include <optional>
#include <type_traits>

namespace retail {

template<typename T, std::size_t Capacity>
class SpscRingBuffer {
    static_assert((Capacity & (Capacity - 1)) == 0,
        "Capacity must be a power of two");
    static_assert(std::is_trivially_copyable_v<T>,
        "T must be trivially copyable for safe lock-free use");

public:
    SpscRingBuffer() : head_(0), tail_(0) {}

    // -------------------------------------------------------------------------
    // try_push — called by the sensor thread (producer).
    // Returns false if the buffer is full; never blocks.
    // -------------------------------------------------------------------------
    [[nodiscard]] bool try_push(const T& item) noexcept {
        const std::size_t head = head_.load(std::memory_order_relaxed);
        const std::size_t next = (head + 1) & MASK;

        // If next == tail the buffer is full
        if (next == tail_.load(std::memory_order_acquire)) {
            return false;
        }

        buffer_[head] = item;
        head_.store(next, std::memory_order_release);
        return true;
    }

    // -------------------------------------------------------------------------
    // try_pop — called by the fusion engine thread (consumer).
    // Returns std::nullopt if the buffer is empty; never blocks.
    // -------------------------------------------------------------------------
    [[nodiscard]] std::optional<T> try_pop() noexcept {
        const std::size_t tail = tail_.load(std::memory_order_relaxed);

        if (tail == head_.load(std::memory_order_acquire)) {
            return std::nullopt;  // Empty
        }

        T item = buffer_[tail];
        tail_.store((tail + 1) & MASK, std::memory_order_release);
        return item;
    }

    // -------------------------------------------------------------------------
    // size — approximate occupancy (safe for monitoring, not for control flow)
    // -------------------------------------------------------------------------
    [[nodiscard]] std::size_t size_approx() const noexcept {
        const std::size_t h = head_.load(std::memory_order_relaxed);
        const std::size_t t = tail_.load(std::memory_order_relaxed);
        return (h - t) & MASK;
    }

    [[nodiscard]] bool empty() const noexcept {
        return head_.load(std::memory_order_acquire)
            == tail_.load(std::memory_order_acquire);
    }

    [[nodiscard]] static constexpr std::size_t capacity() noexcept {
        return Capacity;
    }

private:
    static constexpr std::size_t MASK = Capacity - 1;

    // Pad each atomic counter to its own cache line (64 bytes on ARM Cortex-A)
    // to prevent the producer and consumer from bouncing the same cache line.
    alignas(64) std::atomic<std::size_t> head_;
    alignas(64) std::atomic<std::size_t> tail_;

    // The data buffer itself. Sized so each slot is cache-line aligned
    // when T is aligned (ensured by alignas in retail_types.hpp).
    std::array<T, Capacity> buffer_;
};

} // namespace retail
