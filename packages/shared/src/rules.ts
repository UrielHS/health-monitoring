import type { AlertLevel, Reading } from "./index.js";

/**
 * Motor de reglas compartido. Lo usa el servidor (Nave) y también la app cuando corre
 * en modo demo sin servidor, para que las alertas sean las mismas en ambos casos.
 *
 * Umbrales iniciales del prototipo (sección 6 del documento). No son criterios médicos.
 * GET /api/config los expone para que el firmware use los mismos valores.
 */
export const THRESHOLDS = {
  spo2: { warning: 94, critical: 90 },
  heartRate: { restHigh: 100, restLow: 50, criticalHigh: 130, criticalHighActive: 185, criticalLow: 40 },
  co: { warning: 9, critical: 35 },
  pressure: { criticalAbsKpa: 95, warningDrop5m: 1, criticalDrop5m: 3 },
  tempC: { warning: [18, 27], critical: [15, 32] },
  rh: { warning: [25, 70], critical: [15, 80] },
  stressFactor: 1.25,
} as const;

type DeviceState = {
  baselineSamples: number[];
  baselineBpm: number | null;
  pressureHistory: { t: number; p: number }[];
  /** Desde cuándo se cumple la condición de cada regla (ms, hora de la lectura). */
  since: Map<string, number>;
  /** Reglas con alerta activa. */
  active: Set<string>;
  /** Cuándo se levantó cada alerta activa (ms, hora de la lectura). */
  raisedAt: Map<string, number>;
};

type Ctx = { r: Reading; st: DeviceState; pressureDrop: number | null };

export type Rule = {
  id: string;
  level: AlertLevel;
  /** Segundos que la condición debe mantenerse antes de alertar. */
  minSec: number;
  /** Las alertas "sticky" no se cierran solas; se cierran al reconocerlas. */
  sticky?: boolean;
  test: (c: Ctx) => boolean;
  title: string;
  message: (c: Ctx) => string;
  action: string;
};

const T = THRESHOLDS;
const ppgOk = (r: Reading) => r.vitals.quality === "ok";
const outside = (v: number | null, [lo, hi]: readonly [number, number]) =>
  v !== null && (v < lo || v > hi);
const fmt = (v: number | null, d = 0) => (v === null ? "—" : v.toFixed(d));

export const IMPACT_NO_RESPONSE = "impact_no_response";
/** Segundos sin respuesta tras un impacto antes de escalar a peligro. */
export const IMPACT_ESCALATE_SEC = 30;

export const RULES: Rule[] = [
  {
    id: "spo2_critical",
    level: "critical",
    minSec: 10,
    test: ({ r }) => ppgOk(r) && r.vitals.spo2 !== null && r.vitals.spo2 <= T.spo2.critical,
    title: "Very low blood oxygen",
    message: ({ r }) => `Your blood oxygen is ${fmt(r.vitals.spo2)}%. Your body is not getting enough oxygen.`,
    action: "Stop all activity, put on an oxygen mask and alert the crew.",
  },
  {
    id: "spo2_warning",
    level: "warning",
    minSec: 30,
    test: ({ r }) =>
      ppgOk(r) && r.vitals.spo2 !== null && r.vitals.spo2 > T.spo2.critical && r.vitals.spo2 <= T.spo2.warning,
    title: "Low blood oxygen",
    message: ({ r }) => `Your blood oxygen is ${fmt(r.vitals.spo2)}%, below the normal 95%.`,
    action: "Rest, breathe slowly and check that the sensor is on your finger.",
  },
  {
    id: "hr_critical",
    level: "critical",
    minSec: 30,
    // Con ejercicio el límite alto sube: un pulso de 135 haciendo sentadillas es normal.
    test: ({ r }) =>
      ppgOk(r) &&
      r.vitals.bpm !== null &&
      (r.vitals.bpm > (r.motion.activity === "active" ? T.heartRate.criticalHighActive : T.heartRate.criticalHigh) ||
        r.vitals.bpm < T.heartRate.criticalLow),
    title: "Abnormal heart rate",
    message: ({ r }) => `Your heart rate is ${fmt(r.vitals.bpm)} BPM and has stayed there for 30 s.`,
    action: "Stop, anchor yourself and contact the crew medical officer.",
  },
  {
    id: "hr_rest_warning",
    level: "warning",
    minSec: 120,
    test: ({ r }) =>
      ppgOk(r) &&
      r.motion.activity === "rest" &&
      r.vitals.bpm !== null &&
      r.vitals.bpm <= T.heartRate.criticalHigh &&
      r.vitals.bpm >= T.heartRate.criticalLow &&
      (r.vitals.bpm > T.heartRate.restHigh || r.vitals.bpm < T.heartRate.restLow),
    title: "Unusual heart rate at rest",
    message: ({ r }) => `Your heart rate is ${fmt(r.vitals.bpm)} BPM while you are resting.`,
    action: "Stay still for a few minutes. If it continues, contact the crew medical officer.",
  },
  {
    // Regla combinada: pulso alto sin movimiento = posible estrés agudo.
    id: "acute_stress",
    level: "warning",
    minSec: 300,
    test: ({ r, st }) =>
      ppgOk(r) &&
      st.baselineBpm !== null &&
      r.motion.activity === "rest" &&
      r.vitals.bpm !== null &&
      r.vitals.bpm >= st.baselineBpm * T.stressFactor,
    title: "Possible acute stress",
    message: ({ r, st }) => {
      const pct = st.baselineBpm && r.vitals.bpm ? Math.round((r.vitals.bpm / st.baselineBpm - 1) * 100) : 0;
      return `Your heart rate is ${pct}% above your personal baseline while you are not moving. It could be stress, caffeine, fever or lack of sleep.`;
    },
    action: "Try a 2-minute guided breathing exercise and log how you feel.",
  },
  {
    // El CO alerta solo: el oxímetro confunde la hemoglobina con CO con la oxigenada.
    id: "co_critical",
    level: "critical",
    minSec: 10,
    test: ({ r }) => r.env.coState === "ready" && r.env.coPpm !== null && r.env.coPpm >= T.co.critical,
    title: "Carbon monoxide detected",
    message: ({ r }) =>
      `CO is at ${fmt(r.env.coPpm)} ppm. Your oximeter may still read normal (${fmt(r.vitals.spo2)}%) even if you are affected, because CO looks like oxygen to it.`,
    action: "Put on a mask, leave the area and alert the crew.",
  },
  {
    id: "co_warning",
    level: "warning",
    minSec: 10,
    test: ({ r }) =>
      r.env.coState === "ready" && r.env.coPpm !== null && r.env.coPpm >= T.co.warning && r.env.coPpm < T.co.critical,
    title: "Carbon monoxide rising",
    message: ({ r }) => `CO is at ${fmt(r.env.coPpm)} ppm and rising above normal.`,
    action: "Check for overheating equipment nearby and stay alert to headache or dizziness.",
  },
  {
    // Regla combinada: caída de presión + oxigenación baja.
    id: "pressure_spo2",
    level: "critical",
    minSec: 0,
    test: ({ r, pressureDrop }) =>
      pressureDrop !== null &&
      pressureDrop >= T.pressure.warningDrop5m &&
      r.vitals.spo2 !== null &&
      r.vitals.spo2 <= T.spo2.warning,
    title: "Cabin pressure drop with low oxygen",
    message: ({ r, pressureDrop }) =>
      `Cabin pressure fell ${fmt(pressureDrop, 1)} kPa in 5 min and your blood oxygen is ${fmt(r.vitals.spo2)}%.`,
    action: "Move to the safe module, put on a mask and alert the crew immediately.",
  },
  {
    id: "pressure_critical",
    level: "critical",
    minSec: 0,
    test: ({ r, pressureDrop }) =>
      (r.env.pressureKpa !== null && r.env.pressureKpa < T.pressure.criticalAbsKpa) ||
      (pressureDrop !== null && pressureDrop >= T.pressure.criticalDrop5m),
    title: "Cabin depressurization",
    message: ({ r, pressureDrop }) =>
      `Cabin pressure is ${fmt(r.env.pressureKpa, 1)} kPa (dropped ${fmt(pressureDrop, 1)} kPa in 5 min).`,
    action: "Follow the depressurization procedure and move to the safe module.",
  },
  {
    id: "pressure_warning",
    level: "warning",
    minSec: 0,
    test: ({ r, pressureDrop }) =>
      pressureDrop !== null &&
      pressureDrop >= T.pressure.warningDrop5m &&
      pressureDrop < T.pressure.criticalDrop5m &&
      (r.env.pressureKpa === null || r.env.pressureKpa >= T.pressure.criticalAbsKpa) &&
      // Si además baja la oxigenación, ya la cubre pressure_spo2.
      !(r.vitals.spo2 !== null && r.vitals.spo2 <= T.spo2.warning),
    title: "Cabin pressure dropping",
    message: ({ pressureDrop }) => `Cabin pressure fell ${fmt(pressureDrop, 1)} kPa in the last 5 minutes.`,
    action: "Report it to the crew and watch for a possible leak.",
  },
  {
    id: "cabin_temp_critical",
    level: "critical",
    minSec: 60,
    test: ({ r }) => outside(r.env.tempC, T.tempC.critical),
    title: "Cabin temperature out of safe range",
    message: ({ r }) => `Cabin temperature is ${fmt(r.env.tempC, 1)} °C.`,
    action: "Report it to the crew and check the thermal control system.",
  },
  {
    id: "cabin_temp_warning",
    level: "warning",
    minSec: 60,
    test: ({ r }) => outside(r.env.tempC, T.tempC.warning) && !outside(r.env.tempC, T.tempC.critical),
    title: "Cabin temperature unusual",
    message: ({ r }) => `Cabin temperature is ${fmt(r.env.tempC, 1)} °C (normal: 18–27 °C).`,
    action: "Stay hydrated and report it if it continues.",
  },
  {
    id: "humidity_critical",
    level: "critical",
    minSec: 60,
    test: ({ r }) => outside(r.env.rh, T.rh.critical),
    title: "Cabin humidity out of safe range",
    message: ({ r }) => `Relative humidity is ${fmt(r.env.rh)}%.`,
    action: "Report it to the crew and check the humidity control system.",
  },
  {
    id: "humidity_warning",
    level: "warning",
    minSec: 60,
    test: ({ r }) => outside(r.env.rh, T.rh.warning) && !outside(r.env.rh, T.rh.critical),
    title: "Cabin humidity unusual",
    message: ({ r }) => `Relative humidity is ${fmt(r.env.rh)}% (normal: 25–70%).`,
    action: "Report it if it continues.",
  },
  {
    id: "impact",
    level: "warning",
    minSec: 0,
    sticky: true,
    test: ({ r }) => r.motion.impact,
    title: "Impact detected",
    message: () => "A strong impact was detected by your wearable.",
    action: "Are you okay? Acknowledge this alert so the crew knows.",
  },
  {
    // Sin respuesta al "¿Estás bien?": escala a peligro (sección 6, regla de impacto).
    id: IMPACT_NO_RESPONSE,
    level: "critical",
    minSec: 0,
    sticky: true,
    // No se acelera con timeScale: es el tiempo que tiene la persona para contestar.
    test: ({ r, st }) => {
      const at = st.raisedAt.get("impact");
      return st.active.has("impact") && at !== undefined && r.ts - at >= IMPACT_ESCALATE_SEC * 1000;
    },
    title: "No response after impact",
    message: () => "A strong impact was detected and nobody confirmed the astronaut is okay.",
    action: "Crew: check on the astronaut now.",
  },
  {
    id: "ppg_noisy",
    level: "info",
    minSec: 60,
    test: ({ r }) => r.vitals.quality === "noisy",
    title: "Unreliable pulse reading",
    message: () => "The pulse sensor has been noisy for a minute, so heart rate and oxygen are not reliable.",
    action: "Adjust the sensor on your finger and hold still for a few seconds.",
  },
];

export const NODE_OFFLINE = {
  id: "node_offline",
  level: "critical" as AlertLevel,
  title: "No signal from wearable",
  action: "Check that the wearable is on, charged and within Wi-Fi range.",
};

export type RuleHit = { rule: Rule; values: Record<string, unknown>; message: string };

export type RuleEngineOptions = {
  /** Multiplica las duraciones mínimas de las reglas. 0.1 = demo 10 veces más rápida. */
  timeScale?: number;
  /** Lecturas en reposo usadas para calcular el pulso base personal. */
  baselineSamples?: number;
};

export class RuleEngine {
  private devices = new Map<string, DeviceState>();
  readonly timeScale: number;
  readonly baselineSamples: number;

  constructor(opts: RuleEngineOptions = {}) {
    this.timeScale = opts.timeScale ?? 1;
    this.baselineSamples = opts.baselineSamples ?? 30;
  }

  private state(deviceId: string): DeviceState {
    let st = this.devices.get(deviceId);
    if (!st) {
      st = { baselineSamples: [], baselineBpm: null, pressureHistory: [], since: new Map(), active: new Set(), raisedAt: new Map() };
      this.devices.set(deviceId, st);
    }
    return st;
  }

  baseline(deviceId: string): number | null {
    return this.devices.get(deviceId)?.baselineBpm ?? null;
  }

  /** Marca como cerrada una alerta sticky (al reconocerla). */
  release(deviceId: string, ruleId: string) {
    const st = this.devices.get(deviceId);
    st?.active.delete(ruleId);
    st?.since.delete(ruleId);
    st?.raisedAt.delete(ruleId);
  }

  /** Levanta una regla a mano (por ejemplo "Call the crew" tras un impacto). Devuelve false si ya estaba activa. */
  force(deviceId: string, ruleId: string, now: number): boolean {
    const st = this.state(deviceId);
    if (st.active.has(ruleId)) return false;
    st.active.add(ruleId);
    st.raisedAt.set(ruleId, now);
    return true;
  }

  evaluate(r: Reading): { raised: RuleHit[]; resolved: string[] } {
    const st = this.state(r.deviceId);
    this.updateBaseline(r, st);
    const pressureDrop = this.updatePressure(r, st);
    const ctx: Ctx = { r, st, pressureDrop };

    const raised: RuleHit[] = [];
    const resolved: string[] = [];

    for (const rule of RULES) {
      const holds = rule.test(ctx);
      if (holds) {
        if (!st.since.has(rule.id)) st.since.set(rule.id, r.ts);
        const heldMs = r.ts - (st.since.get(rule.id) ?? r.ts);
        if (!st.active.has(rule.id) && heldMs >= rule.minSec * 1000 * this.timeScale) {
          st.active.add(rule.id);
          st.raisedAt.set(rule.id, r.ts);
          raised.push({ rule, message: rule.message(ctx), values: snapshot(r, st, pressureDrop) });
        }
      } else {
        st.since.delete(rule.id);
        if (st.active.has(rule.id) && !rule.sticky) {
          st.active.delete(rule.id);
          st.raisedAt.delete(rule.id);
          resolved.push(rule.id);
        }
      }
    }
    return { raised, resolved };
  }

  private updateBaseline(r: Reading, st: DeviceState) {
    if (st.baselineBpm !== null) return;
    if (r.motion.activity !== "rest" || !ppgOk(r) || r.vitals.bpm === null) return;
    st.baselineSamples.push(r.vitals.bpm);
    if (st.baselineSamples.length >= this.baselineSamples) {
      const sorted = [...st.baselineSamples].sort((a, b) => a - b);
      st.baselineBpm = sorted[Math.floor(sorted.length / 2)];
    }
  }

  /** Devuelve cuántos kPa bajó la presión respecto al máximo de los últimos 5 minutos. */
  private updatePressure(r: Reading, st: DeviceState): number | null {
    if (r.env.pressureKpa === null) return null;
    st.pressureHistory.push({ t: r.ts, p: r.env.pressureKpa });
    const cutoff = r.ts - 5 * 60_000;
    st.pressureHistory = st.pressureHistory.filter((h) => h.t >= cutoff);
    const max = Math.max(...st.pressureHistory.map((h) => h.p));
    return Math.max(0, max - r.env.pressureKpa);
  }
}

function snapshot(r: Reading, st: DeviceState, pressureDrop: number | null) {
  return {
    bpm: r.vitals.bpm,
    spo2: r.vitals.spo2,
    activity: r.motion.activity,
    accMag: r.motion.accMag,
    coPpm: r.env.coPpm,
    pressureKpa: r.env.pressureKpa,
    pressureDrop5m: pressureDrop,
    tempC: r.env.tempC,
    rh: r.env.rh,
    baselineBpm: st.baselineBpm,
  };
}
