import {
  IMPACT_NO_RESPONSE,
  NODE_OFFLINE,
  RULES,
  RuleEngine,
  createSimulator,
  telemetrySchema,
  type Alert,
  type NodeStatus,
  type Reading,
  type Scenario,
  type TelemetryInput,
} from "@astro/shared";
import { LOCAL_GROUND_DELAY_SEC, LOCAL_RULE_TIME_SCALE } from "@/config";
import type { Backend, Health, Listener, MissionEvent, SimStatus, SymptomInput, SymptomRow } from "./backend";

const OFFLINE_AFTER_MS = 10_000;
const SEND_INTERVAL_MS = 2000;

/**
 * La Nave dentro del navegador: mismo simulador y mismo motor de reglas que el servidor
 * (packages/shared), sin base de datos. Sirve para enseñar la app cuando no hay servidor
 * (por ejemplo, desplegada como sitio estático). Replica el flujo de apps/server/src/index.ts.
 */
export class LocalBackend implements Backend {
  readonly kind = "local" as const;
  readonly label = "built-in simulator";

  private engine = new RuleEngine({ timeScale: LOCAL_RULE_TIME_SCALE, baselineSamples: 5 });
  private shipListeners = new Set<Listener>();
  private groundListeners = new Set<Listener>();
  private lastReading = new Map<string, Reading>();
  private nodes = new Map<string, NodeStatus>();
  private alerts = new Map<number, Alert>();
  private open = new Map<string, number>();
  private symptoms: SymptomRow[] = [];
  private nextId = 1;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private watchdog = setInterval(() => this.watch(), 1000);
  private sim: { gen: ReturnType<typeof createSimulator>; timer: ReturnType<typeof setInterval> } | null = null;
  /** La primera vez, el nodo simulado "calienta" unos segundos para que se vea el preflight. */
  private warmUntil = 0;

  // ---------- emisión: Nave al instante, Tierra con retraso ----------

  private emit(e: MissionEvent, toGround = true) {
    const originalAt = Date.now();
    for (const l of this.shipListeners) l.event(e, { originalAt, deliveredAt: originalAt });
    if (!toGround) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      for (const l of this.groundListeners) l.event(e, { originalAt, deliveredAt: Date.now() });
    }, LOCAL_GROUND_DELAY_SEC * 1000);
    this.timers.add(timer);
  }

  private key = (deviceId: string, ruleId: string) => `${deviceId}:${ruleId}`;

  private openAlert(deviceId: string, a: Pick<Alert, "ruleId" | "level" | "title" | "message" | "action" | "values">) {
    const alert: Alert = { ...a, id: this.nextId++, deviceId, startedAt: Date.now(), endedAt: null, ackAt: null };
    this.alerts.set(alert.id, alert);
    this.open.set(this.key(deviceId, a.ruleId), alert.id);
    this.emit({ type: "alert", payload: alert });
  }

  private closeAlert(deviceId: string, ruleId: string) {
    const k = this.key(deviceId, ruleId);
    const id = this.open.get(k);
    if (id === undefined) return;
    this.open.delete(k);
    const alert = { ...this.alerts.get(id)!, endedAt: Date.now() };
    this.alerts.set(id, alert);
    this.emit({ type: "alert:resolved", payload: alert });
  }

  private markSeen(deviceId: string, at: number) {
    const prev = this.nodes.get(deviceId);
    const status: NodeStatus = { deviceId, online: true, lastSeen: at };
    this.nodes.set(deviceId, status);
    if (!prev || !prev.online) {
      this.emit({ type: "node:status", payload: status });
      this.closeAlert(deviceId, NODE_OFFLINE.id);
    }
  }

  private ingest(input: TelemetryInput) {
    const t = telemetrySchema.parse(input);
    const now = Date.now();
    const r: Reading = { ...t, ts: t.ts ?? now, receivedAt: now };
    this.lastReading.set(r.deviceId, r);
    this.markSeen(r.deviceId, now);
    this.emit({ type: "telemetry", payload: r });

    const { raised, resolved } = this.engine.evaluate(r);
    for (const hit of raised)
      this.openAlert(r.deviceId, {
        ruleId: hit.rule.id,
        level: hit.rule.level,
        title: hit.rule.title,
        action: hit.rule.action,
        message: hit.message,
        values: hit.values,
      });
    for (const ruleId of resolved) this.closeAlert(r.deviceId, ruleId);
  }

  /** El silencio también es una alerta. */
  private watch() {
    const now = Date.now();
    for (const status of this.nodes.values()) {
      if (!status.online || now - status.lastSeen < OFFLINE_AFTER_MS) continue;
      status.online = false;
      this.emit({ type: "node:status", payload: { ...status } });
      this.openAlert(status.deviceId, {
        ruleId: NODE_OFFLINE.id,
        level: NODE_OFFLINE.level,
        title: NODE_OFFLINE.title,
        action: NODE_OFFLINE.action,
        message: `No data received from the wearable for ${Math.round((now - status.lastSeen) / 1000)} s. No data does not mean everything is fine.`,
        values: { lastSeen: status.lastSeen },
      });
    }
  }

  // ---------- Backend ----------

  ship(l: Listener) {
    this.shipListeners.add(l);
    l.link(true);
    l.snapshot({
      readings: [...this.lastReading.values()],
      nodes: [...this.nodes.values()],
      alerts: [...this.alerts.values()].filter((a) => a.endedAt === null),
      groundDelaySec: LOCAL_GROUND_DELAY_SEC,
    });
    return () => void this.shipListeners.delete(l);
  }

  ground(l: Listener) {
    this.groundListeners.add(l);
    l.link(true);
    l.snapshot({ groundDelaySec: LOCAL_GROUND_DELAY_SEC });
    return () => void this.groundListeners.delete(l);
  }

  health = async (): Promise<Health> => ({ reachable: true, db: true });

  async ack(alertId: number) {
    const row = this.alerts.get(alertId);
    if (!row) return;
    const now = Date.now();
    const rule = RULES.find((r) => r.id === row.ruleId);
    const updated: Alert = { ...row, ackAt: now };
    if (rule?.sticky) {
      updated.endedAt = now;
      this.engine.release(row.deviceId, row.ruleId);
      this.open.delete(this.key(row.deviceId, row.ruleId));
    }
    this.alerts.set(alertId, updated);
    this.emit({ type: "alert:ack", payload: updated });
    if (row.ruleId === "impact") {
      this.engine.release(row.deviceId, IMPACT_NO_RESPONSE);
      this.closeAlert(row.deviceId, IMPACT_NO_RESPONSE);
    }
  }

  async escalate(alertId: number) {
    const row = this.alerts.get(alertId);
    if (!row || row.ruleId !== "impact" || row.endedAt) return;
    const rule = RULES.find((r) => r.id === IMPACT_NO_RESPONSE)!;
    if (!this.engine.force(row.deviceId, rule.id, Date.now())) return;
    this.openAlert(row.deviceId, {
      ruleId: rule.id,
      level: rule.level,
      title: rule.title,
      action: rule.action,
      message: "The astronaut asked for help after a strong impact.",
      values: row.values,
    });
  }

  async logSymptom(s: SymptomInput) {
    const row: SymptomRow = { ...s, id: this.nextId++, createdAt: Date.now() };
    this.symptoms.push(row);
    // Solo se comparte con Tierra si el astronauta lo decide.
    this.emit({ type: "symptom", payload: row }, s.shareWithGround);
  }

  private status = (): SimStatus =>
    this.sim
      ? { enabled: true, running: true, scenario: this.sim.gen.scenario, deviceId: this.sim.gen.deviceId }
      : { enabled: true, running: false };

  simStatus = async () => this.status();

  async simStop() {
    if (this.sim) clearInterval(this.sim.timer);
    this.sim = null;
    return this.status();
  }

  async simStart(scenario: Scenario, deviceId: string) {
    await this.simStop();
    if (!this.warmUntil) this.warmUntil = Date.now() + 7000;
    const gen = createSimulator({ deviceId, scenario, warmupSec: 0, rampSec: 20 });
    const tick = () => {
      const packet = gen.next();
      if (!packet) return void this.simStop(); // "offline": deja de enviar y salta la alerta de sin señal
      const left = this.warmUntil - Date.now();
      if (left > 0) {
        packet.env.coState = "warming";
        if (left > 3500) packet.vitals.quality = "noisy";
      }
      this.ingest(packet);
    };
    this.sim = { gen, timer: setInterval(tick, SEND_INTERVAL_MS) };
    tick();
    return this.status();
  }

  async groundHistory() {
    return { alerts: [], symptoms: [] };
  }

  dispose() {
    clearInterval(this.watchdog);
    if (this.sim) clearInterval(this.sim.timer);
    for (const t of this.timers) clearTimeout(t);
    this.shipListeners.clear();
    this.groundListeners.clear();
  }
}
