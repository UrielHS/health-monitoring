import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Lista separada por comas de API keys válidas para dispositivos y simulador. */
  DEVICE_API_KEYS: z.string().default("dev-key"),
  /** Retraso con el que la vista Tierra recibe los eventos (segundos). */
  GROUND_DELAY_SEC: z.coerce.number().min(0).default(60),
  /** Segundos sin paquetes antes de marcar el nodo como "sin señal". */
  OFFLINE_AFTER_SEC: z.coerce.number().min(1).default(10),
  /** Multiplica las duraciones mínimas de las reglas. 0.1 = demo 10 veces más rápida. */
  RULE_TIME_SCALE: z.coerce.number().positive().default(1),
  /** Lecturas en reposo usadas para calcular el pulso base personal. */
  BASELINE_SAMPLES: z.coerce.number().int().min(5).default(30),
  CORS_ORIGIN: z.string().default("*"),
  /** Permite lanzar escenarios simulados desde la app (POST /api/sim/:escenario). */
  SIM_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export const env = envSchema.parse(process.env);
export const deviceKeys = new Set(
  env.DEVICE_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean),
);
