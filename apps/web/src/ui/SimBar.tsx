import { SCENARIOS, type Scenario } from "@astro/shared";
import { SCENARIO_LABEL } from "@/model/copy";

/** Lanza escenarios que no se pueden provocar de verdad. Siempre marcado como simulación (RF-19). */
export function SimBar({ current, onRun }: { current: Scenario | null; onRun: (s: Scenario) => void }) {
  return (
    <div className="sim" role="group" aria-label="Simulator">
      <span className="sim-label">SIMULATION</span>
      {SCENARIOS.map((s, i) => (
        <button key={s} type="button" className={current === s ? "on" : ""} aria-pressed={current === s} title={`Key ${i + 1}`} onClick={() => onRun(s)}>
          {SCENARIO_LABEL[s] ?? s}
        </button>
      ))}
    </div>
  );
}
