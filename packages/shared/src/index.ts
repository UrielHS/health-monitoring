import { z } from "zod";

/**
 * Contrato de telemetría entre el nodo ESP32, el simulador y el servidor.
 * Cualquier cambio aquí se acuerda entre backend y conexión del dispositivo
 * (ver sección 6 del documento del proyecto).
 */
export const telemetrySchema = z.object({
  deviceId: z.string().min(1).max(64),
  /** Identificador aleatorio que el ESP32 genera en cada arranque: esp_random() & 0x7FFFFFFF. */
  bootId: z.number().int().nonnegative().max(2147483647),
  /** Contador que reinicia en 0 en cada arranque. Único por (deviceId, bootId). */
  seq: z.number().int().nonnegative(),
  /** Milisegundos desde el arranque (millis()). Sirve para reconstruir la hora sin NTP. */
  bootMs: z.number().int().nonnegative(),
  /** Hora real en epoch ms. Se omite si el nodo no ha sincronizado NTP. */
  ts: z.number().int().positive().optional(),
  source: z.enum(["device", "sim"]).default("device"),
  vitals: z.object({
    bpm: z.number().min(0).max(250).nullable(),
    spo2: z.number().min(0).max(100).nullable(),
    quality: z.enum(["ok", "noisy", "no_finger"]),
  }),
  motion: z.object({
    accMag: z.number(),
    gyroMag: z.number(),
    activity: z.enum(["rest", "light", "active"]),
    impact: z.boolean(),
  }),
  env: z.object({
    tempC: z.number().nullable(),
    rh: z.number().nullable(),
    pressureKpa: z.number().nullable(),
    /** Estimación de CO. Con el MQ-7 sin calibrar es un valor relativo (ver sección 10). */
    coPpm: z.number().nullable(),
    coState: z.enum(["warming", "heating", "ready"]),
  }),
  localAlert: z.enum(["none", "warning", "critical"]).default("none"),
});

export const telemetryBatchSchema = z.array(telemetrySchema).min(1).max(50);

export type Telemetry = z.infer<typeof telemetrySchema>;
export type TelemetryInput = z.input<typeof telemetrySchema>;

/** Lectura ya procesada por el servidor (con hora resuelta). */
export type Reading = Telemetry & { ts: number; receivedAt: number };

export type AlertLevel = "info" | "warning" | "critical";

export type Alert = {
  id: number;
  deviceId: string;
  ruleId: string;
  level: AlertLevel;
  title: string;
  /** Qué pasó, por qué importa y qué hacer, en lenguaje simple. */
  message: string;
  action: string;
  values: Record<string, unknown>;
  startedAt: number;
  endedAt: number | null;
  ackAt: number | null;
};

export type NodeStatus = {
  deviceId: string;
  online: boolean;
  lastSeen: number;
};

export const symptomSchema = z.object({
  deviceId: z.string().min(1),
  type: z.enum(["dolor_cabeza", "mareo", "nausea", "fatiga", "animo", "sueno", "otro"]),
  intensity: z.number().int().min(1).max(5),
  note: z.string().max(500).optional(),
  shareWithGround: z.boolean().default(false),
});

export type Symptom = z.infer<typeof symptomSchema>;

/** Eventos de Socket.IO. Namespaces: "/ship" (tiempo real) y "/ground" (con retraso). */
export const EVENTS = {
  telemetry: "telemetry",
  alert: "alert",
  alertResolved: "alert:resolved",
  alertAck: "alert:ack",
  nodeStatus: "node:status",
  symptom: "symptom",
} as const;

/** Envoltura de lo que recibe la vista Tierra: el dato original y cuándo llegó. */
export type GroundEnvelope<T> = {
  payload: T;
  originalAt: number;
  deliveredAt: number;
};

export * from "./rules.js";
export * from "./sim.js";
