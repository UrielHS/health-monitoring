import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { NodeStatus, Scenario } from "@astro/shared";
import { FORCE_STANDALONE, SIM_DEVICE_ID, initialApiUrl } from "@/config";
import type { SeenAlert } from "@/model/types";
import type { Backend, Health, SimStatus, SymptomInput } from "./backend";
import { LocalBackend } from "./local";
import { Mirror, type Arrival, type MirrorState } from "./mirror";
import { RemoteBackend, probe } from "./remote";

export type Source = "live" | "sim";
export type BackendStatus = "checking" | "remote" | "local";

type Mission = {
  status: BackendStatus;
  backend: Backend | null;
  /** El servidor de la Nave no respondió y la app está corriendo sola. */
  serverMissing: boolean;
  health: Health | null;
  apiUrl: string;
  /** Cambia la URL del servidor y vuelve a intentar. */
  reconnect: (url?: string) => void;
  ship: MirrorState;
  ground: MirrorState;
  source: Source;
  setSource: (s: Source) => void;
  started: boolean;
  start: () => void;
  backToPreflight: () => void;
  sim: SimStatus;
  /** Último escenario pedido (incluye "offline", que detiene el envío). */
  scenario: Scenario | null;
  runScenario: (s: Scenario) => void;
  ack: (id: number) => void;
  escalate: (id: number) => void;
  logSymptom: (s: SymptomInput) => Promise<void>;
};

const Ctx = createContext<Mission | null>(null);
export const useMission = () => {
  const m = useContext(Ctx);
  if (!m) throw new Error("MissionProvider missing");
  return m;
};

const session = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* modo privado: no pasa nada */
    }
  },
};

const NO_SIM: SimStatus = { enabled: true, running: false };

export function MissionProvider({ children }: { children: ReactNode }) {
  const [apiUrl, setApiUrl] = useState(initialApiUrl);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [backend, setBackend] = useState<Backend | null>(null);
  const [serverMissing, setServerMissing] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [source, setSourceState] = useState<Source>(() => (session.get("aura.source") === "sim" ? "sim" : "live"));
  const [started, setStarted] = useState(() => session.get("aura.started") === "1");
  const [sim, setSim] = useState<SimStatus>(NO_SIM);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [simKnown, setSimKnown] = useState<Backend | null>(null);

  const mirrors = useMemo(() => ({ ship: new Mirror(), ground: new Mirror() }), [backend]);
  const ship = useSyncExternalStore(mirrors.ship.subscribe, mirrors.ship.get);
  const ground = useSyncExternalStore(mirrors.ground.subscribe, mirrors.ground.get);

  // ¿Hay servidor de la Nave? Si no, la app corre sola con el simulador integrado.
  useEffect(() => {
    let cancelled = false;
    let made: Backend | null = null;
    setStatus("checking");
    (async () => {
      const h = FORCE_STANDALONE ? { reachable: false, db: false } : await probe(apiUrl);
      if (cancelled) return;
      made = h.reachable ? new RemoteBackend(apiUrl) : new LocalBackend();
      setHealth(h.reachable ? h : { reachable: true, db: true });
      setServerMissing(!h.reachable && !FORCE_STANDALONE);
      setBackend(made);
      setStatus(h.reachable ? "remote" : "local");
      if (!h.reachable) setSourceState("sim");
    })();
    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [apiUrl, attempt]);

  // Las dos vistas escuchan siempre: así Tierra ya tiene su historia cuando se abre.
  useEffect(() => {
    if (!backend) return;
    const offShip = backend.ship(mirrors.ship);
    const offGround = backend.ground(mirrors.ground);
    return () => {
      offShip();
      offGround();
    };
  }, [backend, mirrors]);

  const delay = ground.groundDelaySec;
  useEffect(() => {
    if (!backend || delay == null) return;
    backend.groundHistory().then((h) => mirrors.ground.seed(h, delay)).catch(() => {});
  }, [backend, mirrors, delay]);

  // Historia reciente para las gráficas, en cuanto se sabe qué dispositivo es.
  const trendDevice =
    Object.keys(ground.readings)[0] ?? Object.values(ship.readings).sort((a, b) => b.deliveredAt - a.deliveredAt)[0]?.reading.deviceId ?? null;
  useEffect(() => {
    if (!backend || !trendDevice || delay == null) return;
    backend
      .readings(trendDevice, 10)
      .then((rows) => {
        mirrors.ground.seedReadings(rows, delay);
        mirrors.ship.seedReadings(rows, 0);
      })
      .catch(() => {});
  }, [backend, mirrors, trendDevice, delay]);

  // Estado del simulador (otra pantalla pudo haberlo lanzado).
  useEffect(() => {
    if (!backend) return;
    let alive = true;
    const poll = () =>
      backend
        .simStatus()
        .then((s) => {
          if (!alive) return;
          setSim(s);
          if (s.running && s.scenario) setScenario(s.scenario);
          setSimKnown(backend);
        })
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [backend]);

  const autoStarted = useRef<Backend | null>(null);
  const runScenario = useCallback(
    (s: Scenario) => {
      if (!backend) return;
      autoStarted.current = backend; // un escenario pedido a mano cancela el arranque automático
      setScenario(s);
      backend.simStart(s, SIM_DEVICE_ID).then(setSim).catch(() => {});
    },
    [backend],
  );

  // Fuente "Simulation": el nodo simulado empieza a mandar datos normales.
  const simRunning = sim.running;
  useEffect(() => {
    if (!backend || simKnown !== backend || source !== "sim" || simRunning || scenario === "offline") return;
    if (autoStarted.current === backend) return;
    autoStarted.current = backend;
    runScenario("normal");
  }, [backend, simKnown, source, simRunning, scenario, runScenario]);

  const setSource = useCallback(
    (s: Source) => {
      setSourceState(s);
      session.set("aura.source", s);
      if (s === "live" && backend) {
        setScenario(null);
        backend.simStop().then(setSim).catch(() => {});
      } else autoStarted.current = null;
    },
    [backend],
  );

  const value: Mission = {
    status,
    backend,
    serverMissing,
    health,
    apiUrl,
    reconnect: (url) => {
      if (url && url !== apiUrl) {
        try {
          localStorage.setItem("aura.api", url);
        } catch {
          /* sin almacenamiento */
        }
        setApiUrl(url.replace(/\/+$/, ""));
      } else setAttempt((n) => n + 1);
    },
    ship,
    ground,
    source,
    setSource,
    started,
    start: () => {
      setStarted(true);
      session.set("aura.started", "1");
    },
    backToPreflight: () => {
      setStarted(false);
      session.set("aura.started", "0");
    },
    sim,
    scenario,
    runScenario,
    ack: (id) => void backend?.ack(id).catch(() => {}),
    escalate: (id) => void backend?.escalate(id).catch(() => {}),
    logSymptom: (s) => backend?.logSymptom(s) ?? Promise.reject(new Error("no backend")),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------- selección de dispositivo ----------

export type DeviceView = {
  deviceId: string | null;
  arrival: Arrival | null;
  node: NodeStatus | null;
  alerts: SeenAlert[];
};

/** La Nave sigue a la pulsera real o al nodo simulado, según la fuente elegida. */
export function pickDevice(m: MirrorState, source: Source | "latest"): DeviceView {
  const all = Object.values(m.readings);
  const pool = source === "latest" ? all : all.filter((a) => (a.reading.source === "sim") === (source === "sim"));
  const arrival = pool.sort((a, b) => b.deliveredAt - a.deliveredAt)[0] ?? null;
  const deviceId = arrival?.reading.deviceId ?? null;
  return {
    deviceId,
    arrival,
    node: deviceId ? (m.nodes[deviceId] ?? null) : null,
    alerts: deviceId ? m.alerts.filter((a) => a.deviceId === deviceId) : [],
  };
}

/** Reloj para textos como "last packet 2 s ago". */
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
