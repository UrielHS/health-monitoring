# AURA · Astronaut Health Monitor

Onboard health monitoring for astronauts, built for the NASA Space Apps Challenge 2026 challenge **Create Health Monitoring Software for Astronauts on Space Missions**.

A wristband with an ESP32 measures pulse, blood oxygen, motion and cabin air, and publishes the readings over **MQTT** to a **Mosquitto** broker. A server interprets the readings with fixed rules and tells the astronaut, in plain language, what happened, why it matters and what to do. A "ground medical" view receives the same data with a delay, to show that the astronaut acts without waiting for Earth.

> **Prototype, not a medical device.** It is a proof of concept for the onboard interpretation and decision layer. Sensors are swappable for certified hardware, thresholds are not clinical criteria, and critical scenarios were validated through simulation.

Versión en español para el equipo: [`README.es.md`](README.es.md).

## Why

Today an astronaut's health is measured with separate tools: a smart shirt for the body, handheld analyzers for the air, periodic tests for the mind. Most of the interpretation happens on Earth. On a mission to the Moon or Mars, communication delays make that too slow.

AURA puts body, air and self-reported symptoms in one place, interprets them next to the astronaut, and turns every alert into an action. Two examples of rules that need more than one sensor:

- **High pulse while moving is exercise, not an alarm.** High pulse at rest, well above the person's own baseline, is flagged as possible stress.
- **Carbon monoxide raises the alarm on its own.** A pulse oximeter cannot tell hemoglobin carrying CO from hemoglobin carrying oxygen, so it keeps reading 98% during CO poisoning. The app says so explicitly and tells the astronaut to trust the CO alarm.

## What is in this repository

```
packages/shared   Telemetry contract v1 (Zod), MQTT topics, rule engine and simulator. Single source of truth.
apps/server       Express + Socket.IO + Prisma/PostgreSQL + MQTT client. Rules, alerts, the delayed ground view.
apps/web          PWA (React + Vite + three.js). Preflight check, astronaut view (#ship) and ground medical view (#ground).
firmware          ESP32 with PlatformIO. Wi-Fi, NTP and publishing the telemetry contract over MQTT.
mosquitto         Broker configuration (users and per-topic permissions are generated at startup).
docs/hardware     Hand-drawn diagrams of the device.
```

```
ESP32 wristband ──MQTT astro/v1/<deviceId>/telemetry──▶ Mosquitto ──▶ Server
   │  local alerts (OLED + buzzer), no network needed      (HTTP POST /api/telemetria as fallback)
                                                                          │  Zod → PostgreSQL → rule engine
                                                                          ├─ Socket.IO /ship   → astronaut view (real time)
                                                                          └─ Socket.IO /ground → ground view (delayed)
Simulator ── POST /api/sim/:scenario (from the app) or npm run sim ──▶ same path as the wristband
```

## The app

The 3D particle body comes from [mission-view](https://github.com/antonyto02/mission-view). Each body zone has a panel (Mind, Blood oxygen, Cabin air, Heart, Body) joined to the body by a line, and its color is decided by the server's alerts.

- **Preflight.** Checks the link to the server and that every sensor is reading. `Start mission` unlocks when everything is green.
- **Astronaut view.** Overall status in one word, five panels, and for each alert: what happened, why it matters, what to do, and an `Acknowledge` button. Danger adds a red banner; caution only turns its panel amber.
- **Impact.** "Are you OK?" with a 30 s countdown. With no answer, or with `Call the crew`, it escalates to danger.
- **Symptoms.** `How do you feel?` logs a symptom from 1 to 5. The astronaut decides whether to share it with the ground team.
- **No signal.** After 10 s without packets the app says so. Silence is never shown as "all good".
- **Ground medical view** (`#ground`). The same data with a delay, trend charts for pulse, blood oxygen and CO index, an event log showing when each event happened on board and when it reached Earth, and a report export.

- **User guide** (`#guide`). Every part of the screen, the status colors, the five panels and the eight scenarios, with annotated screenshots.

**For judges and first-time users:** on the first screen press **Explore with simulated data**. A fictional crew member appears, a short tour points at each part of the screen, and a card above the scenario buttons explains what each scenario simulates and what to look for.

Simulated data is always labeled **SIMULATED**. Carbon monoxide is shown as a relative index from 0 to 40, not ppm, because the MQ-7 sensor is not calibrated.

## Quick start

Requirements: Node 20+ and Docker.

```bash
npm install

# 1. Database and MQTT broker
docker compose up -d db mosquitto

# 2. Server
cp apps/server/.env.example apps/server/.env
npm run db:push
npm run dev:server          # http://localhost:3000/api/health  (logs "[mqtt] connected")

# 3. App (another terminal)
npm run dev:web             # http://localhost:5173   (ground view: http://localhost:5173/#ground)
```

In the preflight screen choose **Simulation**, press `Start mission`, and launch scenarios from the bar at the bottom (or with keys `1` to `8`): `normal`, `exercise`, `stress`, `co`, `hypoxia`, `depressurization`, `impact`, `offline`.

To test the broker without the ESP32, run `npm run sim -- --scenario co --mqtt` in another terminal: it connects as the test wristband `test-01` and follows exactly the real wristband's path, so it shows up under **Live wristband**.

To try the app with no server at all, open `http://localhost:5173/?demo`. The same simulator and rule engine run in the browser.

For a demo, speed up the rules with `RULE_TIME_SCALE=0.1`. Before the stress scenario, let `normal` run for a minute so the server can learn the resting pulse baseline.

## Server environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection |
| `MQTT_ENABLED` | `true` | `false` = HTTP only |
| `MQTT_URL` | `mqtt://127.0.0.1:1883` | Broker address |
| `MQTT_USER` / `MQTT_PASS` | `server` / `clave-server` | Must match `MQTT_SERVER_PASS` in the root `.env` |
| `DEVICE_API_KEYS` | `dev-key` | Keys for the HTTP fallback (`x-api-key` header), comma separated |
| `GROUND_DELAY_SEC` | `60` | Delay of the ground view |
| `OFFLINE_AFTER_SEC` | `10` | Seconds without data before the "no signal" alert |
| `RULE_TIME_SCALE` | `1` | Multiplies the minimum duration of each rule (`0.1` = 10 times faster) |
| `BASELINE_SAMPLES` | `30` | Resting readings used to compute the personal pulse baseline |
| `SIM_ENABLED` | `true` | Allows launching scenarios from the app |
| `CORS_ORIGIN` | `*` | Must include the domain where the app is published |

Broker users and passwords live in the root `.env` (`MQTT_SERVER_PASS`, `MQTT_DEVICE_USER`, `MQTT_DEVICE_PASS`, `MQTT_TEST_PASS`); see `.env.example`.

## MQTT topics

| Topic | Published by | Content |
| --- | --- | --- |
| `astro/v1/<deviceId>/telemetry` | Wristband | Contract v1 JSON |
| `astro/v1/<deviceId>/status` | Wristband (`online`, retained) and the broker's Last Will (`offline`) | text |
| `astro/v1/<deviceId>/errors` | Server, when it rejects a packet | `{ "error", "issues" }` |
| `astro/v1/config` | Server, retained | same as `GET /api/config` |

Each wristband uses its deviceId as broker user and may only publish to its own topics (`mosquitto/acl`). If it loses power or network, the Last Will marks it offline in about 7 s. The in-app simulator does not go through the broker, so the simulated demo works even if Mosquitto fails.

## API

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/telemetria` | HTTP fallback for one reading, same JSON as MQTT. `x-api-key` header. |
| `POST` | `/api/telemetria/lote` | `{ "packets": [...] }`, 1 to 50 stored readings. Saved without raising old alerts. |
| `GET` | `/api/config` | Current thresholds and rules. |
| `GET` | `/api/health` | Server, database and broker status. |
| `GET` | `/api/lecturas?deviceId=&minutes=` | Recent readings. |
| `GET` | `/api/alertas?active=1` | Alerts (active or recent). |
| `POST` | `/api/alertas/:id/ack` | Acknowledge an alert. |
| `POST` | `/api/alertas/:id/escalate` | "Call the crew": escalates an impact without waiting 30 s. |
| `POST` / `GET` | `/api/sintomas` | Symptom log. |
| `POST` | `/api/sim/:scenario` | Starts a simulated scenario. It goes through the same rule engine. |
| `POST` | `/api/sim/stop` | Stops the simulation. |
| `GET` | `/api/sim` | Simulator status and available scenarios. |

Socket.IO: namespace `/ship` in real time and `/ground` with a delay, where each event arrives wrapped with `originalAt` and `deliveredAt`. Events: `snapshot`, `telemetry`, `alert`, `alert:resolved`, `alert:ack`, `node:status`, `symptom`.

## Telemetry contract v1 (frozen)

Defined in [`packages/shared/src/index.ts`](packages/shared/src/index.ts). The wristband (over MQTT or HTTP) and the simulator send exactly the same shape:

```json
{
  "v": 1,
  "deviceId": "node-01",
  "bootId": 1834552011,
  "seq": 4821,
  "bootMs": 523000,
  "ts": 1794677601000,
  "source": "device",
  "vitals": { "bpm": 72, "spo2": 97, "quality": "ok" },
  "motion": { "sensor": "mpu6050", "accMag": 1.02, "gyroMag": 3.4, "activity": "rest", "impact": false },
  "env": { "tempC": 23.1, "rh": 41.5, "pressureKpa": 101.2, "coPpm": 2.1, "coState": "ready" },
  "localAlert": { "level": "none", "rules": [] }
}
```

- A missing sensor or invalid reading is `null`, never `0` or `-1`, and every reading carries its quality (`quality` and `coState` can also be `no_sensor`). The app never shows a doubtful number as reliable.
- Every key is always present and extra keys are rejected, with the exact reason.
- `bootId` is random on every ESP32 boot, so readings do not collide when `seq` restarts at 0. A resend with the same `(deviceId, bootId, seq)` is ignored.
- `ts` is `null` if the ESP32 has not synced NTP. The server rebuilds the time from `bootMs`.
- `localAlert` is what the wristband decided on its own (buzzer and OLED), without the network.
- `coPpm` holds the relative CO index (0 to 40), not real ppm.

## Hardware

ESP32 DevKit V1, MAX30100 (pulse and SpO2), MPU6050 (motion and impacts), AHT20 + BMP280 (temperature, humidity, pressure), MQ-7 (carbon monoxide), SSD1306 OLED and an active buzzer. Diagrams in [`docs/hardware`](docs/hardware).

```bash
cd firmware
cp include/config.example.h include/config.h   # Wi-Fi, broker address, MQTT password
pio run -t upload && pio device monitor
```

The firmware in this repository covers Wi-Fi, NTP and publishing the contract over MQTT; sensor readings are integrated in `readSensors()`.

## Tests

```bash
npm test     # contract, topics, local alert and the 8 scenarios through the rule engine
```

## Limitations

- It does not diagnose. It detects signals and suggests general actions.
- Thresholds come from public references and were not reviewed by a clinician.
- "Stress" is inferred from pulse and motion; caffeine, fever or poor sleep look the same.
- Critical scenarios (CO leak, depressurization, hypoxia) can only be simulated.
- It covers cardiovascular signals, cabin air and self-reported symptoms. It does not measure radiation, bone loss or immune changes.
- The link to Earth is a configurable delay on one server, not a real space link.
- Authentication is an API key for the device only; a real medical system needs encryption and role-based access.
