/**
 * Simulador de la pulsera. Envía el mismo contrato que el ESP32.
 *
 * Uso:
 *   npm run sim -- --scenario co
 *   npm run sim -- --scenario hypoxia --warmup 20 --url http://192.168.1.50:3000
 *
 * Escenarios: normal, exercise, stress, co, hypoxia, depressurization, impact, offline
 * Durante --warmup segundos envía datos normales y después aplica el escenario.
 */
import type { TelemetryInput } from "@astro/shared";

const SCENARIOS = ["normal", "exercise", "stress", "co", "hypoxia", "depressurization", "impact", "offline"] as const;
type Scenario = (typeof SCENARIOS)[number];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg("url", process.env.SIM_URL ?? "http://localhost:3000");
const key = arg("key", process.env.SIM_API_KEY ?? "dev-key");
const deviceId = arg("device", "sim-01");
const scenario = arg("scenario", "normal") as Scenario;
const intervalMs = Number(arg("interval", "2000"));
const warmupSec = Number(arg("warmup", "10"));

if (!SCENARIOS.includes(scenario)) {
  console.error(`Escenario inválido: ${scenario}. Opciones: ${SCENARIOS.join(", ")}`);
  process.exit(1);
}

const bootId = Math.floor(Math.random() * 0x7fffffff);
const start = Date.now();
let seq = 0;

const jitter = (v: number, amp: number) => v + (Math.random() * 2 - 1) * amp;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function packet(): TelemetryInput {
  const elapsed = (Date.now() - start) / 1000;
  const active = elapsed >= warmupSec;
  /** Progreso del escenario de 0 a 1 durante 60 s. */
  const p = active ? clamp((elapsed - warmupSec) / 60, 0, 1) : 0;

  let bpm = jitter(72, 3);
  let spo2 = jitter(97.5, 0.8);
  let activity: "rest" | "light" | "active" = "rest";
  let accMag = jitter(1.0, 0.02);
  let gyroMag = jitter(2, 1);
  let impact = false;
  let pressureKpa = jitter(101.3, 0.05);
  let coPpm = jitter(1.5, 0.5);

  if (active) {
    switch (scenario) {
      case "exercise":
        bpm = jitter(72 + 63 * p, 3);
        activity = "active";
        accMag = jitter(1.6, 0.3);
        gyroMag = jitter(80, 20);
        break;
      case "stress":
        bpm = jitter(72 + 33 * p, 2);
        break;
      case "co":
        // El oxímetro sigue marcando normal: es justo lo que hay que demostrar.
        coPpm = jitter(1.5 + 70 * p, 1);
        spo2 = jitter(98, 0.5);
        bpm = jitter(72 + 18 * p, 2);
        break;
      case "hypoxia":
        spo2 = jitter(97.5 - 11 * p, 0.5);
        bpm = jitter(72 + 25 * p, 2);
        break;
      case "depressurization":
        pressureKpa = jitter(101.3 - 5 * p, 0.05);
        spo2 = jitter(97.5 - 6 * p, 0.5);
        bpm = jitter(72 + 20 * p, 2);
        break;
      case "impact":
        impact = seq % 30 === 0;
        accMag = impact ? 6.5 : accMag;
        break;
    }
  }

  return {
    deviceId,
    bootId,
    seq: seq++,
    bootMs: Date.now() - start,
    ts: Date.now(),
    source: "sim",
    vitals: { bpm: round(bpm, 0), spo2: round(clamp(spo2, 0, 100), 0), quality: "ok" },
    motion: { accMag: round(accMag, 2), gyroMag: round(gyroMag, 1), activity, impact },
    env: {
      tempC: round(jitter(22.5, 0.2)),
      rh: round(jitter(42, 1)),
      pressureKpa: round(pressureKpa, 2),
      coPpm: round(Math.max(0, coPpm)),
      coState: "ready",
    },
    localAlert: "none",
  };
}

async function tick() {
  const elapsed = (Date.now() - start) / 1000;
  if (scenario === "offline" && elapsed >= warmupSec) {
    console.log("[sim] escenario offline: dejo de enviar. Ctrl+C para salir.");
    clearInterval(timer);
    return;
  }
  const body = packet();
  try {
    const res = await fetch(`${url}/api/telemetria`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
    });
    const phase = elapsed >= warmupSec ? scenario : "warmup";
    console.log(
      `[sim] #${body.seq} ${phase.padEnd(16)} bpm=${body.vitals.bpm} spo2=${body.vitals.spo2} co=${body.env.coPpm} p=${body.env.pressureKpa} → ${res.status}`,
    );
  } catch (e) {
    console.error(`[sim] sin conexión con ${url}:`, (e as Error).message);
  }
}

console.log(`[sim] ${deviceId} → ${url}  escenario=${scenario}  warmup=${warmupSec}s`);
const timer = setInterval(tick, intervalMs);
void tick();
