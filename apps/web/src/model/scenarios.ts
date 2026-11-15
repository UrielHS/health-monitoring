// Qué simula cada escenario y qué debe mirar quien evalúa. Lo usan la tarjeta del
// narrador (durante la demo) y la guía de usuario (#guide). Textos en inglés (RNF-10).

import type { Scenario } from "@astro/shared";

export interface ScenarioInfo {
  label: string;
  /** Una línea para el tooltip del botón. */
  short: string;
  /** Qué se está simulando. */
  simulates: string;
  /** Qué detecta AURA. */
  detects: string;
  /** Qué se le dice al astronauta, si hay alerta. */
  told?: string;
  /** Qué mirar en pantalla. */
  lookFor: string[];
  /** Por qué importa en una misión real. */
  realWorld: string;
  /** Cuánto tarda en verse a velocidad de demo. */
  wait: string;
}

export const SCENARIO_INFO: Record<Scenario, ScenarioInfo> = {
  normal: {
    label: "Normal",
    short: "Healthy crew member at rest",
    simulates: "A healthy crew member resting in the cabin: pulse around 72, blood oxygen 97–98 %, clean air at 101.3 kPa.",
    detects: "Nothing. AURA uses these readings to learn this person's resting pulse (their personal baseline).",
    lookFor: ["All five panels stay blue and the status reads Nominal.", "Pick a scenario below to see how AURA reacts."],
    realWorld: "Most of a mission looks like this. A good monitor stays quiet until something changes.",
    wait: "Immediate",
  },
  exercise: {
    label: "Exercise",
    short: "Squats: high pulse with movement",
    simulates: "The crew member exercises: pulse climbs to about 135 while the motion sensor reports activity.",
    detects: "Exercise, not danger. Pulse and motion together tell effort apart from a heart problem.",
    lookFor: ["Heart shows a high pulse with “Exercise detected · no alert”.", "Body reads “active” and the figure does squats. No banner."],
    realWorld: "Astronauts exercise about two hours a day against bone and muscle loss. A monitor that alarms at every workout gets ignored.",
    wait: "About 20 s",
  },
  stress: {
    label: "Stress",
    short: "High pulse while resting",
    simulates: "Pulse rises to about 105 while the crew member is not moving.",
    detects: "Possible acute stress: pulse at least 25 % above the person's own baseline while at rest. A caution, not an emergency.",
    told: "Two minutes of slow breathing, then log how you feel.",
    lookFor: ["Mind and Heart turn amber. Caution never shows the red banner.", "Mind shows how far the pulse is above the personal baseline."],
    realWorld: "Months of isolation wear on crews. AURA asks before concluding, because caffeine, fever or poor sleep look the same.",
    wait: "About 30 s",
  },
  co: {
    label: "CO leak",
    short: "Carbon monoxide leak in the cabin",
    simulates: "The carbon monoxide index rises from 1 to about 40 while the oximeter keeps reading 98 %.",
    detects: "Carbon monoxide on its own, without waiting for blood oxygen to drop. Danger from index 35.",
    told: "Mask on. Tell the crew.",
    lookFor: ["Red banner and Cabin air in red.", "Blood oxygen turns red with “Reading not reliable”: the oximeter cannot see CO."],
    realWorld: "CO has no color or smell, and an oximeter reads CO-bound blood as oxygenated. A vitals-only monitor would say all is fine.",
    wait: "About 25 s",
  },
  hypoxia: {
    label: "Hypoxia",
    short: "Blood oxygen falls",
    simulates: "Blood oxygen drops from 97 % toward 86 % and pulse rises.",
    detects: "Low blood oxygen: caution at 94 % or less, danger at 90 % or less.",
    told: "Mask on. Tell the crew.",
    lookFor: ["Blood oxygen turns amber, then red with the banner.", "Open Ground medical to see the same alert arrive late."],
    realWorld: "Too little oxygen impairs judgment before the person notices it.",
    wait: "About 25 s",
  },
  depressurization: {
    label: "Depressurization",
    short: "Cabin pressure drops (air leak)",
    simulates: "Cabin pressure falls about 5 kPa and blood oxygen follows.",
    detects: "A combined rule: falling pressure and low blood oxygen at the same time mean danger.",
    told: "Mask on. Go to the safe module.",
    lookFor: ["Cabin air and Blood oxygen turn red together.", "The ring under the figure shows the cabin readings."],
    realWorld: "A leak lowers pressure, so less oxygen reaches the lungs. Crossing body and cabin data catches it early.",
    wait: "About 25 s",
  },
  impact: {
    label: "Impact",
    short: "Hard hit, then no movement",
    simulates: "A 6.5 g hit, then the crew member does not move.",
    detects: "An impact. AURA asks “Are you OK?” and counts 30 s; with no answer it alerts the crew.",
    told: "Tap “I'm OK” or “Call the crew”.",
    lookFor: ["The “Are you OK?” dialog with its countdown.", "Wait 30 s to see it escalate, or tap “Call the crew”."],
    realWorld: "In microgravity nobody falls, but people hit hatches and racks.",
    wait: "Immediate",
  },
  offline: {
    label: "Offline",
    short: "Wristband stops sending",
    simulates: "The wristband stops sending data: dead battery, out of range or broken.",
    detects: "No signal after 10 s. Silence is never shown as “all good”.",
    told: "Check the wristband. Its own buzzer and screen still alarm without the network.",
    lookFor: ["Everything turns grey and the figure fades.", "Pick any other scenario to bring the wristband back."],
    realWorld: "A monitor that keeps showing the last good number after the sensor dies is worse than no monitor.",
    wait: "10 s",
  },
};
