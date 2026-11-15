import { APP_NAME, APP_TAGLINE } from "@/config";
import { useMission } from "@/data/mission";

/** Logo de AURA: siempre regresa al inicio (la revisión de sensores). */
export function Brand() {
  const m = useMission();
  return (
    <a
      href="#ship"
      className="brand"
      title="Back to the sensor check"
      onClick={() => {
        m.backToPreflight();
        location.hash = "#ship";
      }}
    >
      <img src="/brand/aura-wordmark.png" alt={APP_NAME} width={140} height={26} />
      <span>{APP_TAGLINE}</span>
    </a>
  );
}
