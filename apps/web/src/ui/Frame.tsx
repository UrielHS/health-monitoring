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

export function Header({ level, view, simulated, meta }: { level: Level; view: "ship" | "ground"; simulated?: boolean; meta: ReactNode }) {
  return (
    <header className="bar top">
      <div
        className={`status ${level === "danger" ? "blink" : ""}`}
        style={{ ["--status" as string]: STATUS_COLOR[level] }}
        role="status"
      >
        <span className="dot" aria-hidden />
        <span>{LEVEL_WORD[level]}</span>
        {simulated && <span className="badge">SIMULATED</span>}
      </div>
      <nav className="tabs" aria-label="Views">
        <a href="#ship" className={`tab ${view === "ship" ? "on" : ""}`}>
          Astronaut
        </a>
        <a href="#ground" className={`tab ${view === "ground" ? "on" : ""}`}>
          Ground medical
        </a>
      </nav>
      <p className="meta">{meta}</p>
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
