// Convierte lo que manda el servidor (última lectura, alertas activas, estado del nodo)
// en lo que pinta la pantalla: un estado por zona del cuerpo y un aviso central.
// Las alertas las decide el motor de reglas del servidor; aquí no se inventa ninguna.

import { RULES, type NodeStatus, type Reading } from "@astro/shared";
import { RULE_COPY } from "./copy";
import {
  LEVEL_RANK,
  type Banner,
  type EnvReading,
  type Evaluation,
  type Level,
  type SeenAlert,
  type ZoneId,
  type ZoneState,
} from "./types";

// Si backend agrega una regla y falta su texto corto, que se note al desarrollar.
if (import.meta.env.DEV)
  for (const rule of RULES) if (!RULE_COPY[rule.id]) console.warn(`[copy] falta RULE_COPY para la regla "${rule.id}"`);

export type Audience = "ship" | "ground";

export interface EvaluateInput {
  reading: Reading | null;
  alerts: SeenAlert[];
  node: NodeStatus | null;
  /** Hay conexión con el servidor de la Nave. */
  linked: boolean;
  audience: Audience;
}

const ALERT_LEVEL: Record<string, Level> = { critical: "danger", warning: "caution", info: "unreliable" };
const levelOf = (a: SeenAlert): Level => ALERT_LEVEL[a.level] ?? "caution";

const worst = (levels: Level[]): Level =>
  levels.reduce<Level>((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a), "nominal");

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fix = (v: number | null | undefined, d = 0) => (v == null ? "—" : v.toFixed(d));

const offlineZone = (): ZoneState => ({ level: "offline", value: "—" });

/** El MQ-7 no está calibrado: el CO es un índice relativo de 0 a 40, nunca ppm (sección 12 del documento). */
export const CO_UNIT = "CO index (relative)";

function emptyEvaluation(banner: Banner | null): Evaluation {
  return {
    overall: "offline",
    zones: { head: offlineZone(), heart: offlineZone(), lungs: offlineZone(), body: offlineZone(), cabin: offlineZone() },
    env: [],
    exercising: false,
    coTrap: false,
    banner,
    impact: null,
    impactEscalated: null,
  };
}

export function evaluate({ reading: r, alerts, node, linked, audience }: EvaluateInput): Evaluation {
  const ground = audience === "ground";

  if (!linked) {
    return emptyEvaluation({
      level: "offline",
      title: "No connection to the ship server",
      action: "This screen is not receiving data. Silence is not “all good”.",
      note: "The wristband's own buzzer and screen still alarm without the network.",
    });
  }
  if (!r) {
    return emptyEvaluation({
      level: "offline",
      title: ground ? "Waiting for data from the ship" : "Waiting for the wristband",
      action: ground ? "Nothing has reached Earth yet." : "No packet received yet.",
    });
  }
  const offlineAlert = alerts.find((a) => a.ruleId === "node_offline");
  if (offlineAlert || (node && !node.online)) {
    return emptyEvaluation({
      level: "offline",
      title: "No signal from the wristband",
      action: "Silence is not “all good”.",
      note: ground
        ? "The crew sees this too. The wristband's own buzzer still alarms without the network."
        : "Check the wristband. Its own buzzer and screen still alarm without the network.",
    });
  }

  // ---------- alertas activas por zona ----------
  const byZone: Record<ZoneId, SeenAlert[]> = { head: [], heart: [], lungs: [], body: [], cabin: [] };
  const ranked = [...alerts].sort(
    (a, b) => LEVEL_RANK[levelOf(b)] - LEVEL_RANK[levelOf(a)] || b.startedAt - a.startedAt,
  );
  for (const a of ranked) for (const z of RULE_COPY[a.ruleId]?.zones ?? []) byZone[z].push(a);
  const has = (id: string) => alerts.some((a) => a.ruleId === id);

  const { bpm, spo2, quality } = r.vitals;
  const vitalsOk = quality === "ok" && bpm != null && spo2 != null;
  const coDanger = has("co_critical");
  const coTrap = coDanger && vitalsOk && (spo2 as number) > 94;

  /** Estado de una zona a partir de su alerta más grave. */
  const fromAlert = (a: SeenAlert, value: string, unit?: string): ZoneState => {
    const copy = RULE_COPY[a.ruleId];
    return {
      level: levelOf(a),
      value,
      unit,
      headline: a.title,
      detail: ground ? `Astronaut was told: ${lowerFirst(copy?.short ?? a.action)}` : a.message,
      action: ground ? (copy?.ground ?? "Follow up with the crew.") : (copy?.short ?? a.action),
      alert: a,
    };
  };

  const unreliable = (value = "—"): ZoneState => ({
    level: "unreliable",
    value,
    headline: quality === "no_finger" ? "No finger on the sensor" : "Reading not reliable",
    detail:
      quality === "no_finger"
        ? "The pulse sensor is not touching the skin, so there is no number to trust."
        : "Too much movement or noise in the pulse sensor.",
    action: ground ? "Wait for a clean reading." : "Re-seat the sensor. Hold still.",
  });

  // ---------- corazón ----------
  const active = r.motion.activity === "active";
  const exercising = vitalsOk && active && (bpm as number) > 100 && !byZone.heart.some((a) => levelOf(a) === "danger");
  let heart: ZoneState;
  if (!vitalsOk) heart = unreliable();
  else if (byZone.heart[0] && levelOf(byZone.heart[0]) !== "unreliable") heart = fromAlert(byZone.heart[0], fix(bpm), "BPM");
  else heart = { level: "nominal", value: fix(bpm), unit: "BPM", note: exercising ? "Exercise detected · no alert" : undefined };

  // ---------- oxígeno en sangre ----------
  let lungs: ZoneState;
  if (!vitalsOk) lungs = unreliable();
  else if (coTrap)
    lungs = {
      level: "danger",
      value: fix(spo2),
      unit: "%",
      headline: "Reading not reliable",
      detail: ground
        ? "CO present: the oximeter overestimates oxygen."
        : `CO binds to blood and the oximeter reads it as oxygen. ${fix(spo2)}% is false here.`,
      action: ground ? "Watch the CO trend." : "Trust the CO alarm.",
    };
  else if (byZone.lungs[0] && levelOf(byZone.lungs[0]) !== "unreliable") lungs = fromAlert(byZone.lungs[0], fix(spo2), "%");
  else lungs = { level: "nominal", value: fix(spo2), unit: "%" };

  // ---------- mente ----------
  let head: ZoneState;
  if (!vitalsOk) head = { ...unreliable(), headline: "Cannot estimate", detail: "Needs a clean pulse reading." };
  else if (byZone.head[0]) {
    const base = num(byZone.head[0].values.baselineBpm);
    const pct = base ? Math.round(((bpm as number) / base - 1) * 100) : null;
    head = fromAlert(byZone.head[0], pct != null && pct > 0 ? `+${pct}%` : "stress?", pct != null ? "vs your baseline" : undefined);
  } else head = { level: "nominal", value: "calm" };

  // ---------- cuerpo ----------
  const impact = alerts.find((a) => a.ruleId === "impact") ?? null;
  const impactEscalated = alerts.find((a) => a.ruleId === "impact_no_response") ?? null;
  const motionWord = active ? "active" : r.motion.activity === "light" ? "light activity" : "at rest";
  let body: ZoneState;
  if (byZone.body[0]) {
    const a = byZone.body[0];
    const g = num((impact ?? a).values.accMag);
    body = fromAlert(a, "impact");
    if (!ground) {
      const still = r.motion.activity === "rest";
      body.detail = `${g != null ? `${g.toFixed(1)} g hit` : "Hard hit"}${still ? ", then no movement." : "."}`;
    }
  } else body = { level: "nominal", value: motionWord };

  // ---------- aire de cabina ----------
  const { tempC, rh, pressureKpa, coPpm, coState } = r.env;
  const coReady = coState === "ready";
  const envLevel = (danger: string[], caution: string[]): Level =>
    danger.some(has) ? "danger" : caution.some(has) ? "caution" : "nominal";
  const env: EnvReading[] = [
    {
      key: "co",
      label: "CO",
      value: coReady ? fix(coPpm, coPpm != null && coPpm < 10 ? 1 : 0) : "…",
      unit: CO_UNIT,
      level: coReady ? envLevel(["co_critical"], ["co_warning"]) : "unreliable",
    },
    {
      key: "pressure",
      label: "Pressure",
      value: fix(pressureKpa, 1),
      unit: "kPa",
      level: envLevel(["pressure_critical", "pressure_spo2"], ["pressure_warning"]),
    },
    { key: "temp", label: "Temp", value: fix(tempC, 1), unit: "°C", level: envLevel(["cabin_temp_critical"], ["cabin_temp_warning"]) },
    { key: "rh", label: "Humidity", value: fix(rh), unit: "%", level: envLevel(["humidity_critical"], ["humidity_warning"]) },
  ];
  let cabin: ZoneState;
  if (byZone.cabin[0]) {
    const a = byZone.cabin[0];
    const which: EnvReading["key"] = a.ruleId.startsWith("co") ? "co" : a.ruleId.startsWith("cabin_temp") ? "temp" : a.ruleId.startsWith("humidity") ? "rh" : "pressure";
    const e = env.find((x) => x.key === which)!;
    cabin = fromAlert(a, e.value, e.unit);
    // El texto del servidor habla de "ppm"; en pantalla el CO siempre es el índice relativo.
    if (!ground && which === "co")
      cabin.detail = a.ruleId === "co_critical" ? `CO index is ${e.value} of 40. CO has no color and no smell.` : `CO index is ${e.value} of 40, above normal.`;
  } else
    cabin = {
      level: "nominal",
      value: fix(pressureKpa, 1),
      unit: "kPa",
      note: coReady ? undefined : "CO sensor warming up · no CO alerts yet",
    };

  const zones: Record<ZoneId, ZoneState> = { head, heart, lungs, body, cabin };

  // ---------- aviso central: la alerta más grave ----------
  // Solo el peligro lleva aviso central; la atención se queda en su panel (sección 12).
  let banner: Banner | null = null;
  const top = ranked.find((a) => levelOf(a) === "danger");
  if (top) {
    banner = {
      level: "danger",
      title: top.title,
      action: ground ? (RULE_COPY[top.ruleId]?.ground ?? top.action) : (RULE_COPY[top.ruleId]?.short ?? top.action),
      note:
        top.ruleId === "co_critical" && coTrap
          ? ground
            ? `SpO₂ still reads ${fix(spo2)}%: the oximeter can’t see CO.`
            : `Your oximeter can’t see CO. Ignore its ${fix(spo2)}%.`
          : undefined,
    };
  }

  return {
    overall: worst(Object.values(zones).map((z) => z.level)),
    zones,
    env,
    exercising,
    coTrap,
    banner,
    impact: impact && !impact.ackAt ? impact : null,
    impactEscalated,
  };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------- preflight ----------

export type SensorStatus = "ok" | "problem" | "progress" | "missing";
export interface SensorCheck {
  id: "ppg" | "motion" | "climate" | "pressure" | "co";
  name: string;
  detail: string;
  value: string;
  status: SensorStatus;
}

/** ¿Cada sensor está leyendo? Sale de la calidad que viaja con cada lectura (RNF-04). */
export function sensorChecks(r: Reading | null): SensorCheck[] {
  const none = (id: SensorCheck["id"], name: string, part: string): SensorCheck => ({
    id,
    name,
    detail: `${part} · waiting for data`,
    value: "—",
    status: "missing",
  });
  if (!r)
    return [
      none("ppg", "Pulse and blood oxygen", "MAX30100"),
      none("motion", "Motion", "MPU6050"),
      none("climate", "Temperature and humidity", "AHT20"),
      none("pressure", "Cabin pressure", "BMP280"),
      none("co", "Carbon monoxide", "MQ-7"),
    ];
  const { bpm, spo2, quality } = r.vitals;
  const ppgOk = quality === "ok" && bpm != null && spo2 != null;
  const climateOk = r.env.tempC != null && r.env.rh != null;
  const pressureOk = r.env.pressureKpa != null;
  const motionOk = Number.isFinite(r.motion.accMag) && r.motion.accMag > 0;
  return [
    {
      id: "ppg",
      name: "Pulse and blood oxygen",
      detail: ppgOk ? "MAX30100 · finger detected" : quality === "no_finger" ? "MAX30100 · no finger on the sensor" : "MAX30100 · finger moved, hold still",
      value: ppgOk ? `${fix(bpm)} BPM · ${fix(spo2)}%` : quality === "no_finger" ? "no finger" : "noisy",
      status: ppgOk ? "ok" : "problem",
    },
    {
      id: "motion",
      name: "Motion",
      detail: motionOk ? "MPU6050 · impact detection armed" : "MPU6050 · not responding",
      value: motionOk ? `${r.motion.accMag.toFixed(2)} g` : "no data",
      status: motionOk ? "ok" : "problem",
    },
    {
      id: "climate",
      name: "Temperature and humidity",
      detail: "AHT20",
      value: climateOk ? `${fix(r.env.tempC, 1)} °C · ${fix(r.env.rh)}%` : "no data",
      status: climateOk ? "ok" : "problem",
    },
    {
      id: "pressure",
      name: "Cabin pressure",
      detail: "BMP280",
      value: pressureOk ? `${fix(r.env.pressureKpa, 1)} kPa` : "no data",
      status: pressureOk ? "ok" : "problem",
    },
    {
      id: "co",
      name: "Carbon monoxide",
      detail: r.env.coState === "ready" ? "MQ-7 · clean-air level set" : "MQ-7 · warming up, learning clean-air level",
      value: r.env.coState === "ready" ? "ready" : "warming up",
      status: r.env.coState === "ready" ? "ok" : "progress",
    },
  ];
}

/** En el preflight el cuerpo se enciende conforme reporta cada sensor. */
export function preflightEvaluation(r: Reading | null, checks: SensorCheck[]): Evaluation {
  const ok = (id: SensorCheck["id"]) => checks.find((c) => c.id === id)?.status === "ok";
  const z = (on: boolean): ZoneState => ({ level: on ? "nominal" : "offline", value: "" });
  const envOk = ok("climate") && ok("pressure");
  return {
    overall: r ? "nominal" : "offline",
    zones: { head: z(ok("ppg")), heart: z(ok("ppg")), lungs: z(ok("ppg")), body: z(ok("motion")), cabin: z(envOk) },
    env: (["co", "pressure", "temp", "rh"] as const).map((key) => ({
      key,
      label: key,
      value: "",
      unit: "",
      level: (key === "co" ? ok("co") : key === "pressure" ? ok("pressure") : ok("climate")) ? "nominal" : "offline",
    })),
    exercising: false,
    coTrap: false,
    banner: null,
    impact: null,
    impactEscalated: null,
  };
}
