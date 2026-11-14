// Textos de la interfaz (UI/UX). El servidor manda el mensaje largo de cada alerta;
// aquí vive la versión corta que se lee en 3 segundos (RNF-03) y a qué zona del cuerpo pertenece.

import type { ZoneId } from "./types";

export interface ZoneInfo {
  title: string;
  /** Por qué importa en una misión (se muestra cuando todo está bien). */
  why: string;
  /** Riesgo de NASA HRP al que responde: https://www.nasa.gov/hrp/hazards/ */
  hazard: string;
  sensor: string;
}

export const ZONES: Record<ZoneId, ZoneInfo> = {
  head: {
    title: "Mind",
    why: "Months of isolation wear on mood, sleep and focus.",
    hazard: "Isolation & confinement",
    sensor: "Pulse + motion",
  },
  lungs: {
    title: "Blood oxygen",
    why: "A leak lowers pressure, so less oxygen reaches the blood. CO fools the oximeter.",
    hazard: "Hostile closed environment",
    sensor: "MAX30100",
  },
  cabin: {
    title: "Cabin air",
    why: "Air does not mix in microgravity. CO has no color and no smell.",
    hazard: "Hostile closed environment",
    sensor: "AHT20 · BMP280 · MQ-7",
  },
  heart: {
    title: "Heart",
    why: "Without gravity, fluids shift toward the head and the heart adapts.",
    hazard: "Gravity fields",
    sensor: "MAX30100",
  },
  body: {
    title: "Body",
    why: "In microgravity nobody falls, but people hit hatches and racks.",
    hazard: "Gravity fields",
    sensor: "MPU6050",
  },
};

export interface RuleCopy {
  zones: ZoneId[];
  /** Acción en pocas palabras, para el aviso central y la línea "→" del panel. */
  short: string;
  /** Qué hace el médico en Tierra con esta alerta. */
  ground: string;
}

export const RULE_COPY: Record<string, RuleCopy> = {
  spo2_critical: { zones: ["lungs"], short: "Mask on. Tell the crew.", ground: "Follow up with the crew." },
  spo2_warning: { zones: ["lungs"], short: "Rest. Breathe slowly.", ground: "Watch the SpO₂ trend." },
  hr_critical: { zones: ["heart"], short: "Stop. Call the medical officer.", ground: "Contact the crew medical officer." },
  hr_rest_warning: { zones: ["heart"], short: "Stay still a few minutes.", ground: "Watch the pulse trend." },
  acute_stress: { zones: ["head"], short: "Two minutes of slow breathing.", ground: "Check in at the next contact." },
  co_critical: { zones: ["cabin"], short: "Mask on. Tell the crew.", ground: "Follow up with the crew." },
  co_warning: { zones: ["cabin"], short: "Check for overheating equipment.", ground: "Watch the CO trend." },
  pressure_spo2: { zones: ["lungs", "cabin"], short: "Mask on. Go to the safe module.", ground: "Follow up with the crew." },
  pressure_critical: { zones: ["cabin"], short: "Go to the safe module.", ground: "Follow up with the crew." },
  pressure_warning: { zones: ["cabin"], short: "Tell the crew. Watch for a leak.", ground: "Watch the pressure trend." },
  cabin_temp_critical: { zones: ["cabin"], short: "Tell the crew. Check thermal control.", ground: "Check thermal control with the crew." },
  cabin_temp_warning: { zones: ["cabin"], short: "Drink water. Report it if it stays.", ground: "Watch the temperature trend." },
  humidity_critical: { zones: ["cabin"], short: "Tell the crew. Check humidity control.", ground: "Check humidity control with the crew." },
  humidity_warning: { zones: ["cabin"], short: "Report it if it stays.", ground: "Watch the humidity trend." },
  impact: { zones: ["body"], short: "Tap “I’m OK”.", ground: "Wait for the astronaut's answer." },
  impact_no_response: { zones: ["body"], short: "Crew alerted. Help is coming.", ground: "Call the crew now." },
  ppg_noisy: { zones: ["heart", "lungs"], short: "Re-seat the sensor. Hold still.", ground: "Readings unreliable for now." },
};

export const SYMPTOMS = [
  ["dolor_cabeza", "Headache"],
  ["mareo", "Dizziness"],
  ["nausea", "Nausea"],
  ["fatiga", "Fatigue"],
  ["animo", "Mood"],
  ["sueno", "Sleep"],
  ["otro", "Other"],
] as const;

export const symptomLabel = (type: string) =>
  (SYMPTOMS.find(([id]) => id === type)?.[1] ?? type).toLowerCase();

export const SCENARIO_LABEL: Record<string, string> = {
  normal: "Normal",
  exercise: "Exercise",
  stress: "Stress",
  co: "CO leak",
  hypoxia: "Hypoxia",
  depressurization: "Depressurization",
  impact: "Impact",
  offline: "Offline",
};

export const LEVEL_WORD = {
  nominal: "Nominal",
  unreliable: "Check sensor",
  caution: "Caution",
  danger: "Warning",
  offline: "No signal",
} as const;

/** Palabra de estado dentro de un panel. */
export const PANEL_WORD = { ...LEVEL_WORD, nominal: "OK" } as const;
