import { useMemo, useState } from "react";
import { pickDevice, useMission, useNow } from "@/data/mission";
import { preflightEvaluation, sensorChecks, type SensorStatus } from "@/model/evaluate";
import { Scene } from "@/scene/Scene";
import { Brand } from "./Brand";
import { ago } from "./format";
import { useHudScale } from "./useHudScale";

function StatusIcon({ status }: { status: SensorStatus }) {
  if (status === "ok")
    return (
      <svg role="img" aria-label="OK" width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="10" fill="none" stroke="var(--ok)" strokeWidth="1.5" />
        <path d="M6.5 11.2 L9.6 14.2 L15.5 8" fill="none" stroke="var(--ok)" strokeWidth="1.8" />
      </svg>
    );
  if (status === "progress")
    return (
      <svg role="img" aria-label="In progress" width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="9" fill="none" stroke="rgba(76,201,255,0.25)" strokeWidth="2" />
        <path className="spin" d="M11 2 A9 9 0 0 1 20 11" fill="none" stroke="var(--accent)" strokeWidth="2" />
      </svg>
    );
  if (status === "missing")
    return (
      <svg role="img" aria-label="Waiting" width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="10" fill="none" stroke="var(--off)" strokeWidth="1.5" strokeDasharray="3 3" />
      </svg>
    );
  return (
    <svg role="img" aria-label="Problem" width="22" height="22" viewBox="0 0 22 22">
      <path d="M11 2 L20.5 19 H1.5 Z" fill="none" stroke="var(--caution)" strokeWidth="1.5" />
      <path d="M11 8 V12.5 M11 15 V15.6" stroke="var(--caution)" strokeWidth="1.8" />
    </svg>
  );
}

function Check({ status, name, detail, value }: { status: SensorStatus; name: string; detail: string; value: string }) {
  return (
    <li>
      <StatusIcon status={status} />
      <div>
        <p className="check-name">{name}</p>
        <p className="check-detail">{detail}</p>
      </div>
      <p className={`check-value st-${status}`}>{value}</p>
    </li>
  );
}

/** Antes de empezar: ¿hay enlace con la Nave y cada sensor está leyendo? Sin login. */
export function Preflight() {
  const m = useMission();
  const hud = useHudScale();
  const now = useNow(1000);
  const [url, setUrl] = useState(m.apiUrl);

  const dev = pickDevice(m.ship, m.source);
  const reading = dev.arrival?.reading ?? null;
  const fresh = !!dev.arrival && now - dev.arrival.deliveredAt < 8000 && dev.node?.online !== false;
  const checks = useMemo(() => sensorChecks(fresh ? reading : null), [fresh, reading]);
  const evaluation = useMemo(() => preflightEvaluation(fresh ? reading : null, checks), [fresh, reading, checks]);
  const notReady = checks.filter((c) => c.status !== "ok").length;
  const ready = fresh && notReady === 0;
  const local = m.status === "local";
  const sim = m.source === "sim";

  const serverRow: { status: SensorStatus; detail: string; value: string } =
    m.status === "checking"
      ? { status: "progress", detail: "Looking for the ship server…", value: "checking" }
      : local
        ? m.serverMissing
          ? { status: "problem", detail: "Not reachable. Running the built-in simulator instead.", value: "no server" }
          : { status: "ok", detail: "Demo mode: simulator and rules run in this browser", value: "built-in" }
        : m.health?.db === false
          ? { status: "problem", detail: `${m.backend?.label} · database not responding`, value: "no database" }
          : m.ship.connected
            ? { status: "ok", detail: `${m.backend?.label} · live link open`, value: "connected" }
            : { status: "progress", detail: `${m.backend?.label} · opening live link…`, value: "connecting" };

  const deviceRow: { status: SensorStatus; detail: string; value: string } = dev.deviceId
    ? fresh
      ? { status: "ok", detail: `${reading?.source === "sim" ? "Simulated node" : "ESP32"} · ${dev.deviceId}`, value: reading?.source === "sim" ? "sim" : "device" }
      : { status: "problem", detail: `${dev.deviceId} · stopped sending`, value: `${ago(now - (dev.arrival?.deliveredAt ?? now))} ago` }
    : { status: "missing", detail: sim ? "Starting the simulated node…" : "No wristband has reported to the ship yet", value: "waiting" };

  const dataRow: { status: SensorStatus; detail: string; value: string } = fresh
    ? { status: "ok", detail: "one packet every 2 s", value: `seq ${reading?.seq ?? 0}` }
    : { status: "missing", detail: "one packet every 2 s expected", value: "—" };

  const subtitle = ready
    ? "The wristband is connected and every sensor is reading."
    : sim
      ? "Simulated wristband. Every sensor must turn green."
      : "Turn on the wristband, put it on and sit still. Every sensor must turn green.";

  return (
    <div className={`app aud-ship ${hud.mobile ? "mobile" : ""}`}>
      <div className="hud" style={hud.style}>
        <header className="bar top">
          <Brand />
          <nav className="tabs" aria-label="Views">
            <a href="#ground" className="tab">
              Ground medical
            </a>
            <a href="#guide" className="tab">
              Guide
            </a>
          </nav>
          <p className="meta">Preflight · prototype, not a medical device</p>
        </header>

        <div className="pre-title">
          <h1>Preflight check</h1>
          <p>{subtitle}</p>
        </div>

        <section className="card conn" aria-labelledby="c-conn">
          <p className="eyebrow">Connection</p>
          <h2 id="c-conn">Ship link</h2>
          <label htmlFor="api" className="field-label" style={{ display: "block", marginBottom: 6, fontSize: 12 }}>
            Ship server address
          </label>
          <form
            className="row-inline"
            onSubmit={(e) => {
              e.preventDefault();
              m.reconnect(url.trim());
            }}
          >
            <input id="api" className="input" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} inputMode="url" />
            <button type="submit" className="btn">
              Reconnect
            </button>
          </form>
          <ul className="checks">
            <Check name="Ship server" {...serverRow} />
            <Check name="Device found" {...deviceRow} />
            <Check name="Receiving data" {...dataRow} />
          </ul>
        </section>

        <section className="card sens" aria-labelledby="c-sens">
          <p className="eyebrow">Sensors</p>
          <h2 id="c-sens">Is every sensor reading?</h2>
          <ul className="checks">
            {checks.map((c) => (
              <Check key={c.id} {...c} />
            ))}
          </ul>
        </section>

        {!ready && (
          <section className="explore" aria-labelledby="explore-title">
            <div>
              <p className="eyebrow">No wristband at hand?</p>
              <h2 id="explore-title">Explore AURA with simulated data</h2>
              <p>
                A fictional crew member on a long mission. Launch a CO leak, a depressurization or an impact and watch what
                the astronaut and the ground team see. Everything simulated is labeled SIMULATED.
              </p>
            </div>
            <div className="explore-actions">
              <button type="button" className="btn go" onClick={m.exploreSim}>
                Explore with simulated data →
              </button>
              <a className="link" href="#guide">
                Read the user guide first
              </a>
            </div>
          </section>
        )}

        <div className="pre-body" style={{ opacity: ready ? 1 : fresh ? 0.75 : 0.45 }}>
          <Scene evaluation={evaluation} bpm={ready ? (reading?.vitals.bpm ?? null) : null} />
        </div>
        <div className={`pre-chip ${ready ? "" : "lvl-nominal"}`} style={ready ? { ["--c" as string]: "var(--ok)" } : undefined}>
          <p className="eyebrow">{ready ? "Wristband ready" : "Waiting for sensors"}</p>
          <p>
            {ready && reading
              ? `Pulse ${reading.vitals.bpm} · SpO₂ ${reading.vitals.spo2}% · cabin ${reading.env.pressureKpa?.toFixed(1)} kPa`
              : "The body lights up as each sensor reports."}
          </p>
        </div>

        <footer className="bar bottom">
          <div className="radios" role="radiogroup" aria-label="Data source">
            <label className={`radio ${!sim ? "on" : ""}`}>
              <input type="radio" name="src" checked={!sim} disabled={local} onChange={() => m.setSource("live")} />
              Live wristband
            </label>
            <label className={`radio ${sim ? "on" : ""}`}>
              <input type="radio" name="src" checked={sim} onChange={() => m.setSource("sim")} />
              Simulation
            </label>
          </div>
          <div className="pre-go">
            {ready ? (
              <p className="ready">All sensors working</p>
            ) : (
              <>
                <p>{fresh ? `${notReady} sensor${notReady === 1 ? "" : "s"} not ready` : "No data yet"}</p>
                {fresh && (
                  <button type="button" className="link" onClick={m.start}>
                    Start anyway
                  </button>
                )}
              </>
            )}
            <button type="button" className="btn go" disabled={!ready} onClick={m.start}>
              Start mission{ready ? " →" : ""}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
