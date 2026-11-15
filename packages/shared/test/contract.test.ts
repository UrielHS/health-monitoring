// npm test -w @astro/shared
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  RuleEngine,
  SCENARIOS,
  TOPICS,
  createSimulator,
  decodeMqttTelemetry,
  localAlertFor,
  parseTopic,
  telemetryBatchSchema,
  telemetrySchema,
  type Reading,
  type Telemetry,
} from "../src/index.ts";

/** Copiado tal cual del monitor serial del ESP32 de Angel (sketch MQTT, MQ-7 calentando). */
const FROM_ESP32 = `{"v":1,"deviceId":"node-01","bootId":1,"seq":4,"bootMs":17135,"ts":null,"source":"device","vitals":{"bpm":72,"spo2":97,"quality":"ok"},"motion":{"sensor":"mpu6050","accMag":1.02,"gyroMag":3.4,"activity":"rest","impact":false},"env":{"tempC":23.1,"rh":41.5,"pressureKpa":101.2,"coPpm":null,"coState":"warming"},"localAlert":{"level":"none","rules":[]}}`;

const base = (): Telemetry => JSON.parse(FROM_ESP32);
const issuesOf = (body: unknown) => {
  const r = telemetrySchema.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("contrato v1", () => {
  it("acepta el paquete real del ESP32", () => {
    assert.deepEqual(issuesOf(base()), []);
  });

  it("acepta sensores ausentes como null y bpm con decimales", () => {
    const t = base();
    t.vitals = { bpm: null, spo2: null, quality: "no_sensor" };
    t.motion = { sensor: "none", accMag: null, gyroMag: null, activity: null, impact: false };
    t.env = { tempC: null, rh: null, pressureKpa: null, coPpm: null, coState: "no_sensor" };
    assert.deepEqual(issuesOf(t), []);
    const d = base();
    d.vitals.bpm = 72.4;
    assert.deepEqual(issuesOf(d), []);
  });

  it("rechaza un campo mal escrito y dice dónde", () => {
    const t = base() as unknown as { vitals: Record<string, unknown> };
    t.vitals.spO2 = 97;
    assert.deepEqual(issuesOf(t), ["vitals"]);
  });

  it("rechaza el formato viejo del repo (localAlert como texto, sin v ni sensor)", () => {
    const old = base() as unknown as Record<string, unknown>;
    delete old.v;
    old.localAlert = "none";
    delete (old.motion as Record<string, unknown>).sensor;
    const paths = issuesOf(old);
    assert.ok(paths.includes("v"));
    assert.ok(paths.includes("localAlert"));
    assert.ok(paths.includes("motion.sensor"));
  });

  it("no rechaza un CO fuera de la escala 0–40 (la lectura más peligrosa no se descarta)", () => {
    const t = base();
    t.env.coState = "ready";
    t.env.coPpm = 55;
    assert.deepEqual(issuesOf(t), []);
  });

  it("lote: { packets: [...] } de 1 a 50", () => {
    assert.ok(telemetryBatchSchema.safeParse({ packets: [base()] }).success);
    assert.ok(!telemetryBatchSchema.safeParse([base()]).success);
    assert.ok(!telemetryBatchSchema.safeParse({ packets: [] }).success);
  });
});

describe("topics MQTT", () => {
  it("arma y separa los topics", () => {
    assert.equal(TOPICS.telemetry("node-01"), "astro/v1/node-01/telemetry");
    assert.deepEqual(parseTopic("astro/v1/node-01/telemetry"), { deviceId: "node-01", kind: "telemetry" });
    assert.equal(parseTopic("otro/v1/node-01/telemetry"), null);
    assert.equal(parseTopic("astro/v1/node-01"), null);
  });

  it("decodifica el mensaje real del ESP32", () => {
    const r = decodeMqttTelemetry("astro/v1/node-01/telemetry", FROM_ESP32);
    assert.ok(r.ok);
    assert.equal(r.data.ts, null);
  });

  it("rechaza JSON roto, topic de otro dispositivo y campos inválidos", () => {
    assert.deepEqual(decodeMqttTelemetry("astro/v1/node-01/telemetry", "{roto"), { ok: false, deviceId: "node-01", error: "invalid_json" });
    const other = decodeMqttTelemetry("astro/v1/node-02/telemetry", FROM_ESP32);
    assert.ok(!other.ok && other.error === "device_mismatch");
    const bad = decodeMqttTelemetry("astro/v1/node-01/telemetry", FROM_ESP32.replace('"spo2":97', '"spO2":97'));
    assert.ok(!bad.ok && bad.error === "validation" && bad.issues?.length);
    assert.equal(decodeMqttTelemetry("astro/v1/node-01/status", FROM_ESP32).ok, false);
  });
});

describe("alerta local (lo que decide el buzzer)", () => {
  it("CO 12 = warning, CO 38 = danger, impacto = warning", () => {
    const t = base();
    t.env.coState = "ready";
    t.env.coPpm = 12;
    assert.deepEqual(localAlertFor(t), { level: "warning", rules: ["CO_HIGH"] });
    t.env.coPpm = 38;
    t.motion.impact = true;
    assert.deepEqual(localAlertFor(t), { level: "danger", rules: ["CO_HIGH", "IMPACT"] });
  });

  it("el CO no alerta mientras el sensor calienta", () => {
    const t = base();
    t.env.coPpm = 38;
    assert.equal(localAlertFor(t).level, "none");
  });
});

// ---------- escenarios del simulador por el motor de reglas, con reloj falso ----------

let now = 1_794_000_000_000;
const realNow = Date.now;

function runScenario(scenario: (typeof SCENARIOS)[number], seconds: number) {
  const sim = createSimulator({ deviceId: "sim-01", scenario, warmupSec: 0, rampSec: 20 });
  const engine = new RuleEngine({ timeScale: 0.1, baselineSamples: 5 });
  const raised = new Set<string>();
  let maxCo = 0;
  let sent = 0;
  for (let s = 0; s < seconds; s += 2) {
    now += 2000;
    const packet = sim.next();
    if (!packet) break;
    sent++;
    const parsed = telemetrySchema.safeParse(packet);
    assert.ok(parsed.success, `${scenario}: paquete inválido ${JSON.stringify(parsed.error?.issues)}`);
    maxCo = Math.max(maxCo, packet.env.coPpm ?? 0);
    const reading: Reading = { ...parsed.data, ts: parsed.data.ts ?? now, receivedAt: now };
    for (const hit of engine.evaluate(reading).raised) raised.add(hit.rule.id);
  }
  return { raised, maxCo, sent };
}

describe("simulador → motor de reglas", () => {
  beforeEach(() => (Date.now = () => now));
  afterEach(() => (Date.now = realNow));

  it("los 8 escenarios generan paquetes válidos", () => {
    for (const s of SCENARIOS) runScenario(s, 60);
  });

  it("co: sube a warning y luego a critical, sin pasar de 40", () => {
    const { raised, maxCo } = runScenario("co", 60);
    assert.ok(raised.has("co_warning"));
    assert.ok(raised.has("co_critical"));
    assert.ok(maxCo <= 40);
  });

  it("hypoxia: oxígeno crítico", () => {
    assert.ok(runScenario("hypoxia", 60).raised.has("spo2_critical"));
  });

  it("depressurization: presión crítica", () => {
    assert.ok(runScenario("depressurization", 90).raised.has("pressure_critical"));
  });

  it("impact: alerta de impacto", () => {
    assert.ok(runScenario("impact", 10).raised.has("impact"));
  });

  it("exercise: pulso alto con movimiento no es alerta", () => {
    const { raised } = runScenario("exercise", 60);
    assert.ok(!raised.has("hr_critical") && !raised.has("hr_rest_warning") && !raised.has("acute_stress"));
  });

  it("normal: sin alertas", () => {
    assert.equal(runScenario("normal", 60).raised.size, 0);
  });

  it("offline: deja de enviar", () => {
    assert.equal(runScenario("offline", 20).sent, 0);
  });
});
