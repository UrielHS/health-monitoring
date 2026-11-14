import { IMPACT_ESCALATE_SEC } from "@astro/shared";
import type { SeenAlert } from "@/model/types";
import { useNow } from "@/data/mission";

interface Props {
  impact: SeenAlert;
  escalated: boolean;
  onOk: () => void;
  onCall: () => void;
}

const R = 28;
const LEN = 2 * Math.PI * R;

/** "¿Estás bien?": si nadie contesta en 30 s, la alerta escala a la tripulación. */
export function ImpactDialog({ impact, escalated, onOk, onCall }: Props) {
  const now = useNow(250);
  const left = Math.max(0, IMPACT_ESCALATE_SEC - (now - impact.seenAt) / 1000);
  const done = escalated || left <= 0;
  return (
    <div className={`dialog lvl-${done ? "danger" : "caution"}`} role="alertdialog" aria-labelledby="impact-title">
      <p className="eyebrow">{done ? "No answer after a hard hit" : "Hard hit detected"}</p>
      <h1 id="impact-title">Are you OK?</h1>
      <div className="countdown">
        <svg aria-hidden width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke="var(--c)"
            strokeWidth="4"
            strokeDasharray={LEN}
            strokeDashoffset={done ? 0 : LEN * (1 - left / IMPACT_ESCALATE_SEC)}
            transform="rotate(-90 32 32)"
          />
        </svg>
        {done ? (
          <p>
            <b>Crew alerted</b>
            <br />
            Tap “I’m OK” to stand them down
          </p>
        ) : (
          <p>
            <b>{Math.ceil(left)} s</b>
            <br />
            until the crew is alerted
          </p>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn-ok" onClick={onOk} autoFocus>
          I’m OK
        </button>
        {!done && (
          <button type="button" className="btn-call" onClick={onCall}>
            Call the crew
          </button>
        )}
      </div>
    </div>
  );
}
