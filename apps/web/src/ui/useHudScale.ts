import { useEffect, useState } from "react";

const DESIGN_W = 1440;
const DESIGN_H = 900;

/**
 * El diseño está dibujado a 1440×900. En escritorio la capa de interfaz se escala para que
 * quepa igual en una laptop de 1366×768 o en un proyector; en teléfono se apila sin escala.
 */
export function useHudScale() {
  const read = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const mobile = w < 860;
    const k = mobile ? 1 : Math.min(1.5, Math.max(0.5, Math.min(w / DESIGN_W, h / DESIGN_H)));
    return { mobile, k, style: mobile ? undefined : { width: w / k, height: h / k, transform: `scale(${k})` } };
  };
  const [scale, setScale] = useState(read);
  useEffect(() => {
    const on = () => setScale(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return scale;
}
