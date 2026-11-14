# Astronaut Health Monitor

Monitoreo de salud de astronautas para el reto **Create Health Monitoring Software for Astronauts on Space Missions** (NASA Space Apps 2026).

Una pulsera con ESP32 mide pulso, oxigenación, movimiento y el aire de la cabina. Un servidor en la "nave" interpreta los datos al instante y alerta al astronauta en lenguaje simple, sin depender de la Tierra. Una vista de "médico en Tierra" recibe los mismos datos con retraso.

Brief, requerimientos y decisiones: [documento del proyecto](https://claude.ai/artifact/NywqoijMa9Gyf5xubNdsjZ).

## Estructura

```
packages/shared   Contrato de telemetría (Zod) y tipos compartidos. Fuente única de verdad del JSON.
apps/server       Express + Socket.IO + Prisma/PostgreSQL. Reglas de alerta, vista Tierra con retraso, simulador.
apps/web          PWA (React + Vite). Vista del astronauta (#ship) y del médico en Tierra (#ground).
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

Escenarios del simulador: `normal`, `exercise`, `stress`, `co`, `hypoxia`, `depressurization`, `impact`, `offline`. Envía datos normales durante `--warmup` segundos (10 por defecto) y después aplica el escenario. Otras opciones: `--url`, `--key`, `--device`, `--interval`.

## Modo Nave completo (demo)

```bash
docker compose up -d --build
npm run dev:web
```

El ESP32 debe apuntar a la IP de esa laptop en la red local (`http://<IP>:3000`). Para la demo conviene acelerar las reglas:

```bash
RULE_TIME_SCALE=0.1 GROUND_DELAY_SEC=60 docker compose up -d --build
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
| `POST` / `GET` | `/api/sintomas` | Registro manual de síntomas. |

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

- `main` siempre funciona. Cada quien trabaja en su rama (`back/...`, `device/...`, `web/...`) y abre un PR.
- Un cambio al contrato en `packages/shared` se acuerda entre backend y conexión del dispositivo antes de subirlo.
