import { useEffect, useLayoutEffect, useState } from "react";

export interface TourStep {
  /** Valor de data-tour del elemento que se señala. */
  target: string;
  title: string;
  body: string;
}

/** Recorrido de la vista del astronauta. Los pasos cuyo elemento no está en pantalla se saltan. */
export const SHIP_TOUR: TourStep[] = [
  {
    target: "status",
    title: "Overall status",
    body: "One word for the crew member: Nominal, Caution, Warning or No signal. Readable in 3 seconds, and never color alone.",
  },
  {
    target: "mission",
    title: "Mission context",
    body: "Who is monitored, mission elapsed time (MET) and the delay to Earth. In this demo the crew member and the mission are fictional.",
  },
  {
    target: "panels-left",
    title: "Mind, blood oxygen and cabin air",
    body: "Each panel shows a reading, why it matters in space, the sensor and the NASA spaceflight hazard it covers. Its line points to the body.",
  },
  {
    target: "panels-right",
    title: "Heart and body",
    body: "Pulse and motion. A high pulse while moving is exercise, not an alarm. A hard hit asks “Are you OK?”.",
  },
  {
    target: "scenarios",
    title: "Try a scenario",
    body: "Situations that cannot be produced safely on Earth. Simulated data goes through the same rules as the real wristband.",
  },
  {
    target: "narrator",
    title: "What is happening",
    body: "Explains the scenario you launched, what AURA detects and what to look for on screen.",
  },
  {
    target: "feel",
    title: "How do you feel?",
    body: "The astronaut logs a symptom from 1 to 5 and decides whether the ground team can see it.",
  },
  {
    target: "views",
    title: "Ground medical view",
    body: "The same data as the flight surgeon on Earth sees it: 60 s late. The astronaut has already acted.",
  },
  {
    target: "guide",
    title: "Full guide",
    body: "Every part of the screen and every scenario explained, with screenshots.",
  },
];

type Rect = { x: number; y: number; w: number; h: number };
const PAD = 8;
const CARD_W = 340;

function find(target: string): Rect | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

/** Señala una zona a la vez, oscurece el resto y explica qué es. Flechas o Enter avanzan; Esc cierra. */
export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const available = steps.filter((s) => find(s.target));
  const step = available[Math.min(i, available.length - 1)];

  useLayoutEffect(() => {
    if (!step) return;
    document.querySelector(`[data-tour="${step.target}"]`)?.scrollIntoView({ block: "nearest" });
    const update = () => {
      setRect(find(step.target));
      setSize({ w: window.innerWidth, h: window.innerHeight });
    };
    update();
    const timer = setInterval(update, 250);
    window.addEventListener("resize", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", update);
    };
  }, [step?.target]);

  const last = i >= available.length - 1;
  const next = () => (last ? onClose() : setI((n) => n + 1));
  const back = () => setI((n) => Math.max(0, n - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!step || !rect) return null;

  // La tarjeta va debajo del elemento si cabe; si no, arriba; si tampoco, a un lado. Siempre dentro de la ventana.
  const cardH = 200;
  const gap = 14;
  const clampX = (x: number) => Math.min(Math.max(12, x), size.w - CARD_W - 12);
  const clampY = (y: number) => Math.min(Math.max(12, y), size.h - cardH - 12);
  let top: number;
  let left: number;
  if (rect.y + rect.h + gap + cardH < size.h) {
    top = rect.y + rect.h + gap;
    left = clampX(rect.x + rect.w / 2 - CARD_W / 2);
  } else if (rect.y - gap - cardH > 0) {
    top = rect.y - gap - cardH;
    left = clampX(rect.x + rect.w / 2 - CARD_W / 2);
  } else {
    top = clampY(rect.y + rect.h / 2 - cardH / 2);
    left = rect.x + rect.w + gap + CARD_W < size.w ? rect.x + rect.w + gap : clampX(rect.x - gap - CARD_W);
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <svg className="tour-shade" width={size.w} height={size.h} aria-hidden>
        <defs>
          <mask id="tour-hole">
            <rect width={size.w} height={size.h} fill="#fff" />
            <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={6} fill="#000" />
          </mask>
        </defs>
        <rect width={size.w} height={size.h} fill="rgba(3,6,13,0.72)" mask="url(#tour-hole)" />
        <rect className="tour-ring" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={6} />
      </svg>
      <div className="tour-card" style={{ top, left, width: CARD_W }}>
        <p className="eyebrow">
          Step {i + 1} of {available.length}
        </p>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="link" onClick={onClose}>
            Skip tour
          </button>
          <div>
            {i > 0 && (
              <button type="button" className="btn" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="btn primary" onClick={next} autoFocus>
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const KEY = "aura.tour";
const params = new URLSearchParams(location.search);

/** El tour se abre solo la primera vez que se entra con datos simulados. ?notour lo desactiva. */
export function useFirstTour(active: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active || params.has("notour")) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY) === "1";
    } catch {
      /* sin almacenamiento: se muestra una vez por carga */
    }
    if (seen) return;
    const timer = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(timer);
  }, [active]);
  const close = () => {
    setOpen(false);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* nada */
    }
  };
  return { open, show: () => setOpen(true), close };
}
