import type { Alert } from "@astro/shared";

export type Level = "nominal" | "unreliable" | "caution" | "danger" | "offline";

export const LEVEL_RANK: Record<Level, number> = {
  nominal: 0,
  unreliable: 1,
  caution: 2,
  offline: 2.5,
  danger: 3,
};

export type ZoneId = "head" | "heart" | "lungs" | "body" | "cabin";
export const ZONE_IDS: ZoneId[] = ["head", "lungs", "cabin", "heart", "body"];

/** An alert as the app holds it: the server alert plus when this screen first saw it. */
export type SeenAlert = Alert & { seenAt: number };

export interface ZoneState {
  level: Level;
  /** Big value in the panel: "68", "calm", "—". */
  value: string;
  unit?: string;
  /** Present when something needs attention. */
  headline?: string;
  detail?: string;
  action?: string;
  /** Small grey line under a nominal value, e.g. "Exercise · no alert". */
  note?: string;
  /** The server alert behind this state, when it can be acknowledged. */
  alert?: SeenAlert;
}

export interface EnvReading {
  key: "co" | "pressure" | "temp" | "rh";
  label: string;
  value: string;
  unit: string;
  level: Level;
}

export interface Banner {
  level: Level;
  title: string;
  action: string;
  note?: string;
}

export interface Evaluation {
  overall: Level;
  zones: Record<ZoneId, ZoneState>;
  env: EnvReading[];
  exercising: boolean;
  /** True when CO is dangerous while the oximeter still looks fine. */
  coTrap: boolean;
  banner: Banner | null;
  /** Unacknowledged impact waiting for "I'm OK". */
  impact: SeenAlert | null;
  /** The impact escalated to the crew (no answer in 30 s, or "Call the crew"). */
  impactEscalated: SeenAlert | null;
}
