import { useEffect, useMemo, useState } from "react";
import { SCENARIOS } from "@astro/shared";
import { pickDevice, useMission, useNow } from "@/data/mission";
import { evaluate } from "@/model/evaluate";
import type { ZoneId } from "@/model/types";
import { Scene } from "@/scene/Scene";
import { BannerBox, Header } from "./Frame";
import { ImpactDialog } from "./ImpactDialog";
import { SimBar } from "./SimBar";
import { SymptomDrawer } from "./SymptomDrawer";
import { Leaders, ZonePanel } from "./ZonePanel";
import { ago, clock } from "./format";
import { useHudScale } from "./useHudScale";

const LEFT: ZoneId[] = ["head", "lungs", "cabin"];
const RIGHT: ZoneId[] = ["heart", "body"];

/** Vista del astronauta (#ship): tiempo real, se entiende de un vistazo. */
export function ShipView() {
  const m = useMission();
  const hud = useHudScale();
  const now = useNow(1000);
  const [symptoms, setSymptoms] = useState(false);
  const [simBar, setSimBar] = useState(false);

  const dev = pickDevice(m.ship, m.source);
  const reading = dev.arrival?.reading ?? null;
  const evaluation = useMemo(
    () => evaluate({ reading, alerts: dev.alerts, node: dev.node, linked: m.ship.connected, audience: "ship" }),
    [reading, dev.alerts, dev.node, m.ship.connected],
  );
  const simulated = reading?.source === "sim" || m.source === "sim";
  const showSim = m.source === "sim" || simBar;
  const offline = evaluation.overall === "offline";
  const lastAgo = dev.arrival ? now - dev.arrival.deliveredAt : null;

  // Atajos para quien presenta: 1–8 escenarios · S barra del simulador · Esc cierra síntomas
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= SCENARIOS.length && showSim) {
        if (m.source !== "sim") m.setSource("sim");
        m.runScenario(SCENARIOS[n - 1]);
      } else if (e.key.toLowerCase() === "s") setSimBar((v) => !v);
      else if (e.key === "Escape") setSymptoms(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m, showSim]);

  const banner = evaluation.banner;
  const impactOpen = !!evaluation.impact;
  const offlineSecs = offline && dev.node && !dev.node.online ? ` Nothing received for ${ago(now - dev.node.lastSeen)}.` : "";

  const meta = !m.ship.connected
    ? `No link to ${m.backend?.label ?? "the ship server"}`
    : !dev.deviceId
      ? m.source === "sim"
        ? "Starting the simulator…"
        : "Live · waiting for the wristband"
      : reading?.source === "sim"
        ? `Simulated data · ${m.backend?.kind === "remote" ? `POST /api/sim/${m.scenario ?? "normal"}` : "built-in simulator"}`
        : `Live · ${dev.deviceId} · last packet ${ago(lastAgo ?? 0)} ago`;

  const footLeft = !dev.deviceId
    ? "No wristband yet"
    : offline && dev.node && !dev.node.online
      ? `${simulated ? "Simulator" : "Wristband"} offline since ${clock(dev.node.lastSeen)}`
      : simulated
        ? `Simulator · ${dev.deviceId}`
        : `Wristband online · seq ${reading?.seq ?? 0}`;

  return (
    <div className={`app aud-ship ${hud.mobile ? "mobile" : ""}`}>
      <div className={`stage ${impactOpen || symptoms || offline ? "dim" : ""}`}>
        <Scene evaluation={evaluation} bpm={evaluation.zones.heart.level === "unreliable" ? null : (reading?.vitals.bpm ?? null)} />
      </div>
      <Leaders zones={symptoms ? LEFT : [...LEFT, ...RIGHT]} evaluation={evaluation} />

      <div className="hud" style={hud.style}>
        <Header level={evaluation.overall} view="ship" simulated={simulated && !!dev.deviceId} meta={meta} />
        {hud.mobile && <div className="spacer" />}

        {banner && !impactOpen && (
          <BannerBox level={banner.level} title={banner.title} action={banner.action + offlineSecs} note={banner.note} />
        )}
        {evaluation.impact && (
          <ImpactDialog
            impact={evaluation.impact}
            escalated={!!evaluation.impactEscalated}
            onOk={() => m.ack(evaluation.impact!.id)}
            onCall={() => m.escalate(evaluation.impact!.id)}
          />
        )}

        <div className="col left">
          {LEFT.map((z) => (
            <ZonePanel key={z} zone={z} evaluation={evaluation} onAck={m.ack} />
          ))}
        </div>
        {!symptoms && (
          <div className="col right">
            {RIGHT.map((z) => (
              <ZonePanel key={z} zone={z} evaluation={evaluation} onAck={m.ack} />
            ))}
          </div>
        )}
        {symptoms && <SymptomDrawer deviceId={dev.deviceId} onClose={() => setSymptoms(false)} onSubmit={m.logSymptom} />}

        <footer className="bar bottom">
          <div className={`foot-left ${offline ? "lvl-offline" : ""}`}>
            <span className="dot" aria-hidden />
            <span>{footLeft}</span>
            <button type="button" className="link" onClick={m.backToPreflight}>
              Preflight
            </button>
            {!showSim && (
              <button type="button" className="link" onClick={() => setSimBar(true)} title="Key S">
                Simulator
              </button>
            )}
          </div>
          {showSim && (
            <SimBar
              current={m.source === "sim" ? m.scenario : null}
              onRun={(s) => {
                if (m.source !== "sim") m.setSource("sim");
                m.runScenario(s);
              }}
            />
          )}
          <div className="foot-right">
            {showSim && m.status === "remote" && (
              <button type="button" className="link" onClick={() => (m.setSource("live"), setSimBar(false))}>
                ← Live wristband
              </button>
            )}
            {!symptoms && (
              <button type="button" className="btn primary" onClick={() => setSymptoms(true)}>
                How do you feel?
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
