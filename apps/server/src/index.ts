import http from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { Prisma, PrismaClient, type Alert as AlertRow } from "@prisma/client";
import { Server } from "socket.io";
import {
  EVENTS,
  symptomSchema,
  telemetryBatchSchema,
  telemetrySchema,
  type Alert,
  type GroundEnvelope,
  type NodeStatus,
  type Reading,
  type Telemetry,
} from "@astro/shared";
import { deviceKeys, env } from "./env.js";
import { IMPACT_NO_RESPONSE, NODE_OFFLINE, RULES, RuleEngine, THRESHOLDS, type RuleHit } from "./rules.js";
import { SCENARIOS, createSimulator, isScenario } from "./sim.js";

const prisma = new PrismaClient();
const engine = new RuleEngine();

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: "256kb" }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: env.CORS_ORIGIN } });
const ship = io.of("/ship");
const ground = io.of("/ground");

// ---------- Estado en memoria ----------

const lastReading = new Map<string, Reading>();
const nodes = new Map<string, NodeStatus>();
/** Alertas abiertas por dispositivo y regla → id en base de datos. */
const openAlerts = new Map<string, number>();
const alertKey = (deviceId: string, ruleId: string) => `${deviceId}:${ruleId}`;

// ---------- Emisión: Nave en tiempo real, Tierra con retraso ----------

function emit(event: string, payload: unknown, toGround = true) {
  const originalAt = Date.now();
  ship.emit(event, payload);
  if (!toGround) return;
  setTimeout(() => {
    const envelope: GroundEnvelope<unknown> = { payload, originalAt, deliveredAt: Date.now() };
    ground.emit(event, envelope);
  }, env.GROUND_DELAY_SEC * 1000);
}

// ---------- Utilidades ----------

function requireDeviceKey(req: Request, res: Response, next: NextFunction) {
  const key = req.header("x-api-key");
  if (!key || !deviceKeys.has(key)) return res.status(401).json({ error: "invalid_api_key" });
  next();
}

/** Usa la hora NTP del nodo si es válida; si no, la reconstruye con bootMs. */
function resolveTs(t: Telemetry, now: number, refBootMs: number): number {
  if (t.ts && t.ts > 1_600_000_000_000) return t.ts;
  return now - Math.max(0, refBootMs - t.bootMs);
}

function toRow(r: Reading) {
  return {
    deviceId: r.deviceId,
    bootId: r.bootId,
    seq: r.seq,
    ts: new Date(r.ts),
    source: r.source,
    bpm: r.vitals.bpm,
    spo2: r.vitals.spo2,
    ppgQuality: r.vitals.quality,
    accMag: r.motion.accMag,
    gyroMag: r.motion.gyroMag,
    activity: r.motion.activity,
    impact: r.motion.impact,
    tempC: r.env.tempC,
    rh: r.env.rh,
    pressureKpa: r.env.pressureKpa,
    coPpm: r.env.coPpm,
    coState: r.env.coState,
    localAlert: r.localAlert,
  };
}

function toAlert(a: AlertRow): Alert {
  return {
    id: a.id,
    deviceId: a.deviceId,
    ruleId: a.ruleId,
    level: a.level as Alert["level"],
    title: a.title,
    message: a.message,
    action: a.action,
    values: (a.values ?? {}) as Record<string, unknown>,
    startedAt: a.startedAt.getTime(),
    endedAt: a.endedAt?.getTime() ?? null,
    ackAt: a.ackAt?.getTime() ?? null,
  };
}

async function openAlert(deviceId: string, hit: Pick<RuleHit, "message" | "values"> & { ruleId: string; level: string; title: string; action: string }) {
  const row = await prisma.alert.create({
    data: {
      deviceId,
      ruleId: hit.ruleId,
      level: hit.level,
      title: hit.title,
      message: hit.message,
      action: hit.action,
      values: hit.values as Prisma.InputJsonValue,
      startedAt: new Date(),
    },
  });
  openAlerts.set(alertKey(deviceId, hit.ruleId), row.id);
  emit(EVENTS.alert, toAlert(row));
}

async function closeAlert(deviceId: string, ruleId: string) {
  const key = alertKey(deviceId, ruleId);
  const id = openAlerts.get(key);
  if (id === undefined) return;
  openAlerts.delete(key);
  const row = await prisma.alert.update({ where: { id }, data: { endedAt: new Date() } });
  emit(EVENTS.alertResolved, toAlert(row));
}

function markSeen(deviceId: string, at: number) {
  const prev = nodes.get(deviceId);
  const status: NodeStatus = { deviceId, online: true, lastSeen: at };
  nodes.set(deviceId, status);
  if (!prev || !prev.online) {
    emit(EVENTS.nodeStatus, status);
    void closeAlert(deviceId, NODE_OFFLINE.id);
  }
}

/** Procesa una lectura en vivo: reglas, alertas y emisión. */
async function processLive(r: Reading) {
  lastReading.set(r.deviceId, r);
  markSeen(r.deviceId, r.receivedAt);
  emit(EVENTS.telemetry, r);

  const { raised, resolved } = engine.evaluate(r);
  for (const hit of raised) {
    await openAlert(r.deviceId, {
      ruleId: hit.rule.id,
      level: hit.rule.level,
      title: hit.rule.title,
      action: hit.rule.action,
      message: hit.message,
      values: hit.values,
    });
  }
  for (const ruleId of resolved) await closeAlert(r.deviceId, ruleId);
}

// ---------- Rutas ----------

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true, uptimeSec: Math.round(process.uptime()) });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    thresholds: THRESHOLDS,
    sendIntervalMs: 2000,
    offlineAfterSec: env.OFFLINE_AFTER_SEC,
    groundDelaySec: env.GROUND_DELAY_SEC,
    rules: RULES.map(({ id, level, minSec }) => ({ id, level, minSec: minSec * env.RULE_TIME_SCALE })),
  });
});

/** Guarda una lectura y, si no es duplicada, la procesa en vivo. La usan la pulsera y el simulador. */
async function ingestOne(t: Telemetry): Promise<{ duplicate: boolean }> {
  const now = Date.now();
  const reading: Reading = { ...t, ts: resolveTs(t, now, t.bootMs), receivedAt: now };
  const { count } = await prisma.reading.createMany({ data: [toRow(reading)], skipDuplicates: true });
  if (count === 0) return { duplicate: true };
  await processLive(reading);
  return { duplicate: false };
}

app.post("/api/telemetria", requireDeviceKey, async (req, res) => {
  const parsed = telemetrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  const { duplicate } = await ingestOne(parsed.data);
  res.json({ ok: true, duplicate });
});

/** Lecturas acumuladas en flash durante una caída de Wi-Fi: se guardan, no disparan alertas viejas. */
app.post("/api/telemetria/lote", requireDeviceKey, async (req, res) => {
  const parsed = telemetryBatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });

  const now = Date.now();
  const refBootMs = Math.max(...parsed.data.map((t) => t.bootMs));
  const readings: Reading[] = parsed.data.map((t) => ({ ...t, ts: resolveTs(t, now, refBootMs), receivedAt: now }));

  const { count } = await prisma.reading.createMany({ data: readings.map(toRow), skipDuplicates: true });
  const latest = readings.reduce((a, b) => (b.ts > a.ts ? b : a));
  markSeen(latest.deviceId, now);
  emit(EVENTS.telemetry, latest);
  res.json({ ok: true, received: readings.length, inserted: count });
});

app.get("/api/lecturas", async (req, res) => {
  const deviceId = String(req.query.deviceId ?? "");
  const minutes = Math.min(Number(req.query.minutes ?? 10), 24 * 60);
  if (!deviceId) return res.status(400).json({ error: "deviceId_required" });
  const rows = await prisma.reading.findMany({
    where: { deviceId, ts: { gte: new Date(Date.now() - minutes * 60_000) } },
    orderBy: { ts: "asc" },
    take: 2000,
  });
  res.json(rows);
});

app.get("/api/alertas", async (req, res) => {
  const activeOnly = req.query.active === "1";
  const rows = await prisma.alert.findMany({
    where: activeOnly ? { endedAt: null } : undefined,
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  res.json(rows.map(toAlert));
});

app.post("/api/alertas/:id/ack", async (req, res) => {
  const id = Number(req.params.id);
  const row = await prisma.alert.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ error: "not_found" });

  const rule = RULES.find((r) => r.id === row.ruleId);
  const data: { ackAt: Date; endedAt?: Date } = { ackAt: new Date() };
  if (rule?.sticky) {
    data.endedAt = new Date();
    engine.release(row.deviceId, row.ruleId);
    openAlerts.delete(alertKey(row.deviceId, row.ruleId));
  }
  const updated = await prisma.alert.update({ where: { id }, data });
  emit(EVENTS.alertAck, toAlert(updated));
  // "I'm OK" tras un impacto también cierra la alerta escalada, si ya existía.
  if (row.ruleId === "impact") {
    engine.release(row.deviceId, IMPACT_NO_RESPONSE);
    await closeAlert(row.deviceId, IMPACT_NO_RESPONSE);
  }
  res.json(toAlert(updated));
});

/** "Call the crew": escala un impacto a peligro sin esperar los 30 s. */
app.post("/api/alertas/:id/escalate", async (req, res) => {
  const row = await prisma.alert.findUnique({ where: { id: Number(req.params.id) } });
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.ruleId !== "impact" || row.endedAt) return res.status(409).json({ error: "not_escalable" });
  const rule = RULES.find((r) => r.id === IMPACT_NO_RESPONSE)!;
  if (engine.force(row.deviceId, rule.id, Date.now())) {
    await openAlert(row.deviceId, {
      ruleId: rule.id,
      level: rule.level,
      title: rule.title,
      action: rule.action,
      message: "The astronaut asked for help after a strong impact.",
      values: (row.values ?? {}) as Record<string, unknown>,
    });
  }
  res.json({ ok: true });
});

app.post("/api/sintomas", async (req, res) => {
  const parsed = symptomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
  const row = await prisma.symptom.create({ data: parsed.data });
  // Solo se comparte con Tierra si el astronauta lo decide.
  emit(EVENTS.symptom, row, parsed.data.shareWithGround);
  res.status(201).json(row);
});

app.get("/api/sintomas", async (req, res) => {
  const deviceId = req.query.deviceId ? String(req.query.deviceId) : undefined;
  const rows = await prisma.symptom.findMany({
    where: deviceId ? { deviceId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(rows);
});

// ---------- Simulador controlado desde la app ----------
// Las lecturas simuladas entran por ingestOne: mismo motor de reglas, misma base de datos
// y misma vista Tierra que la pulsera real. Solo corre un escenario a la vez.

let simRun: { sim: ReturnType<typeof createSimulator>; timer: NodeJS.Timeout; startedAt: number } | null = null;

function stopSim() {
  if (!simRun) return;
  clearInterval(simRun.timer);
  simRun = null;
}

const simStatus = () =>
  simRun
    ? { running: true, scenario: simRun.sim.scenario, phase: simRun.sim.phase(), deviceId: simRun.sim.deviceId, startedAt: simRun.startedAt }
    : { running: false };

app.get("/api/sim", (_req, res) => {
  res.json({ ...simStatus(), scenarios: SCENARIOS, enabled: env.SIM_ENABLED });
});

app.post("/api/sim/stop", (_req, res) => {
  stopSim();
  res.json(simStatus());
});

app.post("/api/sim/:scenario", async (req, res) => {
  if (!env.SIM_ENABLED) return res.status(403).json({ error: "sim_disabled" });
  const scenario = req.params.scenario;
  if (!isScenario(scenario)) return res.status(400).json({ error: "invalid_scenario", scenarios: SCENARIOS });

  const body = (req.body ?? {}) as { deviceId?: string; warmupSec?: number; rampSec?: number };
  stopSim();
  const sim = createSimulator({
    deviceId: typeof body.deviceId === "string" && body.deviceId ? body.deviceId : "sim-01",
    scenario,
    warmupSec: Number(body.warmupSec ?? 0),
    rampSec: Number(body.rampSec ?? 20),
  });

  const tick = async () => {
    const packet = sim.next();
    if (!packet) return stopSim(); // "offline": deja de enviar y salta la alerta de sin señal
    try {
      await ingestOne(telemetrySchema.parse(packet));
    } catch (e) {
      console.error("[sim] error:", e);
    }
  };
  simRun = { sim, timer: setInterval(tick, 2000), startedAt: Date.now() };
  await tick();
  res.json(simStatus());
});

// Express 5 pasa aquí los errores de rutas async.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] error:", err);
  res.status(500).json({ error: "internal_error" });
});

// ---------- Sockets ----------

ship.on("connection", async (socket) => {
  const active = await prisma.alert.findMany({ where: { endedAt: null }, orderBy: { startedAt: "desc" } });
  socket.emit("snapshot", {
    readings: [...lastReading.values()],
    nodes: [...nodes.values()],
    alerts: active.map(toAlert),
    groundDelaySec: env.GROUND_DELAY_SEC,
  });
});

ground.on("connection", (socket) => {
  socket.emit("snapshot", { groundDelaySec: env.GROUND_DELAY_SEC });
});

// ---------- Vigilancia: el silencio también es una alerta ----------

setInterval(() => {
  const now = Date.now();
  for (const status of nodes.values()) {
    if (!status.online || now - status.lastSeen < env.OFFLINE_AFTER_SEC * 1000) continue;
    status.online = false;
    emit(EVENTS.nodeStatus, { ...status });
    const seconds = Math.round((now - status.lastSeen) / 1000);
    void openAlert(status.deviceId, {
      ruleId: NODE_OFFLINE.id,
      level: NODE_OFFLINE.level,
      title: NODE_OFFLINE.title,
      action: NODE_OFFLINE.action,
      message: `No data received from the wearable for ${seconds} s. No data does not mean everything is fine.`,
      values: { lastSeen: status.lastSeen },
    });
  }
}, 1000);

// Al reiniciar el servidor se cierran las alertas que quedaron abiertas.
await prisma.alert.updateMany({ where: { endedAt: null }, data: { endedAt: new Date() } });

server.listen(env.PORT, () => {
  console.log(`[server] http://localhost:${env.PORT}  ground delay: ${env.GROUND_DELAY_SEC}s`);
});
