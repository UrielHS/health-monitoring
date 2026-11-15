import { z } from "zod";

/**
 * Contrato de telemetría v1 (congelado) entre la pulsera ESP32, el simulador y el servidor.
 * Es el mismo JSON por MQTT (topic astro/v1/<deviceId>/telemetry) y por HTTP (POST /api/telemetria).
 * Cualquier cambio aquí se acuerda entre backend y conexión del dispositivo y sube `v`.
 *
 * Reglas de valores:
 * - Sensor ausente o lectura inválida = null, nunca 0 ni -1.
 * - Todas las claves viajan siempre (no hay campos opcionales) y no se aceptan claves extra.
 */
export const CONTRACT_VERSION = 1;

/** Prisma guarda bootId y seq como Int de 32 bits. */
const INT32_MAX = 2147483647;
const finite = z.number().finite();

export const telemetrySchema = z
  .object({
    v: z.literal(CONTRACT_VERSION),
    deviceId: z.string().regex(/^[a-z0-9-]{3,32}$/, "deviceId: minúsculas, números y guiones (3 a 32)"),
    /** Distinto en cada arranque del ESP32 (esp_random() & 0x7FFFFFFF). Con seq forma la clave única. */
    bootId: z.number().int().nonnegative().max(INT32_MAX),
    /** Empieza en 0 en cada arranque. */
    seq: z.number().int().nonnegative().max(INT32_MAX),
    /** millis() al tomar la lectura. Sirve para reconstruir la hora sin NTP. */
    bootMs: z.number().int().nonnegative(),
    /** Epoch en ms (UTC), o null si el nodo no tiene hora NTP. */
    ts: z.number().int().positive().nullable(),
    source: z.enum(["device", "sim"]),
    vitals: z
      .object({
        // Se aceptan decimales: rechazar el paquete completo (con CO y presión) por un 72.4 sería peor.
        bpm: finite.min(0).nullable(),
        spo2: finite.min(0).max(100).nullable(),
        quality: z.enum(["ok", "noisy", "no_finger", "no_sensor"]),
      })
      .strict(),
    motion: z
      .object({
        sensor: z.enum(["bmi160", "mpu6050", "none"]),
        /** g */
        accMag: finite.nullable(),
        /** °/s */
        gyroMag: finite.nullable(),
        activity: z.enum(["rest", "light", "active"]).nullable(),
        impact: z.boolean(),
      })
      .strict(),
    env: z
      .object({
        tempC: finite.nullable(),
        rh: finite.nullable(),
        pressureKpa: finite.nullable(),
        /**
         * Pulsera real: escala de demo 0–40 calibrada contra el aire de la sala (no son ppm reales).
         * No se rechaza un valor fuera de rango: descartar justo la lectura más peligrosa sería peor.
         */
        coPpm: finite.nullable(),
        coState: z.enum(["warming", "heating", "ready", "no_sensor"]),
      })
      .strict(),
    /** Lo que decidió la pulsera por su cuenta (buzzer y OLED), sin depender de la red. */
    localAlert: z
      .object({
        level: z.enum(["none", "warning", "danger"]),
        rules: z.array(z.string().max(32)).max(16),
      })
      .strict(),
  })
  .strict();

export const telemetryBatchSchema = z.object({ packets: z.array(telemetrySchema).min(1).max(50) }).strict();

export type Telemetry = z.infer<typeof telemetrySchema>;
export type TelemetryInput = z.input<typeof telemetrySchema>;
export type LocalAlertLevel = Telemetry["localAlert"]["level"];

/** Lectura ya procesada por el servidor: la hora siempre resuelta (NTP o reconstruida con bootMs). */
export type Reading = Omit<Telemetry, "ts"> & { ts: number; receivedAt: number };

/** Códigos que puede mandar la pulsera en localAlert.rules. */
export const LOCAL_RULE_CODES = [
  "SPO2_LOW", "HR_HIGH", "HR_LOW", "CO_HIGH", "PRESSURE_LOW",
  "PRESSURE_DROP", "TEMP_RANGE", "RH_RANGE", "IMPACT",
] as const;

/** Topics MQTT (broker Mosquitto en la laptop Nave). */
export const MQTT_PREFIX = "astro/v1";
export const TOPICS = {
  /** La pulsera publica aquí el contrato (QoS 0 con PubSubClient). */
  telemetry: (deviceId: string) => `${MQTT_PREFIX}/${deviceId}/telemetry`,
  /** "online" retenido al conectar y "offline" por Last Will. */
  status: (deviceId: string) => `${MQTT_PREFIX}/${deviceId}/status`,
  /** El servidor publica aquí por qué rechazó un paquete (con MQTT no hay respuesta HTTP). */
  errors: (deviceId: string) => `${MQTT_PREFIX}/${deviceId}/errors`,
  /** Umbrales vigentes, retenido (lo mismo que GET /api/config). */
  config: `${MQTT_PREFIX}/config`,
  /** Suscripciones del servidor. */
  allTelemetry: `${MQTT_PREFIX}/+/telemetry`,
  allStatus: `${MQTT_PREFIX}/+/status`,
} as const;

/** astro/v1/<deviceId>/<kind> → partes, o null si no es un topic del proyecto. */
export function parseTopic(topic: string): { deviceId: string; kind: string } | null {
  const parts = topic.split("/");
  if (parts.length !== 4 || `${parts[0]}/${parts[1]}` !== MQTT_PREFIX) return null;
  return { deviceId: parts[2], kind: parts[3] };
}

export type DecodeResult =
  | { ok: true; data: Telemetry }
  | { ok: false; deviceId: string | null; error: "bad_topic" | "invalid_json" | "validation" | "device_mismatch"; issues?: z.ZodIssue[] };

/**
 * Mensaje MQTT de telemetría → contrato validado. El deviceId del topic debe coincidir con el del JSON:
 * Mosquitto (acl) solo deja publicar a cada usuario en su propio topic, así que esto ata el dato a quien lo mandó.
 */
export function decodeMqttTelemetry(topic: string, payload: string): DecodeResult {
  const t = parseTopic(topic);
  if (!t || t.kind !== "telemetry") return { ok: false, deviceId: null, error: "bad_topic" };
  const deviceId = /^[a-z0-9-]{3,32}$/.test(t.deviceId) ? t.deviceId : null;
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return { ok: false, deviceId, error: "invalid_json" };
  }
  const r = telemetrySchema.safeParse(body);
  if (!r.success) return { ok: false, deviceId, error: "validation", issues: r.error.issues };
  if (r.data.deviceId !== t.deviceId) return { ok: false, deviceId, error: "device_mismatch" };
  return { ok: true, data: r.data };
}

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
