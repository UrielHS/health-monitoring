import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Líneas que unen cada panel con su zona del cuerpo. Los puntos 3D (anchors) viven en la
// escena; los paneles y las líneas son DOM/SVG normales. En cada cuadro se proyecta el punto
// a la pantalla y se mueve la línea, sin pasar por React.
export const anchors = new Map<string, THREE.Object3D>();
const panels = new Map<string, HTMLElement>();
const lines = new Map<string, SVGGElement>();

const register =
  <T>(map: Map<string, T>) =>
  (id: string) =>
  (el: T | null) => {
    if (el) map.set(id, el);
    else map.delete(id);
  };

export const anchorRef = register<THREE.Object3D>(anchors);
export const panelRef = register<HTMLElement>(panels);
export const lineRef = register<SVGGElement>(lines);

const v = new THREE.Vector3();
const HEAD = 28; // altura del encabezado del panel, de donde sale la línea
const STUB = 28;

export function LeaderProjector() {
  useFrame(({ camera, gl }) => {
    const canvas = gl.domElement.getBoundingClientRect();
    for (const [id, g] of lines) {
      const panel = panels.get(id);
      const anchor = anchors.get(id);
      if (!panel || !anchor) {
        g.style.display = "none";
        continue;
      }
      anchor.getWorldPosition(v);
      v.project(camera);
      const ax = canvas.left + (v.x * 0.5 + 0.5) * canvas.width;
      const ay = canvas.top + (-v.y * 0.5 + 0.5) * canvas.height;
      const rect = panel.getBoundingClientRect();
      const k = rect.width / (panel.offsetWidth || rect.width);
      const fromRight = rect.left + rect.width / 2 < ax;
      const sx = fromRight ? rect.right : rect.left;
      const sy = rect.top + HEAD * k;
      const ex = sx + (fromRight ? STUB : -STUB) * k;
      g.style.display = v.z > 1 ? "none" : "";
      const line = g.firstElementChild as SVGPolylineElement | null;
      line?.setAttribute("points", `${sx.toFixed(1)},${sy.toFixed(1)} ${ex.toFixed(1)},${sy.toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)}`);
      for (const c of g.querySelectorAll("circle")) {
        c.setAttribute("cx", ax.toFixed(1));
        c.setAttribute("cy", ay.toFixed(1));
      }
    }
  });
  return null;
}
