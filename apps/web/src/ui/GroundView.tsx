import { useMemo } from "react";
import { APP_NAME } from "@/config";
import { pickDevice, useMission, useNow } from "@/data/mission";
import type { LogItem } from "@/data/mirror";
import { evaluate } from "@/model/evaluate";
import type { ZoneId } from "@/model/types";
import { Scene } from "@/scene/Scene";
import { BannerBox, Header } from "./Frame";
import { Leaders, ZonePanel } from "./ZonePanel";
import { ago, clock } from "./format";
import { useHudScale } from "./useHudScale";

const LEFT: ZoneId[] = ["head", "lungs", "cabin"];

/** Vista del médico en Tierra (#ground): lo mismo que vio la tripulación, pero tarde (RF-30). */
export function GroundView() {
  const m = useMission();
  const hud = useHudScale();
  const now = useNow(1000);

  const dev = pickDevice(m.ground, "latest");
  const reading = dev.arrival?.reading ?? null;
  const evaluation = useMemo(
    () => evaluate({ reading, alerts: dev.alerts, node: dev.node, linked: m.ground.connected, audience: "ground" }),
    [reading, dev.alerts, dev.node, m.ground.connected],
  );
  const delay = m.ground.groundDelaySec;
  const lag = dev.arrival ? Math.round((dev.arrival.deliveredAt - dev.arrival.originalAt) / 1000) : null;
  const stale = dev.arrival ? now - dev.arrival.deliveredAt : 0;
  const log = dev.deviceId ? m.ground.log.filter((l) => l.deviceId === dev.deviceId) : m.ground.log;
  const heart = evaluation.zones.heart;
  const body = evaluation.zones.body;

  return (
    <div className={`app aud-ground ${hud.mobile ? "mobile" : ""}`}>
      <div className="stage">
        <Scene evaluation={evaluation} bpm={heart.level === "unreliable" ? null : (reading?.vitals.bpm ?? null)} />
      </div>
      <Leaders zones={LEFT} evaluation={evaluation} />

      <div className="hud" style={hud.style}>
        <Header
          level={evaluation.overall}
          view="ground"
          simulated={reading?.source === "sim"}
          meta={lag == null ? "Nothing received from the ship yet" : `Last data ${lag} s old on arrival${stale > 15_000 ? ` · ${ago(stale)} ago` : ""}`}
        />
        {hud.mobile && <div className="spacer" />}

        <div className="banner delay">
          <svg aria-hidden width="18" height="18" viewBox="0 0 18 18">
            <circle cx="9" cy="9" r="7.5" fill="none" stroke="var(--ground)" strokeWidth="1.5" />
            <path d="M9 4.5 V9 L12 11" fill="none" stroke="var(--ground)" strokeWidth="1.5" />
          </svg>
          <p>
            <b>Data delayed {delay ?? "…"} s.</b> On a Mars mission this would be up to 20 min.
          </p>
        </div>
        {evaluation.overall === "offline" && evaluation.banner && (
          <BannerBox sub level="offline" title={evaluation.banner.title} action={evaluation.banner.action} />
        )}

        <div className="col left">
          {LEFT.map((z) => (
            <ZonePanel key={z} zone={z} evaluation={evaluation} ground />
          ))}
        </div>

        {reading && evaluation.overall !== "offline" && (
          <div className={`vital-chip lvl-${heart.level === "nominal" ? body.level : heart.level}`}>
            <p className="eyebrow">Heart · Body</p>
            <b>
              {heart.value} <small>{heart.unit}</small>
            </b>
            <p>{[heart.headline ?? heart.note, body.headline ?? `${cap(body.value)} · no impacts`].filter(Boolean).join(" · ")}</p>
          </div>
        )}

        <section className="side log" aria-labelledby="log-title">
          <p className="eyebrow">Event log · {dev.deviceId ?? "no device"}</p>
          <h2 id="log-title">What the crew saw</h2>
          <p className="hint">Each event shows when it happened on board and when it reached Earth.</p>
          <ul className="log-list">
            {log.length === 0 && (
              <li>
                <span className="log-dot" aria-hidden />
                <div>
                  <p className="log-title">Nothing has reached Earth yet</p>
                  <p className="log-detail">Events arrive {delay ?? "…"} s after they happen on board.</p>
                </div>
                <p className="log-time" />
              </li>
            )}
            {log.map((item) => (
              <li key={item.key}>
                <span className={`log-dot ${item.level}`} aria-hidden />
                <div>
                  <p className="log-title">{item.title}</p>
                  {item.detail && <p className="log-detail">{item.detail}</p>}
                </div>
                <p className="log-time">
                  sent {clock(item.originalAt)}
                  <br />
                  received {clock(item.deliveredAt)}
                </p>
              </li>
            ))}
          </ul>
          <button type="button" className="export" disabled={log.length === 0} onClick={() => exportReport(log, dev.deviceId, delay)}>
            Export report for the medical team →
          </button>
        </section>

        <footer className="bar bottom">
          <div className="foot-left">
            <span>Prototype, not a medical device · thresholds are not clinical criteria · the crew already acted on what you see here</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Reporte de texto con la bitácora, para adjuntar al expediente (RF-21). */
function exportReport(log: LogItem[], deviceId: string | null, delay: number | null) {
  const lines = [
    `${APP_NAME} — ground medical report`,
    `Device: ${deviceId ?? "unknown"}`,
    `Generated: ${new Date().toISOString()}`,
    `Downlink delay: ${delay ?? "?"} s`,
    "Prototype, not a medical device. Thresholds are not clinical criteria.",
    "",
    "sent (on board)\treceived (Earth)\tlevel\tevent\tdetail",
    ...[...log].reverse().map((l) => [clock(l.originalAt), clock(l.deliveredAt), l.level, l.title, l.detail ?? ""].join("\t")),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `ground-report-${deviceId ?? "device"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
