cmake_minimum_required(VERSION 3.22)
project(RetailEdgeEngine VERSION 1.0.0 LANGUAGES CXX)

# ─── C++ Standard ─────────────────────────────────────────────────────────────
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ─── Build type defaults ───────────────────────────────────────────────────────
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# ─── Compiler flags ───────────────────────────────────────────────────────────
# Jetson AGX Orin / Xavier: Cortex-A78AE / Carmel ARMv8.2-A
# Nano / Orin Nano: Cortex-A78AE ARMv8.2-A
# Adjust -march per your specific Jetson module.
set(JETSON_ARCH "armv8.2-a" CACHE STRING "ARM architecture for -march=")

add_compile_options(
    # Optimization
    $<$<CONFIG:Release>:-O3>
    $<$<CONFIG:Release>:-march=${JETSON_ARCH}>
    $<$<CONFIG:Release>:-mtune=cortex-a78>
    $<$<CONFIG:Release>:-ffast-math>        # Safe: no NaN/Inf in sensor data
    $<$<CONFIG:Release>:-funroll-loops>

    # Debug
    $<$<CONFIG:Debug>:-O0>
    $<$<CONFIG:Debug>:-g3>
    $<$<CONFIG:Debug>:-fsanitize=address,undefined>

    # Warnings — treated as errors in CI
    -Wall -Wextra -Wpedantic -Wshadow
    -Wno-unused-parameter           # Suppress Paho callback params
)

add_link_options(
    $<$<CONFIG:Debug>:-fsanitize=address,undefined>
)

# ─── Find required system packages ────────────────────────────────────────────
find_package(Threads REQUIRED)

# SQLite3 — system package on Jetson:  apt install libsqlite3-dev
find_package(PkgConfig REQUIRED)
pkg_check_modules(SQLITE3 REQUIRED sqlite3)

# Paho MQTT C — async variant:  apt install libpaho-mqtt3-dev
# or build from source: https://github.com/eclipse/paho.mqtt.c
find_library(PAHO_MQTT_LIB paho-mqtt3as
    HINTS /usr/local/lib /usr/lib /usr/lib/aarch64-linux-gnu)
if(NOT PAHO_MQTT_LIB)
    message(FATAL_ERROR
        "libpaho-mqtt3as not found. Install with:\n"
        "  apt install libpaho-mqtt3-dev\n"
        "or build from source and set CMAKE_PREFIX_PATH.")
endif()
find_path(PAHO_MQTT_INCLUDE MQTTAsync.h
    HINTS /usr/local/include /usr/include)

# libcurl — for cloud sync HTTP POST:  apt install libcurl4-openssl-dev
find_package(CURL REQUIRED)

# Optional: libwebsockets for the WebSocket gateway
#   apt install libwebsockets-dev
pkg_check_modules(LWS libwebsockets)
if(LWS_FOUND)
    message(STATUS "libwebsockets found — WebSocket gateway enabled")
    add_compile_definitions(RETAIL_WEBSOCKET_ENABLED)
else()
    message(WARNING "libwebsockets not found — WebSocket gateway disabled")
endif()

# ─── Header-only engine library ───────────────────────────────────────────────
add_library(retail_engine INTERFACE)
target_include_directories(retail_engine INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${PAHO_MQTT_INCLUDE}
    ${SQLITE3_INCLUDE_DIRS}
    ${CURL_INCLUDE_DIRS}
    ${LWS_INCLUDE_DIRS}
)

# ─── Main executable ──────────────────────────────────────────────────────────
add_executable(retail_edge src/edge_engine.cpp)

target_link_libraries(retail_edge PRIVATE
    retail_engine
    Threads::Threads
    ${PAHO_MQTT_LIB}
    ${SQLITE3_LIBRARIES}
    ${CURL_LIBRARIES}
    ${LWS_LIBRARIES}
)

# Link order matters on GCC/ARM: -lpthread after user objects
target_link_options(retail_edge PRIVATE -lpthread)

# ─── Install rules ────────────────────────────────────────────────────────────
install(TARGETS retail_edge
    RUNTIME DESTINATION /usr/local/bin)
install(FILES
    ${CMAKE_CURRENT_SOURCE_DIR}/../db-schemas/edge_schema.sql
    DESTINATION /etc/retail)

# ─── Unit test target (optional, requires Catch2) ────────────────────────────
option(BUILD_TESTS "Build unit tests" OFF)
if(BUILD_TESTS)
    find_package(Catch2 3 REQUIRED)
    add_executable(retail_tests
        tests/test_item_catalog.cpp
        tests/test_session_manager.cpp
        tests/test_spsc_ring_buffer.cpp
        tests/test_sensor_fusion.cpp
    )
    target_link_libraries(retail_tests PRIVATE
        retail_engine Catch2::Catch2WithMain Threads::Threads)

    include(CTest)
    include(Catch)
    catch_discover_tests(retail_tests)
endif()

# ─── Summary ──────────────────────────────────────────────────────────────────
message(STATUS "")
message(STATUS "=== Retail Edge Engine Build Configuration ===")
message(STATUS "  Build type  : ${CMAKE_BUILD_TYPE}")
message(STATUS "  Target arch : ${JETSON_ARCH}")
message(STATUS "  SQLite3     : ${SQLITE3_VERSION}")
message(STATUS "  Paho MQTT   : ${PAHO_MQTT_LIB}")
message(STATUS "  libcurl     : ${CURL_VERSION_STRING}")
message(STATUS "  WebSockets  : ${LWS_FOUND}")
message(STATUS "  Build tests : ${BUILD_TESTS}")
message(STATUS "")
message(STATUS "  Build command:")
message(STATUS "    cmake -B build -DCMAKE_BUILD_TYPE=Release")
message(STATUS "    cmake --build build -j\$(nproc)")
message(STATUS "")
