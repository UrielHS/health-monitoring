# AURA · Astronaut Health Monitor

> Versión en español para el equipo. La versión de entrega, en inglés, es [`README.md`](README.md).

Monitoreo de salud de astronautas para el reto **Create Health Monitoring Software for Astronauts on Space Missions** (NASA Space Apps 2026).

Una pulsera con ESP32 mide pulso, oxigenación, movimiento y el aire de la cabina, y publica por **MQTT** a un broker **Mosquitto** en la laptop "Nave". El servidor interpreta los datos al instante y alerta al astronauta en lenguaje simple, sin depender de la Tierra. Una vista de "médico en Tierra" recibe los mismos datos con retraso.

```
ESP32 ──MQTT──▶ Mosquitto ──▶ servidor (reglas, Postgres) ──Socket.IO──▶ app (#ship / #ground)
                                   ▲
              simulador de la app ─┘  (POST /api/sim/:escenario, mismo flujo)
```

Brief, requerimientos y decisiones: [documento del proyecto](https://claude.ai/artifact/NywqoijMa9Gyf5xubNdsjZ).

**Antes de cambiar algo, lee [`CLAUDE.md`](CLAUDE.md):** resume las decisiones del equipo y las reglas para subir cambios. Los asistentes de IA lo leen automáticamente.

## Estructura

```
packages/shared   Contrato de telemetría v1 (Zod), topics MQTT, motor de reglas y simulador. Fuente única de verdad.
apps/server       Express + Socket.IO + Prisma/PostgreSQL + cliente MQTT. Reglas, alertas, vista Tierra con retraso.
apps/web          PWA (React + Vite + three.js). Preflight, vista del astronauta (#ship) y del médico en Tierra (#ground).
firmware          ESP32 con PlatformIO. Wi-Fi, NTP y publicación MQTT del contrato.
mosquitto         Configuración del broker (usuarios y permisos se generan al arrancar).
```

## Arranque (Windows, PowerShell)

Requisitos: Node 20+, Docker Desktop abierto.

```powershell
# 0. Solo la primera vez, o si cambió alguna dependencia
npm install

# 1. Base de datos y broker
docker compose up -d db mosquitto
docker ps          # db "healthy" y mosquitto "Up" con 0.0.0.0:1883->1883/tcp

# 2. Tablas (la primera vez y cada vez que cambie prisma/schema.prisma)
npm run db:push

# 3. Servidor (terminal 1)
npm run dev:server   # debe decir: [mqtt] conectado a mqtt://127.0.0.1:1883 como server

# 4. App (terminal 2)
npm run dev:web      # http://localhost:5173   (Tierra: http://localhost:5173/#ground)
```

Si en el paso 3 ves `ECONNREFUSED 127.0.0.1:1883`, el broker no está arriba: `docker compose logs mosquitto`.

Prueba rápida sin el ESP32, en otra terminal: `npm run sim -- --scenario co --mqtt`. Se conecta al broker como la **pulsera de prueba `test-01`** y recorre exactamente el camino de la pulsera real, así que en la app aparece con la fuente **Live wristband**. Es solo para probar el broker; para la demo usa el simulador de la app o la pulsera real.

Para que el ESP32 llegue a esta laptop, abre los puertos una vez (PowerShell **como administrador**):

```powershell
New-NetFirewallRule -DisplayName "AURA MQTT 1883" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow -Profile Any
New-NetFirewallRule -DisplayName "AURA API 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any
```

## Pulsera por MQTT

| Topic | Quién publica | Qué lleva |
| --- | --- | --- |
| `astro/v1/<deviceId>/telemetry` | Pulsera (y la pulsera de prueba de `npm run sim -- --mqtt`) | JSON del contrato v1 |
| `astro/v1/<deviceId>/status` | Pulsera (`online`, retenido) y el broker por Last Will (`offline`) | texto |
| `astro/v1/<deviceId>/errors` | Servidor, cuando rechaza un paquete | `{ "error", "issues" }` |
| `astro/v1/config` | Servidor, retenido | lo mismo que `GET /api/config` |

- **Usuarios del broker** (los crea `docker compose` al arrancar con las claves del `.env` de la raíz): `server`, `node-01` (la pulsera) y `test-01` (pulsera de prueba de `npm run sim -- --mqtt`).
- **Permisos** (`mosquitto/acl`): cada pulsera usa su deviceId como usuario y solo puede publicar en su propio topic. El servidor además comprueba que el deviceId del topic sea el mismo del JSON.
- **Last Will**: si la pulsera se apaga o pierde la red, el broker publica `offline` y la app muestra "sin señal" en unos 7 s, sin esperar el temporizador de 10 s.
- **HTTP sigue como respaldo**: `POST /api/telemetria` con `x-api-key` acepta exactamente el mismo JSON.
- El **simulador de la app** (`POST /api/sim/...`) no pasa por el broker: entra directo al mismo flujo (base de datos, reglas, alertas, Tierra), así la demo con simulador funciona aunque Mosquitto falle.

## Contrato de telemetría v1 (congelado)

Definido en [`packages/shared/src/index.ts`](packages/shared/src/index.ts). Es el mismo por MQTT y por HTTP.

```json
{
  "v": 1,
  "deviceId": "node-01",
  "bootId": 1834552011,
  "seq": 4821,
  "bootMs": 523000,
  "ts": 1794677601000,
  "source": "device",
  "vitals": { "bpm": 72, "spo2": 97, "quality": "ok" },
  "motion": { "sensor": "mpu6050", "accMag": 1.02, "gyroMag": 3.4, "activity": "rest", "impact": false },
  "env": { "tempC": 23.1, "rh": 41.5, "pressureKpa": 101.2, "coPpm": 2.1, "coState": "ready" },
  "localAlert": { "level": "none", "rules": [] }
}
```

| Campo | Valores |
| --- | --- |
| `vitals.quality` | `ok`, `noisy`, `no_finger`, `no_sensor` |
| `motion.sensor` | `mpu6050`, `bmi160`, `none` |
| `motion.activity` | `rest`, `light`, `active` o `null` |
| `env.coState` | `warming`, `heating`, `ready`, `no_sensor` |
| `localAlert.level` | `none`, `warning`, `danger` (lo que decidió el buzzer) |
| `localAlert.rules` | `CO_HIGH`, `SPO2_LOW`, `PRESSURE_LOW`, `IMPACT`, ... |

- **Sensor ausente o lectura inválida = `null`**, nunca `0` ni `-1` (un `bpm: 0` dispararía una alerta falsa).
- Todas las claves viajan siempre y no se aceptan claves extra: un campo mal escrito se rechaza con el motivo exacto.
- `bootId` debe ser **distinto en cada arranque** (`esp_random() & 0x7FFFFFFF`). Con `seq` forma la clave única: si fuera fijo, tras un reinicio las lecturas nuevas se descartarían como duplicadas.
- `ts` es `null` si el ESP32 no tiene hora NTP (en la red de la Nave no hay internet). El servidor la reconstruye con `bootMs`.
- **CO de la pulsera real**: escala de demo 0–40 calibrada contra el aire de la sala (0 = aire de la sala, 9 = alerta, 35 = crítico). La app lo muestra como "CO index", no como ppm. El simulador usa la misma escala.

## API

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/telemetria` | Respaldo HTTP de la pulsera. Header `x-api-key`. Responde `{ ok, accepted, duplicates, configVersion }`, `400 { error: "validation", issues }` o `401`. |
| `POST` | `/api/telemetria/lote` | `{ "packets": [...] }`, de 1 a 50 lecturas guardadas en flash. Se almacenan sin disparar alertas viejas. |
| `GET` | `/api/config` | Umbrales, escala de CO y reglas vigentes. |
| `GET` | `/api/health` | Estado del servidor, la base de datos y el broker (`mqtt.connected`, `received`, `rejected`, `lastError`). |
| `GET` | `/api/lecturas?deviceId=&minutes=` | Historial reciente. |
| `GET` | `/api/alertas?active=1` | Alertas (activas o recientes). |
| `POST` | `/api/alertas/:id/ack` | Reconocer una alerta. |
| `POST` | `/api/alertas/:id/escalate` | "Call the crew": escala un impacto a peligro sin esperar los 30 s. |
| `POST` / `GET` | `/api/sintomas` | Registro manual de síntomas. |
| `POST` | `/api/sim/:escenario` | Lanza un escenario simulado desde la app. Mismo flujo que la pulsera. Body opcional: `deviceId`, `warmupSec` (0), `rampSec` (20). |
| `POST` | `/api/sim/stop` | Detiene la simulación. |
| `GET` | `/api/sim` | Estado del simulador y escenarios disponibles. |

Socket.IO: namespace `/ship` en tiempo real y `/ground` con retraso (cada evento llega envuelto con `originalAt` y `deliveredAt`). Eventos: `snapshot`, `telemetry`, `alert`, `alert:resolved`, `alert:ack`, `node:status`, `symptom`.

## Simulador

Escenarios: `normal`, `exercise`, `stress`, `co`, `hypoxia`, `depressurization`, `impact`, `offline`. Con `SIM_ENABLED=false` se desactiva el simulador de la app.

```powershell
npm run sim -- --scenario co --mqtt          # pulsera de prueba test-01, por el broker (sale en "Live wristband")
npm run sim -- --scenario hypoxia            # nodo simulado sim-01 por HTTP (sale en "Simulation")
npm run sim -- --scenario offline --mqtt     # deja de enviar: prueba el Last Will y "sin señal"
```

Envía datos normales durante `--warmup` segundos (10 por defecto) y después aplica el escenario. Otras opciones: `--url`, `--broker`, `--key`, `--device`, `--interval`, `--ramp`.

Para la demo de estrés, primero corre `normal` durante 1 minuto: el servidor calcula el pulso base personal con esas lecturas, y si el primer escenario ya es de estrés, la base sale alta y la regla no dispara.

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
| Guía | `#guide`. Cada parte de la pantalla, los colores de estado, los cinco paneles y los ocho escenarios, con capturas anotadas. |

**Para el jurado:** en el preflight, el botón **Explore with simulated data** entra directo con un tripulante y una misión ficticios, abre un tour la primera vez y muestra una tarjeta que explica cada escenario.

En el preflight se elige la fuente: **Live wristband** (la pulsera real) o **Simulation** (el nodo simulado `sim-01` del servidor). En la misión, la barra **Try a scenario** del pie lanza los escenarios (teclas `1` a `8`; la tecla `S` la muestra), **Sensor check** regresa al preflight y **Use real wristband** vuelve a la pulsera.

**Modo demo sin servidor.** Si la app no encuentra el servidor (o se abre con `?demo`), corre sola: el simulador y el motor de reglas de `packages/shared` se ejecutan en el navegador, así que las alertas son las mismas. Sirve para publicar solo `apps/web` (por ejemplo en Vercel, con `VITE_STANDALONE=1`) y enseñarla sin servidor. Opciones: `?delay=15` (retraso de Tierra en segundos) y `?scale=1` (velocidad de las reglas; por defecto 0.1).

Otros parámetros: `?api=http://192.168.137.1:3000` apunta la app a otra Nave (también se puede escribir en el preflight). El nombre del producto está en `apps/web/src/config.ts`, y los textos cortos de cada alerta en `apps/web/src/model/copy.ts`: si backend agrega una regla, ahí se le pone su zona del cuerpo y su frase.

## Modo Nave completo (demo)

```powershell
docker compose up -d --build     # db + mosquitto + servidor
npm run dev:web
```

Para acelerar las reglas en la demo, en el `.env` de la raíz: `RULE_TIME_SCALE=0.1` y `GROUND_DELAY_SEC=60`, y luego `docker compose up -d --build`.

## Variables de entorno

Servidor (`apps/server/.env`; en Docker las toma de `docker-compose.yml` y del `.env` de la raíz):

| Variable | Default | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | — | `postgresql://astro:astro@127.0.0.1:55432/astro` fuera de Docker |
| `MQTT_ENABLED` | `true` | `false` = solo HTTP |
| `MQTT_URL` | `mqtt://127.0.0.1:1883` | Broker (`127.0.0.1` y no `localhost`: en Windows `localhost` va primero a IPv6) |
| `MQTT_USER` / `MQTT_PASS` | `server` / `clave-server` | Debe coincidir con `MQTT_SERVER_PASS` del `.env` de la raíz |
| `DEVICE_API_KEYS` | `dev-key` | API keys del respaldo HTTP (`x-api-key`), separadas por comas |
| `GROUND_DELAY_SEC` | `60` | Retraso de la vista Tierra |
| `OFFLINE_AFTER_SEC` | `10` | Segundos sin datos antes de "sin señal" |
| `RULE_TIME_SCALE` | `1` | Multiplica la duración mínima de las reglas (`0.1` = 10 veces más rápido) |
| `BASELINE_SAMPLES` | `30` | Lecturas en reposo para calcular el pulso base |
| `SIM_ENABLED` | `true` | Permite lanzar escenarios desde la app |

Broker (`.env` de la raíz): `MQTT_SERVER_PASS`, `MQTT_DEVICE_USER` (`node-01`), `MQTT_DEVICE_PASS`, `MQTT_TEST_PASS`. Si cambias una clave: `docker compose up -d --force-recreate mosquitto`.

## Firmware

```powershell
cd firmware
copy include\config.example.h include\config.h   # Wi-Fi 2.4 GHz, IP de la laptop, clave MQTT
pio run -t upload; pio device monitor
```

`readSensors()` trae valores fijos; ahí se integran los sensores reales. Al arrancar imprime `[boot] deviceId=... bootId=...` y `[mqtt] conectando... OK`.

## Pruebas

```powershell
npm test     # contrato, topics, alerta local y los 8 escenarios por el motor de reglas
```

## Problemas comunes

| Síntoma | Causa | Solución |
| --- | --- | --- |
| `port is already allocated` en 1883 | Otro Mosquitto (por ejemplo el de la app de prueba `telemetria-mqtt`) | `docker ps`, luego `docker stop <nombre>` |
| `ECONNREFUSED 127.0.0.1:1883` en el servidor | El broker no está corriendo | `docker compose up -d mosquitto` y `docker compose logs mosquitto` |
| `el broker rechazó usuario/clave` | `MQTT_PASS` del servidor ≠ `MQTT_SERVER_PASS` de la raíz | Igualarlas y `docker compose up -d --force-recreate mosquitto` |
| ESP32 `estado=-2` | No llega al broker | Misma Wi-Fi 2.4 GHz, IP correcta, regla de firewall 1883 |
| ESP32 `estado=4` o `5` | Usuario o clave del broker | `DEVICE_ID` = `MQTT_DEVICE_USER`, `MQTT_PASS` = `MQTT_DEVICE_PASS` |
| ESP32 imprime `RECHAZADO por el servidor` | El JSON no cumple el contrato | El mensaje dice qué campo |
| La app abre en modo demo sin servidor | No encontró `http://<host>:3000` | Revisa `npm run dev:server`; si cambiaste `PORT`, abre la app con `?api=http://localhost:<puerto>` |
| `npm run dev:web` abre en 5174 | Otro proyecto usa el 5173 | Normal, usa el puerto que imprime |

## Flujo de trabajo

- `main` siempre funciona. Cada quien trabaja en su rama (`back/...`, `device/...`, `web/...`) y abre un PR.
- Un cambio al contrato en `packages/shared` se acuerda entre backend y conexión del dispositivo antes de subirlo, y sube `v`.
