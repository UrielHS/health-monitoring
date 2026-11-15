import { useEffect, useState } from "react";
import { MissionProvider, useMission } from "@/data/mission";
import { GuidePage } from "@/guide/GuidePage";
import { GroundView } from "@/ui/GroundView";
import { Preflight } from "@/ui/Preflight";
import { ShipView } from "@/ui/ShipView";

const viewOf = () => (location.hash === "#ground" ? "ground" : location.hash === "#guide" ? "guide" : "ship");

function Views() {
  const { started } = useMission();
  const [view, setView] = useState(viewOf);
  useEffect(() => {
    const onHash = () => setView(viewOf());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // El médico en Tierra entra directo; el astronauta pasa primero por el preflight.
  if (view === "ground") return <GroundView />;
  if (view === "guide") return <GuidePage />;
  return started ? <ShipView /> : <Preflight />;
}

export default function App() {
  return (
    <MissionProvider>
      <Views />
    </MissionProvider>
  );
}
