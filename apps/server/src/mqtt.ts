import { connect, type MqttClient } from "mqtt";
import { TOPICS, decodeMqttTelemetry, parseTopic, type Telemetry } from "@astro/shared";
import { env } from "./env.js";

/**
 * Entrada por MQTT: la pulsera publica en astro/v1/<deviceId>/telemetry y el servidor se suscribe.
 * Cada mensaje válido entra por el mismo ingestOne que HTTP y el simulador (base de datos, reglas,
 * alertas y vista Tierra). Si el broker no está, el servidor sigue funcionando y reintenta solo.
 */
export type MqttDeps = {
  ingest: (t: Telemetry) => Promise<{ duplicate: boolean }>;
  /** "online" / "offline" (este último lo publica el broker por Last Will cuando la pulsera se cae). */
  onStatus: (deviceId: string, status: string) => void;
  /** Umbrales vigentes; se publican retenidos en astro/v1/config. */
  config: () => unknown;
};

export type MqttState = {
  enabled: boolean;
  connected: boolean;
  url: string;
  lastError: string | null;
  received: number;
  rejected: number;
};

export function startMqtt(deps: MqttDeps) {
  const state: MqttState = { enabled: env.MQTT_ENABLED, connected: false, url: env.MQTT_URL, lastError: null, received: 0, rejected: 0 };
  if (!env.MQTT_ENABLED) {
    console.log("[mqtt] desactivado (MQTT_ENABLED=false): solo HTTP");
    return { state: () => ({ ...state }), stop: async () => {} };
  }

  const client: MqttClient = connect(env.MQTT_URL, {
    clientId: `aura-server-${process.pid}`,
    username: env.MQTT_USER,
    password: env.MQTT_PASS,
    reconnectPeriod: 2000,
    connectTimeout: 5000,
    clean: true,
  });

  // Mismo error cada 2 s no aporta nada: se repite como mucho cada 30 s.
  let lastLog = { msg: "", at: 0 };
  const logError = (msg: string) => {
    state.lastError = msg;
    const now = Date.now();
    if (msg !== lastLog.msg || now - lastLog.at > 30_000) {
      console.warn(`[mqtt] ${msg}`);
      lastLog = { msg, at: now };
    }
  };

  // Procesa en orden de llegada: el motor de reglas cuenta duraciones con lecturas consecutivas.
  let chain: Promise<unknown> = Promise.resolve();

  client.on("connect", () => {
    state.connected = true;
    state.lastError = null;
    console.log(`[mqtt] conectado a ${env.MQTT_URL} como ${env.MQTT_USER}`);
    client.subscribe([TOPICS.allTelemetry, TOPICS.allStatus], { qos: 1 }, (err) => {
      if (err) logError(`no pude suscribirme: ${err.message}`);
    });
    client.publish(TOPICS.config, JSON.stringify(deps.config()), { qos: 1, retain: true });
  });
  client.on("close", () => {
    if (state.connected) console.warn("[mqtt] desconectado del broker, reintentando…");
    state.connected = false;
  });
  client.on("error", (err) => {
    const code = (err as { code?: number | string }).code;
    // Códigos CONNACK: 4 = usuario/clave incorrectos, 5 = no autorizado.
    if (code === 4 || code === 5) logError(`el broker rechazó usuario/clave (${env.MQTT_USER}). Revisa MQTT_USER y MQTT_PASS.`);
    else logError(err.message);
  });

  client.on("message", (topic, payload) => {
    const t = parseTopic(topic);
    if (!t) return;
    if (t.kind === "status") return deps.onStatus(t.deviceId, payload.toString().trim());
    if (t.kind !== "telemetry") return;

    const decoded = decodeMqttTelemetry(topic, payload.toString());
    if (!decoded.ok) {
      state.rejected++;
      const issues = decoded.issues?.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`);
      console.warn(`[mqtt] RECHAZADO ${t.deviceId} ${decoded.error}${issues ? " · " + issues.join(" · ") : ""}`);
      // Con MQTT no hay respuesta HTTP: el motivo va a .../errors para que la pulsera lo vea en su serial.
      if (decoded.deviceId) {
        client.publish(TOPICS.errors(decoded.deviceId), JSON.stringify({ error: decoded.error, issues }), { qos: 0 });
      }
      return;
    }

    state.received++;
    const data = decoded.data;
    chain = chain
      .then(() => deps.ingest(data))
      .catch((e) => console.error("[mqtt] error al guardar la lectura:", e));
  });

  return {
    state: () => ({ ...state }),
    stop: () => new Promise<void>((resolve) => client.end(false, {}, () => resolve())),
  };
}
