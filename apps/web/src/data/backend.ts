import type { Alert, NodeStatus, Reading, Scenario } from "@astro/shared";

/** Fila de síntoma tal como la guarda el servidor. */
export type SymptomRow = {
  id: number;
  deviceId: string;
  type: string;
  intensity: number;
  note?: string | null;
  shareWithGround: boolean;
  createdAt: string | number;
};

export type SymptomInput = {
  deviceId: string;
  type: string;
  intensity: number;
  note?: string;
  shareWithGround: boolean;
};

export type MissionEvent =
  | { type: "telemetry"; payload: Reading }
  | { type: "alert"; payload: Alert }
  | { type: "alert:resolved"; payload: Alert }
  | { type: "alert:ack"; payload: Alert }
  | { type: "node:status"; payload: NodeStatus }
  | { type: "symptom"; payload: SymptomRow };

/** Cuándo pasó en la nave y cuándo llegó a esta pantalla (igual en la Nave, con retraso en Tierra). */
export type Timing = { originalAt: number; deliveredAt: number };

export type Snapshot = {
  readings?: Reading[];
  nodes?: NodeStatus[];
  alerts?: Alert[];
  groundDelaySec?: number;
};

export interface Listener {
  link(connected: boolean): void;
  snapshot(s: Snapshot): void;
  event(e: MissionEvent, t: Timing): void;
}

export type SimStatus = {
  enabled: boolean;
  running: boolean;
  scenario?: Scenario;
  deviceId?: string;
};

export type Health = { reachable: boolean; db: boolean };

/**
 * De dónde salen los datos. Hay dos implementaciones con el mismo comportamiento:
 * RemoteBackend (el servidor de la Nave por Socket.IO y REST) y LocalBackend
 * (simulador y motor de reglas dentro del navegador, para la demo sin servidor).
 */
export interface Backend {
  kind: "remote" | "local";
  /** Texto corto para la interfaz: la URL del servidor o "built-in simulator". */
  label: string;
  ship(l: Listener): () => void;
  ground(l: Listener): () => void;
  health(): Promise<Health>;
  ack(alertId: number): Promise<void>;
  escalate(alertId: number): Promise<void>;
  logSymptom(s: SymptomInput): Promise<void>;
  simStatus(): Promise<SimStatus>;
  simStart(scenario: Scenario, deviceId: string): Promise<SimStatus>;
  simStop(): Promise<SimStatus>;
  /** Lo que Tierra ya tendría si hubiera estado conectada: alertas y síntomas compartidos recientes. */
  groundHistory(): Promise<{ alerts: Alert[]; symptoms: SymptomRow[] }>;
  /** Lecturas recientes de un dispositivo (para las gráficas de tendencia), de la más vieja a la más nueva. */
  readings(deviceId: string, minutes: number): Promise<Reading[]>;
  dispose(): void;
}
