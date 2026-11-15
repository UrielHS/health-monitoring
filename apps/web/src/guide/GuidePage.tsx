import { useEffect, useState, type ReactNode } from "react";
import { SCENARIOS } from "@astro/shared";
import { APP_NAME, APP_TAGLINE } from "@/config";
import { useMission } from "@/data/mission";
import { ZONES } from "@/model/copy";
import { SCENARIO_INFO } from "@/model/scenarios";
import type { ZoneId } from "@/model/types";
import markers from "./markers.json";

// Guía de usuario (#guide). Las capturas salen de la app real con datos simulados
// en modo demo (?demo&notour); markers.json guarda dónde cae cada número sobre cada captura.

type Marker = { x: number; y: number };
type Note = { key: string; title: string; body: ReactNode };

const SECTIONS = [
  ["start", "Start in 30 seconds"],
  ["screen", "The astronaut screen"],
  ["status", "Status colors"],
  ["panels", "The five panels"],
  ["scenarios", "Scenarios"],
  ["ground", "Ground medical view"],
  ["preflight", "Sensor check"],
  ["more", "Shortcuts and honesty"],
] as const;

function Shot({ src, alt, notes, points }: { src: string; alt: string; notes?: Note[]; points?: Record<string, Marker> }) {
  const [hover, setHover] = useState<string | null>(null);
  const placed = notes?.filter((n) => points?.[n.key]) ?? [];
  return (
    <figure className="g-shot">
      <div className="g-shot-frame">
        <img src={src} alt={alt} loading="lazy" width={1440} height={900} />
        {placed.map((n, i) => (
          <span
            key={n.key}
            className={`g-pin ${hover === n.key ? "on" : ""}`}
            style={{ left: `${points![n.key].x}%`, top: `${points![n.key].y}%` }}
            onMouseEnter={() => setHover(n.key)}
            onMouseLeave={() => setHover(null)}
            aria-hidden
          >
            {i + 1}
          </span>
        ))}
      </div>
      {placed.length > 0 && (
        <ol className="g-legend">
          {placed.map((n) => (
            <li key={n.key} className={hover === n.key ? "on" : ""} onMouseEnter={() => setHover(n.key)} onMouseLeave={() => setHover(null)}>
              <b>{n.title}</b>
              <span>{n.body}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

const SCREEN_NOTES: Note[] = [
  { key: "status", title: "Overall status", body: "One word for the crew member, with a color and a dot. Read it first." },
  { key: "views", title: "Views", body: "Astronaut (this screen), Ground medical (the flight surgeon on Earth) and this Guide." },
  { key: "mission", title: "Mission context", body: "Who is monitored, mission elapsed time (MET) and the delay to Earth. Fictional in the demo." },
  { key: "panels-left", title: "Mind, blood oxygen, cabin air", body: "Reading, why it matters in space, sensor and NASA hazard. The line points to the body." },
  { key: "body", title: "3D body", body: "Each zone takes the color of its panel. The heart beats at the measured pulse; drag to rotate." },
  { key: "panels-right", title: "Heart and body", body: "Pulse and motion. Exercise is recognized and does not raise an alert." },
  { key: "narrator", title: "What is happening", body: "Only with simulated data: what the scenario simulates, what AURA detects and what to look for." },
  { key: "sensor-check", title: "Sensor check", body: "Goes back to the preflight screen where each sensor is checked." },
  { key: "scenarios", title: "Try a scenario", body: "Eight situations that cannot be produced safely on Earth. They go through the same rules as the real wristband." },
  { key: "feel", title: "How do you feel?", body: "Log a symptom from 1 to 5 and choose whether to share it with the ground team." },
];

const GROUND_NOTES: Note[] = [
  { key: "delay", title: "Delay banner", body: "Everything here arrives late on purpose: 60 s on the demo server (15 s in this screenshot), up to 20 min on a Mars mission." },
  { key: "panels-left", title: "Read-only panels", body: "In lilac. Instead of “Acknowledge” they say what the astronaut was told and when they acknowledged it." },
  { key: "vital", title: "Heart and body", body: "Pulse and motion as last received." },
  { key: "trends", title: "Trends", body: "Pulse, blood oxygen and CO index for the last 5 minutes received. Colored ticks mark alerts; the dotted line is the danger threshold. Hover to read a value." },
  { key: "log", title: "Event log", body: "What the crew saw: each alert, acknowledgment and shared symptom with the time it happened on board and the time it reached Earth." },
  { key: "export", title: "Export report", body: "Downloads the event log as a text file for the medical record." },
];

const PREFLIGHT_NOTES: Note[] = [
  { key: "conn", title: "Connection", body: "Server reachable, wristband found and packets arriving every 2 s." },
  { key: "sens", title: "Sensors", body: "Each sensor turns green when its reading is trustworthy. The CO sensor needs 2–3 minutes to warm up." },
  { key: "explore", title: "Explore with simulated data", body: "No wristband needed: a fictional crew member and the scenario buttons." },
  { key: "source", title: "Data source", body: "Real wristband or simulation." },
  { key: "start", title: "Start mission", body: "Unlocks when every sensor is green." },
];

const LEVELS = [
  ["ok", "Nominal", "Everything within range. Panels in blue."],
  ["caution", "Caution", "Something needs attention soon. Only its panel turns amber, with what happened and what to do. No banner."],
  ["danger", "Warning", "Act now. Red banner at the top with the action, the panel glows red and the body zone pulses. Press Acknowledge once handled."],
  ["off", "No signal", "Nothing received for 10 s. Everything turns grey and the figure fades: silence is never shown as “all good”."],
  ["off", "Check sensor", "A reading that cannot be trusted (finger off the sensor, too much movement). AURA hides the number instead of showing a wrong one."],
] as const;

const PANEL_RULES: Record<ZoneId, { measures: string; caution: string; danger: string }> = {
  head: {
    measures: "Pulse compared with this person's own resting baseline, plus motion.",
    caution: "Pulse 25 % above the personal baseline while resting, for 5 minutes.",
    danger: "No danger level: stress is a caution that asks how you feel.",
  },
  lungs: {
    measures: "Blood oxygen (SpO₂) from the fingertip sensor.",
    caution: "94 % or less for 30 s.",
    danger: "90 % or less for 10 s, or low oxygen while cabin pressure drops. Marked “not reliable” when CO is present.",
  },
  cabin: {
    measures: "Carbon monoxide index, cabin pressure, temperature and humidity.",
    caution: "CO index 9+, pressure down 1 kPa in 5 min, 18–27 °C or 25–70 % humidity exceeded.",
    danger: "CO index 35+, pressure below 95 kPa or down 3 kPa, 15–32 °C or 15–80 % humidity exceeded.",
  },
  heart: {
    measures: "Pulse (BPM) from the fingertip sensor.",
    caution: "Above 100 or below 50 at rest for 2 minutes.",
    danger: "Above 130 (185 while exercising) or below 40 for 30 s.",
  },
  body: {
    measures: "Motion and impacts from the accelerometer and gyroscope.",
    caution: "A hit stronger than 3 g: “Are you OK?”.",
    danger: "No answer 30 s after the hit, or “Call the crew”.",
  },
};

const ORDER: ZoneId[] = ["head", "lungs", "cabin", "heart", "body"];

export function GuidePage() {
  const m = useMission();
  const [active, setActive] = useState<string>("start");

  // Marca en el índice la sección que se está leyendo.
  useEffect(() => {
    const root = document.querySelector(".guide");
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { root, rootMargin: "-20% 0px -70% 0px" },
    );
    for (const [id] of SECTIONS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const explore = () => {
    m.exploreSim();
    location.hash = "#ship";
  };

  return (
    <div className="guide">
      <header className="g-top">
        <p className="brand">
          {APP_NAME} <span>· {APP_TAGLINE}</span>
        </p>
        <nav className="tabs" aria-label="Views">
          <a href="#ship" className="tab">
            Astronaut
          </a>
          <a href="#ground" className="tab">
            Ground medical
          </a>
          <a href="#guide" className="tab on">
            Guide
          </a>
        </nav>
        <button type="button" className="btn go small" onClick={explore}>
          Try it with simulated data →
        </button>
      </header>

      <div className="g-layout">
        <aside className="g-toc" aria-label="Contents">
          <p className="eyebrow">User guide</p>
          <ol>
            {SECTIONS.map(([id, label], i) => (
              <li key={id}>
                <button type="button" className={active === id ? "on" : ""} onClick={() => go(id)}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {label}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <main className="g-main">
          <section className="g-hero">
            <p className="eyebrow">User guide</p>
            <h1>What every part of {APP_NAME} means, and what it does when it detects each situation</h1>
            <p>
              {APP_NAME} watches an astronaut's body and the air around them through a wristband, and tells them in plain
              language what happened, why it matters and what to do, without waiting for Earth. A ground medical view
              receives the same data with a delay.
            </p>
            <p className="g-disclaimer">
              Prototype, not a medical device. Thresholds come from public references and are not clinical criteria. In the
              demo the crew member and the mission are fictional and every simulated reading is labeled SIMULATED.
            </p>
          </section>

          <section id="start" className="g-section">
            <h2>
              <span>01</span> Start in 30 seconds
            </h2>
            <ol className="g-steps">
              <li>
                <b>Open the app.</b> It starts on the sensor check. If no wristband is connected, that is expected.
              </li>
              <li>
                <b>Press “Explore with simulated data”.</b> A fictional crew member appears with normal readings, and a short
                tour points at each part of the screen.
              </li>
              <li>
                <b>Pick a scenario at the bottom.</b> Start with <i>CO leak</i>: it shows the idea behind {APP_NAME} best.
                The card above the buttons explains what to look for.
              </li>
              <li>
                <b>Open “Ground medical”.</b> The same events arrive 60 s later, as the flight surgeon on Earth would see
                them.
              </li>
            </ol>
            <button type="button" className="btn go" onClick={explore}>
              Explore with simulated data →
            </button>
          </section>

          <section id="screen" className="g-section">
            <h2>
              <span>02</span> The astronaut screen
            </h2>
            <p className="g-lead">
              Built to be understood in three seconds by someone who is busy and not a doctor. Numbers on the screenshot
              match the list below; hover a number to find it.
            </p>
            <Shot src="/guide/overview.jpg" alt="Astronaut screen with simulated data" notes={SCREEN_NOTES} points={markers.overview} />
          </section>

          <section id="status" className="g-section">
            <h2>
              <span>03</span> Status colors
            </h2>
            <p className="g-lead">Color always comes with a word and a dot, so it still reads for color-blind users.</p>
            <ul className="g-levels">
              {LEVELS.map(([tone, word, text]) => (
                <li key={word}>
                  <span className={`g-level ${tone}`}>
                    <i aria-hidden />
                    {word}
                  </span>
                  <p>{text}</p>
                </li>
              ))}
            </ul>
          </section>

          <section id="panels" className="g-section">
            <h2>
              <span>04</span> The five panels
            </h2>
            <p className="g-lead">
              Each panel covers one of NASA's spaceflight hazards and says what changes it from blue to amber or red.
              Durations are shortened ten times in the demo so you do not have to wait.
            </p>
            <div className="g-panels">
              {ORDER.map((z) => (
                <article key={z} className="g-panel">
                  <header>
                    <h3>{ZONES[z].title}</h3>
                    <span>{ZONES[z].hazard}</span>
                  </header>
                  <p>{PANEL_RULES[z].measures}</p>
                  <dl>
                    <dt className="caution">Caution</dt>
                    <dd>{PANEL_RULES[z].caution}</dd>
                    <dt className="danger">Warning</dt>
                    <dd>{PANEL_RULES[z].danger}</dd>
                  </dl>
                  <footer>Sensor: {ZONES[z].sensor}</footer>
                </article>
              ))}
            </div>
          </section>

          <section id="scenarios" className="g-section">
            <h2>
              <span>05</span> Scenarios
            </h2>
            <p className="g-lead">
              The buttons at the bottom of the astronaut screen. Each one feeds simulated readings through the same server
              rules as the real wristband. Keys 1 to 8 launch them in order.
            </p>
            <div className="g-scenarios">
              {SCENARIOS.map((s, i) => {
                const info = SCENARIO_INFO[s];
                return (
                  <article key={s} className="g-scenario">
                    <img src={`/guide/sc-${s}.jpg`} alt={`${info.label} scenario`} loading="lazy" width={1440} height={900} />
                    <div>
                      <p className="eyebrow">
                        Key {i + 1} · {info.wait}
                      </p>
                      <h3>{info.label}</h3>
                      <dl>
                        <dt>What we simulate</dt>
                        <dd>{info.simulates}</dd>
                        <dt>What {APP_NAME} detects</dt>
                        <dd>{info.detects}</dd>
                        {info.told && (
                          <>
                            <dt>What the astronaut is told</dt>
                            <dd>“{info.told}”</dd>
                          </>
                        )}
                        <dt>Look for</dt>
                        <dd>
                          <ul>
                            {info.lookFor.map((l) => (
                              <li key={l}>{l}</li>
                            ))}
                          </ul>
                        </dd>
                        <dt>Why it matters</dt>
                        <dd>{info.realWorld}</dd>
                      </dl>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="g-also">
              <div>
                <h3>Symptom log</h3>
                <p>
                  “How do you feel?” opens a panel to log headache, dizziness, nausea, fatigue, mood or sleep from 1 to 5,
                  with a note. The astronaut decides whether the ground team sees it; life-threatening alerts are always
                  shared.
                </p>
              </div>
              <img src="/guide/symptoms.jpg" alt="Symptom log" loading="lazy" width={1440} height={900} />
            </div>
          </section>

          <section id="ground" className="g-section">
            <h2>
              <span>06</span> Ground medical view
            </h2>
            <p className="g-lead">
              What a flight surgeon on Earth receives. It is read-only and deliberately late: the point is that the
              astronaut already acted on board.
            </p>
            <Shot src="/guide/ground.jpg" alt="Ground medical view" notes={GROUND_NOTES} points={markers.ground} />
          </section>

          <section id="preflight" className="g-section">
            <h2>
              <span>07</span> Sensor check
            </h2>
            <p className="g-lead">
              The first screen. With the real wristband it confirms every sensor is reading before the mission starts. To
              come back later, use “Sensor check” at the bottom left of the astronaut screen.
            </p>
            <Shot src="/guide/preflight.jpg" alt="Sensor check screen" notes={PREFLIGHT_NOTES} points={markers.preflight} />
          </section>

          <section id="more" className="g-section">
            <h2>
              <span>08</span> Shortcuts and honesty
            </h2>
            <div className="g-two">
              <div>
                <h3>Keyboard</h3>
                <ul className="g-keys">
                  <li>
                    <kbd>1</kbd>–<kbd>8</kbd> Launch a scenario
                  </li>
                  <li>
                    <kbd>S</kbd> Show or hide the scenario buttons
                  </li>
                  <li>
                    <kbd>Esc</kbd> Close the symptom log or the tour
                  </li>
                  <li>
                    <kbd>←</kbd> <kbd>→</kbd> Move through the tour
                  </li>
                </ul>
                <h3>Bottom bar</h3>
                <ul className="g-plain">
                  <li>
                    <b>Sensor check</b> goes back to the first screen.
                  </li>
                  <li>
                    <b>Try a scenario</b> launches a simulated situation.
                  </li>
                  <li>
                    <b>Use real wristband</b> stops the simulation and follows the physical device.
                  </li>
                  <li>
                    <b>How do you feel?</b> opens the symptom log.
                  </li>
                </ul>
              </div>
              <div>
                <h3>What this prototype is not</h3>
                <ul className="g-plain">
                  <li>It does not diagnose. It detects signals and suggests general actions.</li>
                  <li>Thresholds are not clinical. They are configurable and should be reviewed by a physician.</li>
                  <li>The CO value is a relative index from 0 to 40, not ppm: the sensor is not calibrated.</li>
                  <li>Critical scenarios can only be simulated. Simulated data is always labeled SIMULATED.</li>
                  <li>The link to Earth is a configurable delay, not a real space link.</li>
                </ul>
              </div>
            </div>
          </section>

          <footer className="g-foot">
            <button type="button" className="btn go" onClick={explore}>
              Explore with simulated data →
            </button>
            <a className="link" href="#ship">
              Back to the app
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
