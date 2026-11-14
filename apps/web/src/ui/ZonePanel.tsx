import { PANEL_WORD, ZONES } from "@/model/copy";
import type { Evaluation, ZoneId } from "@/model/types";
import { lineRef, panelRef } from "@/scene/leaders";
import { clock } from "./format";

interface Props {
  zone: ZoneId;
  evaluation: Evaluation;
  ground?: boolean;
  onAck?: (alertId: number) => void;
}

/** Panel de una zona del cuerpo: valor, por qué importa y, si hay alerta, qué pasó y qué hacer. */
export function ZonePanel({ zone, evaluation, ground, onAck }: Props) {
  const info = ZONES[zone];
  const z = evaluation.zones[zone];
  const alarm = z.level === "danger" || z.level === "caution";
  const canAck = !ground && onAck && z.alert && !z.alert.ackAt && !z.alert.ruleId.startsWith("impact");
  return (
    <div ref={panelRef(zone)} className={`panel-wrap lvl-${z.level} ${alarm ? "alarm" : ""}`}>
      <section className="panel" aria-label={info.title}>
        <div className="panel-in">
          <div className="panel-head">
            <span>{info.title}</span>
            <span>{PANEL_WORD[z.level]}</span>
          </div>
          <div className="panel-body">
            <p className="panel-value">
              {z.value}
              {z.unit && <small>{z.unit}</small>}
            </p>
            {z.headline ? (
              <>
                <p className="panel-headline">{z.headline}</p>
                {z.detail && <p className="panel-detail">{z.detail}</p>}
                {z.action && (
                  <div className="panel-action">
                    <p>→ {z.action}</p>
                    {canAck && (
                      <button type="button" className="btn-ack" onClick={() => onAck(z.alert!.id)}>
                        Acknowledge
                      </button>
                    )}
                  </div>
                )}
                {z.alert?.ackAt && (
                  <p className="panel-ack">
                    {ground ? "Ack on board" : "Acknowledged"} {clock(z.alert.ackAt)}
                  </p>
                )}
              </>
            ) : (
              <p className="panel-why">{z.note ?? info.why}</p>
            )}
          </div>
          <div className="panel-foot">
            <span>{info.sensor}</span>
            <span>{info.hazard}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Líneas del panel al cuerpo. Las mueve LeaderProjector en cada cuadro. */
export function Leaders({ zones, evaluation }: { zones: ZoneId[]; evaluation: Evaluation }) {
  return (
    <svg className="leaders" aria-hidden>
      {zones.map((zone) => {
        const level = evaluation.zones[zone].level;
        return (
          <g key={zone} ref={lineRef(zone)} className={`leader lvl-${level}`} style={{ display: "none" }}>
            <polyline />
            <circle className="halo-2" r={16} />
            <circle className="halo" r={8} />
            <circle className="dot" r={3.5} />
          </g>
        );
      })}
    </svg>
  );
}
