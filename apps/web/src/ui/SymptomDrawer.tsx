import { useState } from "react";
import { SYMPTOMS } from "@/model/copy";
import type { SymptomInput } from "@/data/backend";

interface Props {
  deviceId: string | null;
  onClose: () => void;
  onSubmit: (s: SymptomInput) => Promise<void>;
}

/** Registro manual de síntomas (RF-18). El astronauta decide si lo comparte con Tierra. */
export function SymptomDrawer({ deviceId, onClose, onSubmit }: Props) {
  const [type, setType] = useState<string>("dolor_cabeza");
  const [intensity, setIntensity] = useState(3);
  const [note, setNote] = useState("");
  const [share, setShare] = useState(true);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const submit = async () => {
    if (!deviceId) return;
    setState("saving");
    try {
      await onSubmit({ deviceId, type, intensity, note: note.trim() || undefined, shareWithGround: share });
      setState("saved");
      setTimeout(onClose, 900);
    } catch {
      setState("error");
    }
  };

  return (
    <aside className="side" aria-labelledby="sym-title">
      <div className="side-head">
        <div>
          <p className="eyebrow">Symptom log</p>
          <h1 id="sym-title">How do you feel?</h1>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <svg aria-hidden width="18" height="18" viewBox="0 0 18 18">
            <path d="M3 3 L15 15 M15 3 L3 15" stroke="currentColor" strokeWidth="1.6" fill="none" />
          </svg>
        </button>
      </div>
      <fieldset>
        <legend>What is it?</legend>
        <div className="chips">
          {SYMPTOMS.map(([id, label]) => (
            <button key={id} type="button" className={`chip ${type === id ? "on" : ""}`} aria-pressed={type === id} onClick={() => setType(id)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>How strong? 1 mild · 5 severe</legend>
        <div className="scale">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={intensity === n ? "on" : ""} aria-pressed={intensity === n} onClick={() => setIntensity(n)}>
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="sym-note" className="field-label">
          Note (optional)
        </label>
        <input id="sym-note" className="input" type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <label className="check">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        Share with the ground medical team
      </label>
      <p className="hint">
        Saved on the ship right away. {share ? "Ground sees it with the usual delay, next to your pulse and SpO₂ at that moment." : "Not shared: it stays on the ship."}
      </p>
      {!deviceId && <p className="hint">No wristband yet: connect it to log symptoms.</p>}
      {state === "error" && (
        <p className="hint" role="alert" style={{ color: "var(--danger)" }}>
          Could not save. Check the ship server and try again.
        </p>
      )}
      <button type="button" className="btn primary submit" disabled={!deviceId || state === "saving" || state === "saved"} onClick={submit}>
        {state === "saved" ? "Logged ✓" : state === "saving" ? "Saving…" : "Log symptom"}
      </button>
    </aside>
  );
}
