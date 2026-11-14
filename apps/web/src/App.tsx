import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { EVENTS, type Alert, type GroundEnvelope, type NodeStatus, type Reading } from "@astro/shared";

/**
 * Base funcional de la PWA. El diseño final lo define UI/UX (Leilany);
 * aquí solo están los datos conectados para que las pantallas se armen encima.
 */
const API = import.meta.env.VITE_API_URL ?? `${location.protocol}//${location.hostname}:3000`;

type Level = "normal" | "warning" | "critical";

function overallLevel(alerts: Alert[], online: boolean): Level {
  if (!online || alerts.some((a) => a.level === "critical")) return "critical";
  if (alerts.some((a) => a.level === "warning")) return "warning";
  return "normal";
}

const LEVEL_TEXT: Record<Level, string> = {
  normal: "All good",
  warning: "Attention",
  critical: "Danger",
};

const fmt = (v: number | null | undefined, d = 0, unit = "") => (v == null ? "—" : `${v.toFixed(d)}${unit}`);
const time = (ms: number) => new Date(ms).toLocaleTimeString();

export default function App() {
  const [view, setView] = useState(location.hash === "#ground" ? "ground" : "ship");
  useEffect(() => {
    const onHash = () => setView(location.hash === "#ground" ? "ground" : "ship");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Astronaut Health Monitor</h1>
        <nav>
          <a href="#ship" className={view === "ship" ? "active" : ""}>Astronaut</a>
          <a href="#ground" className={view === "ground" ? "active" : ""}>Ground medical</a>
        </nav>
      </header>
      {view === "ship" ? <ShipView /> : <GroundView />}
    </div>
  );
}

// ---------------- Vista del astronauta (tiempo real) ----------------

function ShipView() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [node, setNode] = useState<NodeStatus | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = io(`${API}/ship`);
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("snapshot", (snap: { readings: Reading[]; nodes: NodeStatus[]; alerts: Alert[] }) => {
      setReading(snap.readings.at(-1) ?? null);
      setNode(snap.nodes.at(-1) ?? null);
      setAlerts(snap.alerts);
    });
    s.on(EVENTS.telemetry, (r: Reading) => setReading(r));
    s.on(EVENTS.nodeStatus, (n: NodeStatus) => setNode(n));
    s.on(EVENTS.alert, (a: Alert) => setAlerts((prev) => [a, ...prev.filter((x) => x.id !== a.id)]));
    s.on(EVENTS.alertResolved, (a: Alert) => setAlerts((prev) => prev.filter((x) => x.id !== a.id)));
    s.on(EVENTS.alertAck, (a: Alert) =>
      setAlerts((prev) => (a.endedAt ? prev.filter((x) => x.id !== a.id) : prev.map((x) => (x.id === a.id ? a : x)))),
    );
    return () => void s.disconnect();
  }, []);

  const online = node?.online ?? false;
  const level = overallLevel(alerts, online || !node);

  const ack = (id: number) => fetch(`${API}/api/alertas/${id}/ack`, { method: "POST" });

  return (
    <main>
      {!connected && <p className="banner offline">No connection to the ship server ({API})</p>}

      <section className={`status ${level}`}>
        <span className="status-label">{LEVEL_TEXT[level]}</span>
        <span className="status-sub">
          {node ? (online ? `Wearable connected · ${node.deviceId}` : "No signal from wearable") : "Waiting for wearable…"}
        </span>
      </section>

      {alerts.length > 0 && (
        <section>
          <h2>Alerts</h2>
          <ul className="alerts">
            {alerts.map((a) => (
              <li key={a.id} className={`alert ${a.level}`}>
                <strong>{a.title}</strong>
                <p>{a.message}</p>
                <p className="action">{a.action}</p>
                <div className="alert-foot">
                  <small>{time(a.startedAt)}</small>
                  {a.ackAt ? <small>Acknowledged</small> : <button onClick={() => ack(a.id)}>Acknowledge</button>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Vitals</h2>
        <Vitals reading={reading} />
      </section>

      <section>
        <h2>How do you feel?</h2>
        <SymptomForm deviceId={reading?.deviceId ?? node?.deviceId ?? null} />
      </section>
    </main>
  );
}

function Vitals({ reading: r }: { reading: Reading | null }) {
  if (!r) return <p className="muted">No data yet.</p>;
  const ppgNote = r.vitals.quality === "ok" ? "" : r.vitals.quality === "noisy" ? " · noisy" : " · no finger";
  return (
    <div className="grid">
      <Card label="Heart rate" value={fmt(r.vitals.bpm, 0, " BPM")} note={ppgNote} />
      <Card label="Blood oxygen" value={fmt(r.vitals.spo2, 0, " %")} note={ppgNote} />
      <Card label="Activity" value={r.motion.activity} />
      <Card label="Carbon monoxide" value={fmt(r.env.coPpm, 1, " ppm")} note={r.env.coState === "ready" ? "" : " · warming up"} />
      <Card label="Cabin pressure" value={fmt(r.env.pressureKpa, 1, " kPa")} />
      <Card label="Temperature" value={fmt(r.env.tempC, 1, " °C")} />
      <Card label="Humidity" value={fmt(r.env.rh, 0, " %")} />
      <Card label="Source" value={r.source === "sim" ? "Simulation" : "Wearable"} />
    </div>
  );
}

function Card({ label, value, note = "" }: { label: string; value: string; note?: string }) {
  return (
    <div className="card">
      <span className="card-label">{label}</span>
      <span className="card-value">{value}</span>
      {note && <span className="card-note">{note.replace(" · ", "")}</span>}
    </div>
  );
}

const SYMPTOMS = [
  ["dolor_cabeza", "Headache"],
  ["mareo", "Dizziness"],
  ["nausea", "Nausea"],
  ["fatiga", "Fatigue"],
  ["animo", "Low mood"],
  ["sueno", "Poor sleep"],
  ["otro", "Other"],
] as const;

function SymptomForm({ deviceId }: { deviceId: string | null }) {
  const [type, setType] = useState<string>("dolor_cabeza");
  const [intensity, setIntensity] = useState(3);
  const [share, setShare] = useState(false);
  const [sent, setSent] = useState(false);

  if (!deviceId) return <p className="muted">Connect the wearable to log symptoms.</p>;

  const submit = async () => {
    await fetch(`${API}/api/sintomas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, type, intensity, shareWithGround: share }),
    });
    setSent(true);
    setTimeout(() => setSent(false), 2000);
  };

  return (
    <div className="symptoms">
      <div className="chips">
        {SYMPTOMS.map(([id, label]) => (
          <button key={id} className={type === id ? "chip on" : "chip"} onClick={() => setType(id)}>
            {label}
          </button>
        ))}
      </div>
      <label>
        Intensity: {intensity}
        <input type="range" min={1} max={5} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
      </label>
      <label className="check">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share with ground medical team
      </label>
      <button className="primary" onClick={submit}>{sent ? "Logged ✓" : "Log symptom"}</button>
    </div>
  );
}

// ---------------- Vista del médico en Tierra (con retraso) ----------------

type GroundItem = { kind: "alert" | "resolved" | "symptom" | "node"; text: string; originalAt: number; deliveredAt: number };

function GroundView() {
  const [delaySec, setDelaySec] = useState<number | null>(null);
  const [latest, setLatest] = useState<GroundEnvelope<Reading> | null>(null);
  const [log, setLog] = useState<GroundItem[]>([]);

  useEffect(() => {
    const s = io(`${API}/ground`);
    const push = (item: GroundItem) => setLog((prev) => [item, ...prev].slice(0, 100));
    s.on("snapshot", (snap: { groundDelaySec: number }) => setDelaySec(snap.groundDelaySec));
    s.on(EVENTS.telemetry, (e: GroundEnvelope<Reading>) => setLatest(e));
    s.on(EVENTS.alert, (e: GroundEnvelope<Alert>) =>
      push({ kind: "alert", text: `${e.payload.level.toUpperCase()} · ${e.payload.title}`, originalAt: e.originalAt, deliveredAt: e.deliveredAt }),
    );
    s.on(EVENTS.alertResolved, (e: GroundEnvelope<Alert>) =>
      push({ kind: "resolved", text: `Resolved · ${e.payload.title}`, originalAt: e.originalAt, deliveredAt: e.deliveredAt }),
    );
    s.on(EVENTS.symptom, (e: GroundEnvelope<{ type: string; intensity: number }>) =>
      push({ kind: "symptom", text: `Symptom · ${e.payload.type} (${e.payload.intensity}/5)`, originalAt: e.originalAt, deliveredAt: e.deliveredAt }),
    );
    s.on(EVENTS.nodeStatus, (e: GroundEnvelope<NodeStatus>) =>
      push({ kind: "node", text: e.payload.online ? "Wearable online" : "Wearable offline", originalAt: e.originalAt, deliveredAt: e.deliveredAt }),
    );
    return () => void s.disconnect();
  }, []);

  const lag = useMemo(() => (latest ? Math.round((latest.deliveredAt - latest.originalAt) / 1000) : null), [latest]);

  return (
    <main>
      <p className="banner ground">
        Ground view: data arrives {delaySec ?? "…"} s late (up to ~20 min on a Mars mission). The astronaut has already acted.
      </p>

      <section>
        <h2>Last data received {lag !== null && <small className="muted">· {lag} s old on arrival</small>}</h2>
        <Vitals reading={latest?.payload ?? null} />
      </section>

      <section>
        <h2>Event log</h2>
        {log.length === 0 ? (
          <p className="muted">Nothing received yet.</p>
        ) : (
          <ul className="log">
            {log.map((item, i) => (
              <li key={i} className={item.kind}>
                <span>{item.text}</span>
                <small>
                  happened {time(item.originalAt)} · received {time(item.deliveredAt)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
