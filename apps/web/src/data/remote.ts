import { io, type Socket } from "socket.io-client";
import { EVENTS, type Alert, type GroundEnvelope, type Reading, type Scenario } from "@astro/shared";
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

/** Fila de GET /api/lecturas (columnas planas de Prisma) → lectura con la forma del contrato. */
type ReadingRow = {
  deviceId: string; bootId: number; seq: number; ts: string; receivedAt: string; source: string;
  bpm: number | null; spo2: number | null; ppgQuality: string; accMag: number; gyroMag: number; activity: string; impact: boolean;
  tempC: number | null; rh: number | null; pressureKpa: number | null; coPpm: number | null; coState: string; localAlert: string;
};
const toReading = (r: ReadingRow): Reading => {
  const ts = new Date(r.ts).getTime();
  return {
    deviceId: r.deviceId, bootId: r.bootId, seq: r.seq, bootMs: 0, ts, receivedAt: new Date(r.receivedAt).getTime(),
    source: r.source as Reading["source"],
    vitals: { bpm: r.bpm, spo2: r.spo2, quality: r.ppgQuality as Reading["vitals"]["quality"] },
    motion: { accMag: r.accMag, gyroMag: r.gyroMag, activity: r.activity as Reading["motion"]["activity"], impact: r.impact },
    env: { tempC: r.tempC, rh: r.rh, pressureKpa: r.pressureKpa, coPpm: r.coPpm, coState: r.coState as Reading["env"]["coState"] },
    localAlert: r.localAlert as Reading["localAlert"],
  };
};

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

  async readings(deviceId: string, minutes: number) {
    const rows = await json<ReadingRow[]>(`${this.base}/api/lecturas?deviceId=${encodeURIComponent(deviceId)}&minutes=${minutes}`, undefined, 8000);
    return rows.map(toReading);
  }

  dispose() {
    for (const s of this.sockets) s.disconnect();
    this.sockets.clear();
  }
}
