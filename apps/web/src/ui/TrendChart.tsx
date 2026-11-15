import { useMemo, useRef, useState } from "react";
import { clock } from "./format";

export type TrendMark = { t: number; level: "danger" | "caution"; title: string };

interface Props {
  label: string;
  unit: string;
  points: { t: number; v: number | null }[];
  /** Ventana de tiempo que se dibuja [inicio, fin] en epoch ms. */
  window: [number, number];
  /** Rango mínimo del eje; se amplía si los datos se salen. */
  domain: [number, number];
  /** Umbral de peligro de la regla: línea punteada con su valor. */
  threshold?: number;
  marks: TrendMark[];
  /** Solo la última gráfica muestra las horas del eje. */
  showTime?: boolean;
  digits?: number;
}

const W = 324;
const H = 46;
const PAD = 5;

/**
 * Gráfica de tendencia para la vista Tierra: una medida por gráfica (nunca dos ejes),
 * línea en el color de la vista, y las alertas marcadas con el color de su nivel.
 */
export function TrendChart({ label, unit, points, window: [t0, t1], domain, threshold, marks, showTime, digits = 0 }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => points.filter((p) => p.t >= t0 && p.t <= t1), [points, t0, t1]);
  const values = data.map((p) => p.v).filter((v): v is number => v != null);
  const lo = Math.min(domain[0], ...values);
  const hi = Math.max(domain[1], ...values);
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => PAD + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (H - 2 * PAD);

  // Los huecos (lectura no confiable o más de 8 s sin paquete) cortan la línea.
  const path = useMemo(() => {
    let d = "";
    let prev: number | null = null;
    for (const p of data) {
      if (p.v == null) {
        prev = null;
        continue;
      }
      d += `${prev != null && p.t - prev < 8000 ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
      prev = p.t;
    }
    return d;
  }, [data, lo, hi, t0, t1]);

  const last = [...data].reverse().find((p) => p.v != null);
  const shown = hover != null ? data[hover] : last;
  const shownMarks = marks.filter((m) => m.t >= t0 && m.t <= t1);
  const near = hover != null ? shownMarks.find((m) => Math.abs(m.t - data[hover].t) < 4000) : undefined;

  const onMove = (e: React.PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !data.length) return;
    const t = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(data[i].t - t) < Math.abs(data[best].t - t)) best = i;
    setHover(best);
  };

  return (
    <figure className="trend" aria-label={`${label}: ${last?.v != null ? `${last.v.toFixed(digits)} ${unit}` : "no data"}`}>
      <figcaption>
        <span>{label}</span>
        <span className="trend-value">
          {hover != null && shown && <small>{clock(shown.t)} · </small>}
          {shown?.v != null ? shown.v.toFixed(digits) : "—"} <small>{unit}</small>
        </span>
      </figcaption>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <line className="trend-base" x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} />
        {threshold != null && threshold >= lo && threshold <= hi && (
          <>
            <text className="trend-threshold-label" x={0} y={y(threshold) + 3}>
              {threshold}
            </text>
            <line className="trend-threshold" x1={20} x2={W} y1={y(threshold)} y2={y(threshold)} />
          </>
        )}
        {shownMarks.map((m) => (
          <g key={`${m.t}${m.title}`} className={`trend-mark ${m.level}`}>
            <line x1={x(m.t)} x2={x(m.t)} y1={0} y2={H} />
            <circle cx={x(m.t)} cy={4} r={3} />
          </g>
        ))}
        <path className="trend-line" d={path} vectorEffect="non-scaling-stroke" />
        {hover != null && shown && (
          <>
            <line className="trend-cross" x1={x(shown.t)} x2={x(shown.t)} y1={0} y2={H} />
            {shown.v != null && <circle className="trend-dot" cx={x(shown.t)} cy={y(shown.v)} r={3.5} />}
          </>
        )}
      </svg>
      {near && <p className="trend-note">{near.title}</p>}
      {showTime && !near && (
        <p className="trend-time">
          <span>{clock(t0)}</span>
          <span>{data.length ? clock(t1) : "no data yet"}</span>
        </p>
      )}
    </figure>
  );
}
