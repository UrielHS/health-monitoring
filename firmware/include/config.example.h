#pragma once
// Copiar este archivo como config.h (config.h no se sube al repo).

#define WIFI_SSID "nombre-de-la-red"
#define WIFI_PASS "clave-de-la-red"

// IP de la laptop que hace de Nave (docker compose). Ver con ipconfig / ifconfig.
#define SERVER_URL "http://192.168.1.50:3000"
#define API_KEY "dev-key"
#define DEVICE_ID "wearable-01"

#define SEND_INTERVAL_MS 2000
// Tiempo de precalentamiento del MQ-7 antes de considerar sus lecturas.
#define CO_WARMUP_MS 180000
