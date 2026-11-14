import { io, type Socket } from "socket.io-client";
import { EVENTS, type Alert, type GroundEnvelope, type Scenario } from "@astro/shared";
import type { Backend, Health, Listener, MissionEvent, SimStatus, Snapshot, SymptomInput, SymptomRow } from "./backend";

const EVENT_NAMES = Object.values(EVENTS) as MissionEvent["type"][];

async function json<T>(url: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** ¿Hay un servidor de la Nave en esa URL? Cualquier respuesta HTTP cuenta como "sí". */
export async function probe(base: string, timeoutMs = 2500): Promise<Health> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctl.signal });
    const body = (await res.json().catch(() => ({}))) as { db?: boolean };
    return { reachable: true, db: res.ok && body.db !== false };
  } catch {
    return { reachable: false, db: false };
  } finally {
    clearTimeout(timer);
  }
}

/** El servidor de la Nave: tiempo real por /ship, con retraso por /ground. */
export class RemoteBackend implements Backend {
  readonly kind = "remote" as const;
  readonly label: string;
  private sockets = new Set<Socket>();

  constructor(private base: string) {
    this.label = base.replace(/^https?:\/\//, "");
  }

  private open(namespace: "ship" | "ground", l: Listener): () => void {
    const s = io(`${this.base}/${namespace}`, { transports: ["websocket", "polling"] });
    this.sockets.add(s);
    s.on("connect", () => l.link(true));
    s.on("disconnect", () => l.link(false));
    s.on("connect_error", () => l.link(false));
    s.on("snapshot", (snap: Snapshot) => l.snapshot(snap));
    for (const type of EVENT_NAMES) {
      s.on(type, (data: unknown) => {
        if (namespace === "ground") {
          const e = data as GroundEnvelope<unknown>;
          l.event({ type, payload: e.payload } as MissionEvent, { originalAt: e.originalAt, deliveredAt: e.deliveredAt });
        } else {
          const now = Date.now();
          l.event({ type, payload: data } as MissionEvent, { originalAt: now, deliveredAt: now });
        }
      });
    }
    return () => {
      s.disconnect();
      this.sockets.delete(s);
    };
  }

  ship = (l: Listener) => this.open("ship", l);
  ground = (l: Listener) => this.open("ground", l);
  health = () => probe(this.base);

  async ack(alertId: number) {
    await json(`${this.base}/api/alertas/${alertId}/ack`, post());
  }
  async escalate(alertId: number) {
    await json(`${this.base}/api/alertas/${alertId}/escalate`, post());
  }
  async logSymptom(s: SymptomInput) {
    await json(`${this.base}/api/sintomas`, post(s));
  }

  private toStatus = (s: Partial<SimStatus> & { enabled?: boolean }): SimStatus => ({
    enabled: s.enabled ?? true,
    running: !!s.running,
    scenario: s.scenario,
    deviceId: s.deviceId,
  });
  simStatus = async () => this.toStatus(await json(`${this.base}/api/sim`));
  simStart = async (scenario: Scenario, deviceId: string) =>
    this.toStatus(await json(`${this.base}/api/sim/${scenario}`, post({ deviceId, warmupSec: 0, rampSec: 20 })));
  simStop = async () => this.toStatus(await json(`${this.base}/api/sim/stop`, post()));

  async groundHistory() {
    const [alerts, symptoms] = await Promise.all([
      json<Alert[]>(`${this.base}/api/alertas`),
      json<SymptomRow[]>(`${this.base}/api/sintomas`),
    ]);
    // Solo llegan a Tierra los síntomas que el astronauta decidió compartir.
    return { alerts, symptoms: symptoms.filter((s) => s.shareWithGround) };
  }

  dispose() {
    for (const s of this.sockets) s.disconnect();
    this.sockets.clear();
  }
}
