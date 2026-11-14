/**
 * Nombre del producto. El equipo aún decide entre AURA y SpatialCare (sección 9 del documento):
 * se cambia aquí y en vite.config.ts (manifest de la PWA).
 */
export const APP_NAME = "AURA";
export const APP_TAGLINE = "Astronaut Health Monitor";

const params = new URLSearchParams(location.search);
const stored = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export const DEFAULT_API: string =
  import.meta.env.VITE_API_URL ?? `${location.protocol}//${location.hostname}:3000`;

/** Servidor de la Nave. Se puede cambiar desde el preflight o con ?api=http://192.168.137.1:3000 */
export const initialApiUrl = (): string => params.get("api") ?? stored("aura.api") ?? DEFAULT_API;

/** ?demo o VITE_STANDALONE=1: no busca servidor, corre el simulador y las reglas en el navegador. */
export const FORCE_STANDALONE = params.has("demo") || import.meta.env.VITE_STANDALONE === "1";

/** Solo en modo demo sin servidor: retraso de la vista Tierra (?delay=15) y velocidad de las reglas (?scale=1). */
export const LOCAL_GROUND_DELAY_SEC = Number(params.get("delay") ?? 60);
export const LOCAL_RULE_TIME_SCALE = Number(params.get("scale") ?? 0.1);

export const SIM_DEVICE_ID = "sim-01";
