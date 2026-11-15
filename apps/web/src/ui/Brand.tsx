import { APP_NAME, APP_TAGLINE } from "@/config";
import { useMission } from "@/data/mission";

/** Logo y nombre: siempre regresa al inicio (la revisión de sensores). */
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
      {APP_NAME} <span>· {APP_TAGLINE}</span>
    </a>
  );
}
