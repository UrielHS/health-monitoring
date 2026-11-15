#pragma once
// Copiar este archivo como config.h (config.h no se sube al repo).

#define WIFI_SSID "nombre-de-la-red"
#define WIFI_PASS "clave-de-la-red"

// URL del servidor desplegado (HTTPS). Para pruebas locales: "http://<IP-de-tu-laptop>:3000".
// Con HTTPS el firmware debe incluir el certificado raíz ISRG Root X1; nunca usar setInsecure().
#define SERVER_URL "https://tu-servidor.example.com"
#define API_KEY "dev-key"
#define DEVICE_ID "wearable-01"

#define SEND_INTERVAL_MS 2000
// Tiempo de precalentamiento del MQ-7 antes de considerar sus lecturas.
#define CO_WARMUP_MS 180000
