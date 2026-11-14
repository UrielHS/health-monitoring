import { RuleEngine as SharedRuleEngine } from "@astro/shared";
import { env } from "./env.js";

/**
 * El motor de reglas vive en packages/shared (rules.ts) para que la app pueda usar
 * exactamente las mismas reglas en modo demo. Aquí solo se le pasan los valores del entorno.
 */
export { IMPACT_NO_RESPONSE, NODE_OFFLINE, RULES, THRESHOLDS, type Rule, type RuleHit } from "@astro/shared";

export class RuleEngine extends SharedRuleEngine {
  constructor() {
    super({ timeScale: env.RULE_TIME_SCALE, baselineSamples: env.BASELINE_SAMPLES });
  }
}
