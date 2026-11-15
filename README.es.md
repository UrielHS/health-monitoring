# Astronaut Health Monitor

> Versión en español para el equipo. La versión de entrega, en inglés, es [`README.md`](README.md).

Monitoreo de salud de astronautas para el reto **Create Health Monitoring Software for Astronauts on Space Missions** (NASA Space Apps 2026).

Una pulsera con ESP32 mide pulso, oxigenación, movimiento y el aire de la cabina. Un servidor en la "nave" interpreta los datos al instante y alerta al astronauta en lenguaje simple, sin depender de la Tierra. Una vista de "médico en Tierra" recibe los mismos datos con retraso.

Brief, requerimientos y decisiones: [documento del proyecto](https://claude.ai/artifact/NywqoijMa9Gyf5xubNdsjZ).

**Antes de cambiar algo, lee [`CLAUDE.md`](CLAUDE.md):** resume las decisiones del equipo y las reglas para subir cambios. Los asistentes de IA lo leen automáticamente.

## Estructura

```
packages/shared   Contrato de telemetría (Zod), motor de reglas y simulador. Fuente única de verdad del JSON y de las alertas.
apps/server       Express + Socket.IO + Prisma/PostgreSQL. Aplica las reglas, guarda, vista Tierra con retraso.
apps/web          PWA (React + Vite + three.js). Preflight, vista del astronauta (#ship) y del médico en Tierra (#ground).
firmware          ESP32 con PlatformIO. Conexión Wi-Fi, NTP y envío del contrato al servidor.
```

## Arranque rápido (desarrollo)

Requisitos: Node 20+, Docker Desktop.

```bash
npm install

# 1. Base de datos
docker compose up -d db

# 2. Servidor
cp apps/server/.env.example apps/server/.env
npm run db:push
npm run dev:server          # http://localhost:3000/api/health

# 3. App (otra terminal)
npm run dev:web             # http://localhost:5173   (vista Tierra: http://localhost:5173/#ground)

# 4. Simulador (otra terminal)
npm run sim -- --scenario co
```

Para la demo de estrés, primero corre `normal` durante 1 minuto: el servidor calcula el pulso base personal con esas lecturas, y si el primer escenario ya es de estrés, la base sale alta y la regla no dispara.

Escenarios del simulador: `normal`, `exercise`, `stress`, `co`, `hypoxia`, `depressurization`, `impact`, `offline`. Envía datos normales durante `--warmup` segundos (10 por defecto) y después aplica el escenario. Otras opciones: `--url`, `--key`, `--device`, `--interval`.

## La app (Mission View)

El cuerpo 3D de partículas viene de [mission-view](https://github.com/antonyto02/mission-view) y se adaptó a este backend: cada zona del cuerpo tiene un panel (Mind, Blood oxygen, Cabin air, Heart, Body) unido por una línea, y el color lo deciden las alertas del servidor. Las pantallas siguen el diseño de UI/UX:

| Pantalla | Cuándo aparece |
| --- | --- |
| Preflight (revisando / listo) | Al abrir la app. Revisa el enlace con la Nave y que cada sensor esté leyendo. `Start mission` se habilita cuando todo está en verde. |
| Astronauta: nominal | Todo bien. |
| Astronauta: peligro | Alerta crítica, por ejemplo fuga de CO: aviso central, panel en rojo con qué pasó y qué hacer, botón `Acknowledge`. |
| Astronauta: impacto | "Are you OK?" con cuenta de 30 s. Sin respuesta (o con `Call the crew`) escala a peligro. |
| Astronauta: síntomas | Botón `How do you feel?`. El astronauta decide si lo comparte con Tierra. |
| Astronauta: sin señal | 10 s sin paquetes de la pulsera, o sin conexión con el servidor. |
| Tierra | `#ground`. Los mismos datos con retraso, gráficas de tendencia (pulso, SpO2, índice de CO), bitácora con hora de envío y de llegada, y exportar reporte. |

**Para el jurado:** en el preflight, el botón **Explore with simulated data** entra directo con un tripulante y una misión ficticios, abre un tour la primera vez y muestra una tarjeta que explica cada escenario. La guía de usuario con capturas está en `#guide`.

En el preflight se elige la fuente: **Live wristband** (la pulsera real) o **Simulation** (el nodo simulado `sim-01` del servidor). Durante la misión, el enlace `Simulator` del pie (o la tecla `S`) muestra la barra de escenarios; las teclas `1` a `8` los lanzan y `← Live wristband` regresa a la pulsera.

**Modo demo sin servidor.** Si la app no encuentra el servidor (o se abre con `?demo`), corre sola: el simulador y el motor de reglas de `packages/shared` se ejecutan en el navegador, así que las alertas son las mismas. Sirve para publicar solo `apps/web` (por ejemplo en Vercel, con `VITE_STANDALONE=1`) y enseñarla sin servidor. Opciones: `?delay=15` (retraso de Tierra en segundos) y `?scale=1` (velocidad de las reglas; por defecto 0.1).

Otros parámetros: `?api=http://192.168.137.1:3000` apunta la app a otra Nave (también se puede escribir en el preflight). El nombre del producto está en `apps/web/src/config.ts`, y los textos cortos de cada alerta en `apps/web/src/model/copy.ts`: si backend agrega una regla, ahí se le pone su zona del cuerpo y su frase.

## Despliegue (demo)

Para la entrega, un solo servidor desplegado en la nube hace de Nave y de Tierra (plataforma por confirmar). Se construye desde `apps/server/Dockerfile`, con PostgreSQL como servicio de la plataforma. El ESP32 envía por HTTPS a la URL de ese servidor (ver `firmware/include/config.example.h`).

Para la demo conviene acelerar las reglas con `RULE_TIME_SCALE=0.1` y dejar `GROUND_DELAY_SEC=60`. `CORS_ORIGIN` debe incluir el dominio donde se publique la app.

Para probar todo junto en local:

```bash
RULE_TIME_SCALE=0.1 docker compose up -d --build
npm run dev:web
```

## Variables de entorno del servidor

| Variable | Default | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | — | Conexión a PostgreSQL |
| `DEVICE_API_KEYS` | `dev-key` | API keys válidas para el header `x-api-key`, separadas por comas |
| `GROUND_DELAY_SEC` | `60` | Retraso de la vista Tierra |
| `OFFLINE_AFTER_SEC` | `10` | Segundos sin datos antes de la alerta "sin señal" |
| `RULE_TIME_SCALE` | `1` | Multiplica la duración mínima de las reglas (`0.1` = 10 veces más rápido) |
| `BASELINE_SAMPLES` | `30` | Lecturas en reposo para calcular el pulso base |
| `SIM_ENABLED` | `true` | Permite lanzar escenarios desde la app |

## API

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/telemetria` | Una lectura. Header `x-api-key`. |
| `POST` | `/api/telemetria/lote` | Hasta 50 lecturas guardadas en flash. Se almacenan sin disparar alertas viejas. |
| `GET` | `/api/config` | Umbrales y reglas vigentes. |
| `GET` | `/api/health` | Estado del servidor y la base de datos. |
| `GET` | `/api/lecturas?deviceId=&minutes=` | Historial reciente. |
| `GET` | `/api/alertas?active=1` | Alertas (activas o recientes). |
| `POST` | `/api/alertas/:id/ack` | Reconocer una alerta. |
| `POST` | `/api/alertas/:id/escalate` | "Call the crew": escala un impacto a peligro sin esperar los 30 s. |
| `POST` / `GET` | `/api/sintomas` | Registro manual de síntomas. |
| `POST` | `/api/sim/:escenario` | Lanza un escenario simulado desde la app. Pasa por el mismo motor de reglas. Body opcional: `deviceId`, `warmupSec` (0), `rampSec` (20). |
| `POST` | `/api/sim/stop` | Detiene la simulación. |
| `GET` | `/api/sim` | Estado del simulador y escenarios disponibles. |

Socket.IO: namespace `/ship` en tiempo real y `/ground` con retraso (cada evento llega envuelto con `originalAt` y `deliveredAt`). Eventos: `snapshot`, `telemetry`, `alert`, `alert:resolved`, `alert:ack`, `node:status`, `symptom`.

## Contrato de telemetría

Definido en [`packages/shared/src/index.ts`](packages/shared/src/index.ts). Ejemplo:

```json
{
  "deviceId": "wearable-01",
  "bootId": 1834552011,
  "seq": 4821,
  "bootMs": 523000,
  "ts": 1794677601000,
  "source": "device",
  "vitals": { "bpm": 72, "spo2": 97, "quality": "ok" },
  "motion": { "accMag": 1.02, "gyroMag": 3.4, "activity": "rest", "impact": false },
  "env": { "tempC": 23.1, "rh": 41.5, "pressureKpa": 101.2, "coPpm": 2.1, "coState": "ready" },
  "localAlert": "none"
}
```

- `bootId` es aleatorio en cada arranque del ESP32. Así, cuando `seq` vuelve a 0 tras un reinicio, las lecturas nuevas no chocan con las viejas.
- `ts` se omite si el ESP32 no ha sincronizado NTP. El servidor reconstruye la hora con `bootMs`.
- Un reenvío con el mismo `(deviceId, bootId, seq)` se ignora (sin duplicados).

## Firmware

```bash
cd firmware
cp include/config.example.h include/config.h   # Wi-Fi, IP del servidor, API key
pio run -t upload && pio device monitor
```

Hoy envía valores fijos desde `readSensors()`; ahí se integran los sensores reales.

## Flujo de trabajo

Las reglas completas están en [`CLAUDE.md`](CLAUDE.md#reglas-para-subir-cambios). En resumen:

- `main` siempre funciona. Cada quien trabaja en su rama (`back/...`, `device/...`, `web/...`) y abre un PR que revisa otra persona.
- Un cambio al contrato en `packages/shared` se acuerda entre backend y conexión del dispositivo antes de subirlo.
- Antes del PR: `npm run typecheck` sin errores y decir qué se probó.
