import type { Alert, NodeStatus, Reading } from "@astro/shared";
import { symptomLabel } from "@/model/copy";
import type { SeenAlert } from "@/model/types";
import type { Listener, MissionEvent, Snapshot, SymptomRow, Timing } from "./backend";

export type LogLevel = "danger" | "caution" | "ok" | "info";

export type LogItem = {
  key: string;
  level: LogLevel;
  title: string;
  detail?: string;
  /** Regla que la originó, cuando el evento es una alerta. */
  ruleId?: string;
  deviceId: string;
  originalAt: number;
  deliveredAt: number;
};

export type Arrival = { reading: Reading } & Timing;

/** Un punto de las gráficas de tendencia. null = sin dato confiable en ese momento (hueco en la línea). */
export type TrendPoint = { t: number; bpm: number | null; spo2: number | null; co: number | null };
const TREND_MAX = 450; // ~15 min a un paquete cada 2 s

const toPoint = (r: Reading): TrendPoint => {
  const ok = r.vitals.quality === "ok";
  return { t: r.ts, bpm: ok ? r.vitals.bpm : null, spo2: ok ? r.vitals.spo2 : null, co: r.env.coState === "ready" ? r.env.coPpm : null };
};

export type MirrorState = {
  connected: boolean;
  groundDelaySec: number | null;
  /** Última lectura por dispositivo y cuándo llegó a esta pantalla. */
  readings: Record<string, Arrival>;
  nodes: Record<string, NodeStatus>;
  /** Alertas activas. */
  alerts: SeenAlert[];
  log: LogItem[];
  /** Historia reciente por dispositivo, para las gráficas. */
  trend: Record<string, TrendPoint[]>;
};

const EMPTY: MirrorState = { connected: false, groundDelaySec: null, readings: {}, nodes: {}, alerts: [], log: [], trend: {} };
const LOG_MAX = 200;

const logLevel = (a: Alert): LogLevel => (a.level === "critical" ? "danger" : a.level === "warning" ? "caution" : "info");

const alertDetail = (a: Alert): string | undefined => {
  const v = a.values as Record<string, unknown>;
  const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
  if (a.ruleId.startsWith("co") && n("coPpm") != null) return `CO index ${n("coPpm")!.toFixed(0)} · astronaut alerted on board`;
  if (a.ruleId.startsWith("spo2") && n("spo2") != null) return `SpO₂ ${n("spo2")}% · astronaut alerted on board`;
  if ((a.ruleId.startsWith("hr") || a.ruleId === "acute_stress") && n("bpm") != null) return `Pulse ${n("bpm")} BPM · astronaut alerted on board`;
  if (a.ruleId.startsWith("pressure") && n("pressureKpa") != null) return `${n("pressureKpa")!.toFixed(1)} kPa · astronaut alerted on board`;
  if (a.ruleId === "node_offline") return "The crew sees the same warning";
  return "Astronaut alerted on board";
};

/**
 * Copia local del estado de la misión, armada con los eventos que llegan.
 * Se usa una para la Nave (tiempo real) y otra para Tierra (los mismos eventos, tarde).
 */
export class Mirror implements Listener {
  private state: MirrorState = EMPTY;
  private subs = new Set<() => void>();
  private exercising = new Set<string>();

  subscribe = (cb: () => void) => {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  };
  get = () => this.state;

  private set(patch: Partial<MirrorState>) {
    this.state = { ...this.state, ...patch };
    for (const cb of this.subs) cb();
  }

  private addLog(items: LogItem[]): LogItem[] {
    const known = new Set(this.state.log.map((l) => l.key));
    const fresh = items.filter((i) => !known.has(i.key));
    if (!fresh.length) return this.state.log;
    return [...fresh, ...this.state.log].sort((a, b) => b.originalAt - a.originalAt).slice(0, LOG_MAX);
  }

  link(connected: boolean) {
    if (connected !== this.state.connected) this.set({ connected });
  }

  snapshot(s: Snapshot) {
    const patch: Partial<MirrorState> = {};
    const now = Date.now();
    if (s.groundDelaySec !== undefined) patch.groundDelaySec = s.groundDelaySec;
    if (s.readings) {
      patch.readings = { ...this.state.readings };
      for (const r of s.readings) patch.readings[r.deviceId] = { reading: r, originalAt: r.receivedAt, deliveredAt: r.receivedAt };
    }
    if (s.nodes) patch.nodes = Object.fromEntries(s.nodes.map((n) => [n.deviceId, n]));
    if (s.alerts) {
      const prev = new Map(this.state.alerts.map((a) => [a.id, a.seenAt]));
      patch.alerts = s.alerts.map((a) => ({ ...a, seenAt: prev.get(a.id) ?? Math.min(now, a.startedAt) }));
    }
    this.set(patch);
  }

  event(e: MissionEvent, t: Timing) {
    const st = this.state;
    switch (e.type) {
      case "telemetry": {
        const r = e.payload;
        const patch: Partial<MirrorState> = {
          readings: { ...st.readings, [r.deviceId]: { reading: r, ...t } },
          trend: { ...st.trend, [r.deviceId]: [...(st.trend[r.deviceId] ?? []), toPoint(r)].slice(-TREND_MAX) },
        };
        // Ejercicio: pulso alto con movimiento. No es alerta, pero queda en la bitácora.
        const moving = r.motion.activity === "active" && r.vitals.quality === "ok" && (r.vitals.bpm ?? 0) > 100;
        if (moving && !this.exercising.has(r.deviceId)) {
          this.exercising.add(r.deviceId);
          patch.log = this.addLog([
            {
              key: `exercise:${r.deviceId}:${t.originalAt}`,
              level: "ok",
              title: "Exercise detected · no alert",
              detail: `Pulse ${Math.round(r.vitals.bpm ?? 0)} with movement`,
              deviceId: r.deviceId,
              ...t,
            },
          ]);
        } else if (!moving && r.motion.activity === "rest") this.exercising.delete(r.deviceId);
        this.set(patch);
        break;
      }
      case "alert": {
        const a = e.payload;
        this.set({
          alerts: [{ ...a, seenAt: t.deliveredAt }, ...st.alerts.filter((x) => x.id !== a.id)],
          log: this.addLog([{ key: `alert:${a.id}`, ruleId: a.ruleId, level: logLevel(a), title: a.title, detail: alertDetail(a), deviceId: a.deviceId, ...t }]),
        });
        break;
      }
      case "alert:resolved": {
        const a = e.payload;
        this.set({
          alerts: st.alerts.filter((x) => x.id !== a.id),
          log: this.addLog([{ key: `resolved:${a.id}`, level: "ok", title: `Back to normal: ${a.title}`, deviceId: a.deviceId, ...t }]),
        });
        break;
      }
      case "alert:ack": {
        const a = e.payload;
        this.set({
          alerts: a.endedAt
            ? st.alerts.filter((x) => x.id !== a.id)
            : st.alerts.map((x) => (x.id === a.id ? { ...a, seenAt: x.seenAt } : x)),
          log: this.addLog([
            {
              key: `ack:${a.id}`,
              level: "ok",
              title: a.ruleId === "impact" ? "Astronaut answered: “I’m OK”" : "Alert acknowledged by astronaut",
              detail: a.title,
              deviceId: a.deviceId,
              ...t,
            },
          ]),
        });
        break;
      }
      case "node:status": {
        const n = e.payload;
        this.set({
          nodes: { ...st.nodes, [n.deviceId]: n },
          log: this.addLog([
            {
              key: `node:${n.deviceId}:${t.originalAt}`,
              level: n.online ? "ok" : "info",
              title: n.online ? "Wristband online" : "Wristband stopped sending",
              deviceId: n.deviceId,
              ...t,
            },
          ]),
        });
        break;
      }
      case "symptom":
        this.set({ log: this.addLog([symptomLog(e.payload, t)]) });
        break;
    }
  }

  /**
   * Historia para las gráficas. Con retraso (Tierra) solo entra lo que ya habría llegado; si esta
   * pantalla aún no tiene lectura, la más reciente de esa historia pasa a ser la actual.
   */
  seedReadings(history: Reading[], delaySec: number) {
    if (!history.length) return;
    const now = Date.now();
    const d = delaySec * 1000;
    const deviceId = history[0].deviceId;
    const have = this.state.trend[deviceId] ?? [];
    const before = have.length ? have[0].t : Infinity;
    const old = history.filter((r) => r.ts + d <= now && r.ts < before);
    if (!old.length) return;
    const patch: Partial<MirrorState> = { trend: { ...this.state.trend, [deviceId]: [...old.map(toPoint), ...have].slice(-TREND_MAX) } };
    const last = old[old.length - 1];
    if (!this.state.readings[deviceId] && now - (last.ts + d) < 30_000)
      patch.readings = { ...this.state.readings, [deviceId]: { reading: last, originalAt: last.ts, deliveredAt: last.ts + d } };
    this.set(patch);
  }

  /** Tierra: lo que ya habría llegado si esta pantalla hubiera estado abierta. */
  seed(history: { alerts: Alert[]; symptoms: SymptomRow[] }, delaySec: number) {
    const now = Date.now();
    const d = delaySec * 1000;
    const arrived = (at: number | null): at is number => at != null && at + d <= now;
    const time = (at: number): Timing => ({ originalAt: at, deliveredAt: at + d });
    const items: LogItem[] = [];
    const active: SeenAlert[] = [];
    for (const a of history.alerts) {
      if (!arrived(a.startedAt)) continue;
      items.push({ key: `alert:${a.id}`, ruleId: a.ruleId, level: logLevel(a), title: a.title, detail: alertDetail(a), deviceId: a.deviceId, ...time(a.startedAt) });
      if (arrived(a.ackAt))
        items.push({ key: `ack:${a.id}`, level: "ok", title: "Alert acknowledged by astronaut", detail: a.title, deviceId: a.deviceId, ...time(a.ackAt) });
      if (arrived(a.endedAt)) {
        if (a.endedAt !== a.ackAt)
          items.push({ key: `resolved:${a.id}`, level: "ok", title: `Back to normal: ${a.title}`, deviceId: a.deviceId, ...time(a.endedAt) });
      } else active.push({ ...a, endedAt: null, ackAt: arrived(a.ackAt) ? a.ackAt : null, seenAt: a.startedAt + d });
    }
    for (const s of history.symptoms) {
      const at = new Date(s.createdAt).getTime();
      if (arrived(at)) items.push(symptomLog(s, time(at)));
    }
    const ids = new Set(this.state.alerts.map((a) => a.id));
    this.set({ log: this.addLog(items), alerts: [...this.state.alerts, ...active.filter((a) => !ids.has(a.id))] });
  }
}

function symptomLog(s: SymptomRow, t: Timing): LogItem {
  return {
    key: `symptom:${s.id}`,
    level: "caution",
    title: `Symptom shared: ${symptomLabel(s.type)} ${s.intensity}/5`,
    detail: s.note ? `“${s.note}”` : undefined,
    deviceId: s.deviceId,
    ...t,
  };
}
