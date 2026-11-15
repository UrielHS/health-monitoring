import type { ReactNode } from "react";
import { LEVEL_WORD } from "@/model/copy";
import type { Level } from "@/model/types";

const STATUS_COLOR: Record<Level, string> = {
  nominal: "var(--ok)",
  unreliable: "var(--off)",
  caution: "var(--caution)",
  danger: "var(--danger)",
  offline: "var(--off)",
};

interface HeaderProps {
  level: Level;
  view: "ship" | "ground";
  simulated?: boolean;
  /** Primera línea de la derecha: quién se monitorea. */
  who: ReactNode;
  /** Segunda línea: tiempo de misión, retraso o estado del enlace. */
  detail: ReactNode;
}

export function Header({ level, view, simulated, who, detail }: HeaderProps) {
  return (
    <header className="bar top">
      <div
        className={`status ${level === "danger" ? "blink" : ""}`}
        style={{ ["--status" as string]: STATUS_COLOR[level] }}
        role="status"
        data-tour="status"
      >
        <span className="dot" aria-hidden />
        <span>{LEVEL_WORD[level]}</span>
        {simulated && <span className="badge">SIMULATED</span>}
      </div>
      <nav className="tabs" aria-label="Views">
        <a href="#ship" className={`tab ${view === "ship" ? "on" : ""}`}>
          Astronaut
        </a>
        <a href="#ground" className={`tab ${view === "ground" ? "on" : ""}`} data-tour="views">
          Ground medical
        </a>
        <a href="#guide" className="tab" data-tour="guide">
          Guide
        </a>
      </nav>
      <div className="meta mission" data-tour="mission">
        <p className="mission-who">{who}</p>
        <p>{detail}</p>
      </div>
    </header>
  );
}

export function BannerBox({ level, title, action, note, sub }: { level: Level; title: string; action: string; note?: string; sub?: boolean }) {
  return (
    <div className={`banner lvl-${level} ${sub ? "sub" : ""}`} role="alert">
      <p className="banner-title">{title}</p>
      <p className="banner-action">{action}</p>
      {note && <p className="banner-note">{note}</p>}
    </div>
  );
}
