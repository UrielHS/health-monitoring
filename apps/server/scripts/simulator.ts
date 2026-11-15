/**
 * Simulador de la pulsera desde la terminal. Envía el mismo contrato v1 que el ESP32.
 *
 * Uso:
 *   npm run sim -- --scenario co                       (por HTTP, como respaldo)
 *   npm run sim -- --scenario co --mqtt                 (por Mosquitto: pulsera de prueba test-01)
 *   npm run sim -- --scenario hypoxia --warmup 20 --url http://192.168.137.1:3000
 *
 * Escenarios: normal, exercise, stress, co, hypoxia, depressurization, impact, offline
 * Durante --warmup segundos envía datos normales y después aplica el escenario,
 * que llega a su punto máximo en --ramp segundos.
 *
 * La app usa el mismo generador a través de POST /api/sim/:escenario.
 */
import { connect } from "mqtt";
import { TOPICS, type Telemetry } from "@astro/shared";
import { SCENARIOS, createSimulator, isScenario } from "../src/sim.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

const useMqtt = process.argv.includes("--mqtt");
const url = arg("url", process.env.SIM_URL ?? "http://127.0.0.1:3000");
const key = arg("key", process.env.SIM_API_KEY ?? "dev-key");
const broker = arg("broker", process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883");
// Por MQTT se conecta como la pulsera de prueba test-01 (usuario del broker = deviceId) y manda
// source "device": así recorre exactamente el camino de la pulsera real y la app la muestra en "Live wristband".
// Por HTTP sigue siendo el nodo simulado sim-01 (source "sim").
const deviceId = arg("device", useMqtt ? "test-01" : "sim-01");
const scenario = arg("scenario", "normal");
const intervalMs = Number(arg("interval", "2000"));
const warmupSec = Number(arg("warmup", "10"));
const rampSec = Number(arg("ramp", "60"));

if (!isScenario(scenario)) {
  console.error(`Escenario inválido: ${scenario}. Opciones: ${SCENARIOS.join(", ")}`);
  process.exit(1);
}

const sim = createSimulator({ deviceId, scenario, warmupSec, rampSec });
const asDevice = (b: Telemetry): Telemetry => (useMqtt ? { ...b, source: "device" } : b);
const line = (b: Telemetry) =>
  `[sim] #${b.seq} ${sim.phase().padEnd(16)} bpm=${b.vitals.bpm} spo2=${b.vitals.spo2} co=${b.env.coPpm} p=${b.env.pressureKpa} local=${b.localAlert.level}`;

// ---------- por MQTT: se conecta como una pulsera más (usuario del broker = deviceId) ----------
const mqtt = useMqtt
  ? connect(broker, {
      clientId: `${deviceId}-${process.pid}`,
      username: arg("mqtt-user", process.env.SIM_MQTT_USER ?? deviceId),
      password: arg("mqtt-pass", process.env.SIM_MQTT_PASS ?? `clave-${deviceId}`),
      keepalive: 5,
      reconnectPeriod: 2000,
      will: { topic: TOPICS.status(deviceId), payload: Buffer.from("offline"), qos: 1, retain: true },
    })
  : null;

if (mqtt) {
  mqtt.on("connect", () => {
    console.log(`[sim] conectado al broker ${broker} como ${deviceId}`);
    mqtt.publish(TOPICS.status(deviceId), "online", { qos: 1, retain: true });
    mqtt.subscribe(TOPICS.errors(deviceId));
  });
  mqtt.on("message", (_t, m) => console.log(`[sim] RECHAZADO por el servidor: ${m.toString()}`));
  mqtt.on("error", (e) => console.error(`[sim] broker: ${e.message}`));
}

async function tick() {
  const body = sim.next();
  if (!body) {
    console.log("[sim] escenario offline: dejo de enviar. Ctrl+C para salir.");
    clearInterval(timer);
    // Sin desconectarse "bonito": así el broker publica el Last Will, igual que si la pulsera se apagara.
    mqtt?.end(true);
    return;
  }
  if (mqtt) {
    if (!mqtt.connected) return console.log(`[sim] #${body.seq} sin conexión con el broker ${broker}`);
    mqtt.publish(TOPICS.telemetry(deviceId), JSON.stringify(asDevice(body)), { qos: 0 });
    return console.log(`${line(body)} → mqtt`);
  }
  try {
    const res = await fetch(`${url}/api/telemetria`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
    });
    console.log(`${line(body)} → ${res.status}${res.ok ? "" : " " + (await res.text())}`);
  } catch (e) {
    console.error(`[sim] sin conexión con ${url}:`, (e as Error).message);
  }
}

console.log(`[sim] ${deviceId} → ${useMqtt ? broker : url}  escenario=${scenario}  warmup=${warmupSec}s  ramp=${rampSec}s`);
const timer = setInterval(tick, intervalMs);
void tick();

process.on("SIGINT", () => {
  clearInterval(timer);
  if (!mqtt) process.exit(0);
  mqtt.publish(TOPICS.status(deviceId), "offline", { qos: 1, retain: true }, () => mqtt.end(false, {}, () => process.exit(0)));
});
