import type { TelemetryInput } from "./index.js";

/**
 * Generador de lecturas simuladas. Lo usan el script de terminal (scripts/simulator.ts)
 * y el endpoint POST /api/sim/:escenario, para que el simulador de la app pase por
 * el mismo motor de reglas que la pulsera real.
 */
export const SCENARIOS = ["normal", "exercise", "stress", "co", "hypoxia", "depressurization", "impact", "offline"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const isScenario = (s: string): s is Scenario => (SCENARIOS as readonly string[]).includes(s);

const jitter = (v: number, amp: number) => v + (Math.random() * 2 - 1) * amp;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export type SimOptions = {
  deviceId: string;
  scenario: Scenario;
  /** Segundos de datos normales antes de aplicar el escenario. */
  warmupSec: number;
  /** Segundos que tarda el escenario en llegar a su punto máximo. */
  rampSec: number;
};

export function createSimulator({ deviceId, scenario, warmupSec, rampSec }: SimOptions) {
  const bootId = Math.floor(Math.random() * 0x7fffffff);
  const start = Date.now();
  let seq = 0;

  const elapsedSec = () => (Date.now() - start) / 1000;
  const active = () => elapsedSec() >= warmupSec;

  /** Devuelve la siguiente lectura, o null si el escenario "offline" ya dejó de enviar. */
  function next(): TelemetryInput | null {
    if (scenario === "offline" && active()) return null;

    const p = active() ? clamp((elapsedSec() - warmupSec) / Math.max(rampSec, 1), 0, 1) : 0;

    let bpm = jitter(72, 3);
    let spo2 = jitter(97.5, 0.8);
    let activity: "rest" | "light" | "active" = "rest";
    let accMag = jitter(1.0, 0.02);
    let gyroMag = jitter(2, 1);
    let impact = false;
    let pressureKpa = jitter(101.3, 0.05);
    let coPpm = jitter(1.5, 0.5);

    if (active()) {
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
          coPpm = jitter(1.5 + 38 * p, 1);
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
        coPpm: round(clamp(coPpm, 0, 40)),
        coState: "ready",
      },
      localAlert: "none",
    };
  }

  return { next, scenario, deviceId, phase: () => (active() ? scenario : "warmup") };
}
