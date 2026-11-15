import { SCENARIOS, type Scenario } from "@astro/shared";
import { SCENARIO_INFO } from "@/model/scenarios";

/** Lanza escenarios que no se pueden provocar de verdad. Siempre marcado como simulación (RF-19). */
export function SimBar({ current, onRun }: { current: Scenario | null; onRun: (s: Scenario) => void }) {
  return (
    <div className="sim" role="group" aria-label="Try a scenario" data-tour="scenarios">
      <span className="sim-label">
        Try a<br />
        scenario
      </span>
      {SCENARIOS.map((s, i) => (
        <button
          key={s}
          type="button"
          className={current === s ? "on" : ""}
          aria-pressed={current === s}
          title={`${SCENARIO_INFO[s].short} (key ${i + 1})`}
          onClick={() => onRun(s)}
        >
          {SCENARIO_INFO[s].label}
        </button>
      ))}
    </div>
  );
}
