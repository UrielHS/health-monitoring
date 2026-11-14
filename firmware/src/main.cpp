// Pulsera — base de conexión con el backend.
// Envía el contrato de telemetría (packages/shared/src/index.ts) cada SEND_INTERVAL_MS.
// La lectura de sensores está en readSensors(): hoy devuelve valores fijos.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <sys/time.h>
#include <time.h>

#include "config.h"

struct Sample {
  float bpm;           // NAN = sin dato
  float spo2;          // NAN = sin dato
  const char* quality; // "ok" | "noisy" | "no_finger"
  float accMag;
  float gyroMag;
  const char* activity; // "rest" | "light" | "active"
  bool impact;
  float tempC;
  float rh;
  float pressureKpa;
  float coPpm;
  const char* coState;    // "warming" | "heating" | "ready"
  const char* localAlert; // "none" | "warning" | "critical"
};

static uint32_t bootId = 0;
static uint32_t seq = 0;
static uint32_t lastSend = 0;
static WiFiClient client;
static HTTPClient http;

// ---------- Sensores ----------

Sample readSensors() {
  // TODO (dispositivo): reemplazar por lecturas reales de MAX30100, BMI160, AHT20, BMP280 y MQ-7.
  Sample s;
  s.bpm = 72;
  s.spo2 = 97;
  s.quality = "ok";
  s.accMag = 1.0;
  s.gyroMag = 2.0;
  s.activity = "rest";
  s.impact = false;
  s.tempC = 22.5;
  s.rh = 42;
  s.pressureKpa = 101.3;
  s.coPpm = 1.5;
  s.coState = millis() < CO_WARMUP_MS ? "warming" : "ready";
  s.localAlert = "none";
  return s;
}

// ---------- Red y hora ----------

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[wifi] conectando a %s...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] conectado, IP %s\n", WiFi.localIP().toString().c_str());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  } else {
    Serial.println("[wifi] sin conexión, reintento en el próximo ciclo");
  }
}

bool timeValid() { return time(nullptr) > 1600000000; }

uint64_t epochMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (uint64_t)tv.tv_sec * 1000ULL + tv.tv_usec / 1000;
}

// ---------- JSON ----------

void setNum(JsonObject o, const char* key, float v) {
  if (isnan(v)) o[key] = nullptr;
  else o[key] = v;
}

String buildPayload(const Sample& s) {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["bootId"] = bootId;
  doc["seq"] = seq;
  doc["bootMs"] = millis();
  if (timeValid()) doc["ts"] = epochMs();  // sin NTP se omite y el servidor usa bootMs
  doc["source"] = "device";

  JsonObject vitals = doc["vitals"].to<JsonObject>();
  setNum(vitals, "bpm", s.bpm);
  setNum(vitals, "spo2", s.spo2);
  vitals["quality"] = s.quality;

  JsonObject motion = doc["motion"].to<JsonObject>();
  motion["accMag"] = s.accMag;
  motion["gyroMag"] = s.gyroMag;
  motion["activity"] = s.activity;
  motion["impact"] = s.impact;

  JsonObject env = doc["env"].to<JsonObject>();
  setNum(env, "tempC", s.tempC);
  setNum(env, "rh", s.rh);
  setNum(env, "pressureKpa", s.pressureKpa);
  setNum(env, "coPpm", s.coPpm);
  env["coState"] = s.coState;

  doc["localAlert"] = s.localAlert;

  String out;
  serializeJson(doc, out);
  return out;
}

// ---------- Envío ----------

bool postTelemetry(const String& body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  // setReuse mantiene abierta la conexión TCP entre envíos: menos tiempo y menos fragmentación de memoria.
  http.setReuse(true);
  http.begin(client, String(SERVER_URL) + "/api/telemetria");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  int code = http.POST(body);
  if (code != 200) Serial.printf("[http] código %d: %s\n", code, http.getString().c_str());
  http.end();
  return code == 200;
}

// ---------- Ciclo principal ----------

void setup() {
  Serial.begin(115200);
  delay(200);
  bootId = esp_random() & 0x7FFFFFFF;
  Serial.printf("[boot] device=%s bootId=%lu\n", DEVICE_ID, (unsigned long)bootId);
  connectWiFi();
}

void loop() {
  // TODO (dispositivo): las alertas locales (buzzer y OLED) se evalúan aquí, sin depender de la red.

  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    connectWiFi();
    Sample s = readSensors();
    String body = buildPayload(s);
    bool ok = postTelemetry(body);
    Serial.printf("[tx] seq=%lu %s\n", (unsigned long)seq, ok ? "ok" : "falló");
    // TODO (conexión): si falla, guardar en la cola de flash y reenviar por /api/telemetria/lote.
    seq++;
  }
}
