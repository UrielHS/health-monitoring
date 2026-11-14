/**
 * Simulador de la pulsera desde la terminal. Envía el mismo contrato que el ESP32.
 *
 * Uso:
 *   npm run sim -- --scenario co
 *   npm run sim -- --scenario hypoxia --warmup 20 --url http://192.168.137.1:3000
 *
 * Escenarios: normal, exercise, stress, co, hypoxia, depressurization, impact, offline
 * Durante --warmup segundos envía datos normales y después aplica el escenario,
 * que llega a su punto máximo en --ramp segundos.
 *
 * La app usa el mismo generador a través de POST /api/sim/:escenario.
 */
import { SCENARIOS, createSimulator, isScenario } from "../src/sim.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg("url", process.env.SIM_URL ?? "http://localhost:3000");
const key = arg("key", process.env.SIM_API_KEY ?? "dev-key");
const deviceId = arg("device", "sim-01");
const scenario = arg("scenario", "normal");
const intervalMs = Number(arg("interval", "2000"));
const warmupSec = Number(arg("warmup", "10"));
const rampSec = Number(arg("ramp", "60"));

if (!isScenario(scenario)) {
  console.error(`Escenario inválido: ${scenario}. Opciones: ${SCENARIOS.join(", ")}`);
  process.exit(1);
}

const sim = createSimulator({ deviceId, scenario, warmupSec, rampSec });

async function tick() {
  const body = sim.next();
  if (!body) {
    console.log("[sim] escenario offline: dejo de enviar. Ctrl+C para salir.");
    clearInterval(timer);
    return;
  }
  try {
    const res = await fetch(`${url}/api/telemetria`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
    });
    console.log(
      `[sim] #${body.seq} ${sim.phase().padEnd(16)} bpm=${body.vitals.bpm} spo2=${body.vitals.spo2} co=${body.env.coPpm} p=${body.env.pressureKpa} → ${res.status}`,
    );
  } catch (e) {
    console.error(`[sim] sin conexión con ${url}:`, (e as Error).message);
  }
}

console.log(`[sim] ${deviceId} → ${url}  escenario=${scenario}  warmup=${warmupSec}s  ramp=${rampSec}s`);
const timer = setInterval(tick, intervalMs);
void tick();
