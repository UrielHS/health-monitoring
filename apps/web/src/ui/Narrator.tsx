import { useState } from "react";
import type { Scenario } from "@astro/shared";
import { SCENARIO_INFO } from "@/model/scenarios";

interface Props {
  scenario: Scenario;
  onTour: () => void;
}

/**
 * Tarjeta para quien evalúa: qué se está simulando, qué detecta AURA y qué mirar en pantalla.
 * Solo aparece con datos simulados; se puede minimizar.
 */
export function Narrator({ scenario, onTour }: Props) {
  const [open, setOpen] = useState(true);
  const info = SCENARIO_INFO[scenario];

  if (!open)
    return (
      <button type="button" className="narrator-chip" data-tour="narrator" onClick={() => setOpen(true)}>
        <span className="eyebrow">Simulating</span> {info.label} · what to look for
      </button>
    );

  return (
    <section className="narrator" data-tour="narrator" aria-live="polite" aria-label="About this scenario">
      <div className="narrator-head">
        <p className="eyebrow">
          Simulating · {info.label}
          <span className="narrator-wait"> · {info.wait}</span>
        </p>
        <div className="narrator-actions">
          <button type="button" className="link" onClick={onTour}>
            Tour
          </button>
          <a className="link" href="#guide">
            Guide
          </a>
          <button type="button" className="icon-btn small" aria-label="Minimize" onClick={() => setOpen(false)}>
            <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 6 H10" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
      </div>
      <p className="narrator-what">{info.simulates}</p>
      <p className="narrator-detects">
        <b>AURA detects:</b> {info.detects}
      </p>
      <ul className="narrator-look">
        {info.lookFor.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}
