# CLAUDE.md — léelo antes de tocar el repo

Este archivo es el contexto que cualquier asistente de IA (y cualquier persona nueva) necesita para trabajar en este proyecto sin romper lo que el equipo ya decidió. Si algo aquí contradice lo que te pide alguien del equipo, pregúntale antes de seguir.

## Qué es

**AURA** (nombre provisional; el equipo decide entre AURA y SpatialCare) es un sistema de monitoreo de salud para astronautas, hecho para el reto *Create Health Monitoring Software for Astronauts on Space Missions* de NASA Space Apps 2026.

Una pulsera con ESP32 mide pulso, oxigenación, movimiento y el aire de la cabina. Un servidor interpreta los datos con reglas fijas y alerta al astronauta en lenguaje simple: qué pasó, por qué importa y qué hacer. Una vista de "médico en Tierra" recibe lo mismo con 60 s de retraso, para mostrar que el astronauta decide sin esperar a la Tierra.

**Entrega: domingo 15 de noviembre de 2026 a las 12:00 (hora de Ciudad de México). El alcance se congela el 15 a las 00:00; después solo se corrigen errores.**

## Fuentes de verdad, en este orden

1. El código en `main`.
2. La **sección 12** del [documento del proyecto](https://claude.ai/artifact/NywqoijMa9Gyf5xubNdsjZ): decisiones más recientes.
3. El resto del documento: brief, requerimientos (RF/RNF), umbrales, limitaciones, plan.

Otros recursos (privados de Leilany hasta que los comparta):
- [Diagrama de flujo y árbol de vistas](https://claude.ai/artifact/MtpUQPzP3qAyCxgHj3w7TZ)
- [Mockups de las 8 pantallas](https://claude.ai/artifact/KWrMijR4LGYAiMQVSVcBHm)
- [mission-view](https://github.com/antonyto02/mission-view): modelo visual del cuerpo 3D de partículas.
- `docs/hardware/`: diagrama lógico y diagrama por capas del dispositivo, hechos a mano por Mike. **El diagrama lógico dice "MQTT → Socket listener": está desactualizado, la pulsera usa HTTPS POST.**

Si encuentras una contradicción entre estas fuentes, no la resuelvas por tu cuenta: dila en tu respuesta para que el equipo la corrija en el documento.

## Equipo y responsables

| Persona | Área | Dónde trabaja |
| --- | --- | --- |
| Amparo | Backend | `apps/server`, `packages/shared` |
| Angel | Backend y conexión de la pulsera | `firmware/` (Wi-Fi, HTTPS, NTP), endpoints de telemetría |
| Mike | Diseño y construcción del dispositivo | `firmware/` (sensores, OLED, buzzer), hardware |
| Leilany | UI/UX de la app | `apps/web` |

Quién programa el frontend de la PWA sigue sin confirmarse. No toques el área de otra persona sin que te lo pidan; si tu cambio la afecta, dilo.

## Arquitectura

```
Pulsera ESP32 ──HTTPS POST /api/telemetria (cada ~2 s, x-api-key)──▶ Servidor en la nube
   │  alertas locales (OLED + buzzer), sin depender de la red         │  Zod → PostgreSQL → motor de reglas
                                                                       ├─ Socket.IO /ship   → vista del astronauta (tiempo real)
                                                                       └─ Socket.IO /ground → vista Tierra (+60 s)
Simulador ── POST /api/sim/:escenario (desde la app) o npm run sim ──▶ mismo flujo que la pulsera
```

- **Un solo servidor desplegado en la nube** hace de Nave y de Tierra. La plataforma está por confirmar (se propuso Railway). Docker Compose es para desarrollo local.
- La pulsera necesita una red Wi-Fi con internet y envía por **HTTPS** con el certificado raíz **ISRG Root X1** embebido. **Nunca** `setInsecure()`.
- Las alertas críticas también se evalúan en el ESP32: OLED y buzzer funcionan aunque no haya red (RNF-02). Así se cuenta la independencia de la Tierra ante el jurado.
- La vista Tierra no espera a que el astronauta reconozca nada: recibe **todo** en paralelo, con retraso.

## Estructura del repo

```
packages/shared   Contrato de telemetría (Zod), motor de reglas (rules.ts) y simulador (sim.ts).
                  Fuente única del JSON y de las reglas: los usan el servidor y la app.
apps/server       Express 5 + Socket.IO + Prisma/PostgreSQL. Alertas, vista Tierra, endpoints del simulador.
                  src/rules.ts y src/sim.ts solo reexportan lo de packages/shared con los valores del entorno.
apps/web          PWA Mission View (React + Vite + three.js): cuerpo 3D de partículas y las 8 pantallas del diseño.
firmware          ESP32 con PlatformIO.
docs/hardware     Diagramas del dispositivo.
```

La app (integrada en `main` con el PR #2):
- Pantallas: preflight (revisando / listo), astronauta nominal, peligro, impacto ("Are you OK?" con 30 s), síntomas, sin señal y Tierra (`#ground`).
- En el preflight se elige la fuente: **Live wristband** o **Simulation** (`sim-01` del servidor). La tecla `S` muestra la barra de escenarios y las teclas `1` a `8` los lanzan.
- **Modo demo sin servidor** (`?demo` o `VITE_STANDALONE=1`, o si no encuentra el servidor): el simulador y las reglas de `packages/shared` corren en el navegador. Es solo el respaldo.
- **Para el jurado:** botón "Explore with simulated data" en el preflight, tour la primera vez (`?notour` lo apaga), tarjeta que explica cada escenario y guía de usuario con capturas en `#guide`. Los textos de los escenarios están en `apps/web/src/model/scenarios.ts`; el tripulante (CM-1) y el tiempo de misión son ficticios y se dicen así en pantalla. Las capturas de la guía (`apps/web/public/guide/`) se toman de la app en modo `?demo&notour`; si cambia la interfaz, hay que volver a tomarlas.
- El nombre del producto está en `apps/web/src/config.ts`. Los textos cortos y la zona del cuerpo de cada alerta, en `apps/web/src/model/copy.ts`: si backend agrega una regla, ahí se le asigna su zona y su frase.

## Contrato de telemetría

Definido en `packages/shared/src/index.ts`. **No lo cambies sin que Amparo y Angel lo acuerden**, y si cambia, actualiza la sección 6 del documento y el README.

- `bootId`: aleatorio en cada arranque del ESP32 (`esp_random() & 0x7FFFFFFF`). Como `seq` vuelve a 0 al reiniciar, la clave única es `(deviceId, bootId, seq)`. Un reenvío con la misma clave se ignora.
- `ts`: hora real en epoch ms. Se omite si el ESP32 no ha sincronizado NTP, y el servidor la reconstruye con `bootMs`.
- `vitals.quality`: `ok | noisy | no_finger`. Las reglas de pulso y SpO2 solo usan lecturas `ok`.
- `env.coPpm`: **no son ppm reales**. Es un índice relativo de 0 a 40 (ver "CO" abajo). En la interfaz se muestra como **"CO index (relative)"**, nunca como ppm.
- `env.coState`: `warming | heating | ready`. Mientras no sea `ready`, el servidor no evalúa reglas de CO.
- Temperatura, humedad, presión y CO pueden llegar en `null` si falla un sensor: el servidor y la app no deben romperse.

## Reglas y alertas

Viven en `packages/shared/src/rules.ts`; el servidor les pasa `RULE_TIME_SCALE` y `BASELINE_SAMPLES` desde `apps/server/src/rules.ts`. Umbrales iniciales, **no clínicos**:

- SpO2: atención ≤ 94 % (30 s), peligro ≤ 90 % (10 s).
- Pulso: peligro > 130 o < 40 (30 s); con actividad `active` el límite alto sube a 185, para que el ejercicio no alerte. En reposo, atención > 100 o < 50 (2 min).
- Estrés agudo: pulso ≥ 125 % del pulso base personal en reposo, durante 5 min. El pulso base se calcula con las primeras `BASELINE_SAMPLES` lecturas en reposo; por eso, antes de demostrar estrés, hay que correr el escenario `normal` 1 minuto.
- CO (índice): atención ≥ 9, peligro ≥ 35 (10 s). **El CO alerta solo**, sin esperar a la SpO2: el oxímetro confunde la hemoglobina con CO con la oxigenada y marca normal en una intoxicación. Es un punto clave del pitch.
- Presión: atención si baja ≥ 1 kPa en 5 min; peligro si baja ≥ 3 kPa o queda < 95 kPa; peligro combinado si baja la presión y la SpO2 ≤ 94.
- Cabina: temperatura y humedad fuera de rango (60 s).
- Impacto: alerta que no se cierra sola, solo al reconocerla ("I'm OK"). Si nadie responde en 30 s, la regla `impact_no_response` la escala a peligro; ese plazo no se acelera con `RULE_TIME_SCALE`. `POST /api/alertas/:id/escalate` ("Call the crew") escala de inmediato.
- Sin señal: 10 s sin paquetes → alerta crítica. El silencio no significa "todo bien".

`RULE_TIME_SCALE=0.1` hace que las reglas esperen 10 veces menos (para la demo). Los textos de alerta están **en inglés**, salen del servidor y tienen tres partes: título, mensaje (qué pasó y por qué importa) y acción. No cambies umbrales, reglas ni textos sin avisar al equipo: son lo que se presenta.

## Simulador

Escenarios: `normal`, `exercise`, `stress`, `co`, `hypoxia`, `depressurization`, `impact`, `offline`.

- El generador vive en `packages/shared/src/sim.ts`.
- Desde la app: `POST /api/sim/:escenario` (body opcional `deviceId`, `warmupSec` = 0, `rampSec` = 20), `POST /api/sim/stop`, `GET /api/sim`. Se apaga con `SIM_ENABLED=false`.
- Desde la terminal: `npm run sim -- --scenario co`.
- Lo simulado pasa por el mismo flujo que la pulsera (base de datos, reglas, Tierra). **Nunca generes alertas solo en el frontend con el servidor disponible.** El modo demo del navegador es solo el respaldo sin servidor.
- Todo dato simulado lleva `source: "sim"` y la app lo marca con la etiqueta **SIMULATED**.

## Hardware (decidido por Mike)

| Componente | Módulo | Conexión |
| --- | --- | --- |
| Microcontrolador | ESP32 DevKit V1 (ESP32-WROOM-32, 30 pines) | — |
| Movimiento | MPU6050 (GY-521) — reemplaza al BMI160 | I2C 0x68 |
| Pulso y SpO2 | MAX30100 (RCWL-0530 / GY-MAX30100) | I2C 0x57 |
| Clima | AHT20 + BMP280 en una placa | I2C 0x38 y 0x76/0x77 |
| Pantalla | OLED 0.96" 128×64, SSD1306 (a veces SH1106) | I2C 0x3C |
| CO | MQ-7, salida AO | GPIO 34 (ADC1) con divisor 10 kΩ + 10 kΩ |
| Alarma | Buzzer activo | GPIO 19 |

Bus I2C: GPIO 21 = SDA, GPIO 22 = SCL. Alimentación: módulo MB102, con 5 V para el ESP32 (VIN) y el MQ-7, y 3.3 V para el resto.

Notas de firmware:
- **Primero, un escáner I2C** con todo conectado: deben aparecer 0x38, 0x3C, 0x57, 0x68 y 0x76 o 0x77. Si falta 0x57, el MAX30100 probablemente tiene sus resistencias de I2C a 1.8 V: hay que quitarlas y poner 4.7 kΩ a 3.3 V.
- **Dos núcleos:** sensores, filtrado y alertas locales en el núcleo 1; Wi-Fi y HTTPS en el núcleo 0 (`xTaskCreatePinnedToCore`). El MAX30100 necesita `pox.update()` sin pausas; un POST en el mismo ciclo arruina el pulso.
- **Reconexión Wi-Fi sin bloqueo:** nunca un bucle que detenga la lectura de sensores o el buzzer. El `firmware/src/main.cpp` actual todavía espera hasta 15 s en `connectWiFi()`: hay que corregirlo.
- `HTTPClient` con `setReuse(true)`. Abrir una conexión por envío fragmenta la memoria.
- **HTTPS pendiente en el firmware:** `firmware/src/main.cpp` todavía usa `WiFiClient` (HTTP plano). Para la URL del servidor hay que cambiarlo a `WiFiClientSecure` con `setCACert()` y el certificado ISRG Root X1.
- MPU6050 en rango **±8 g**: con ±2 g un impacto se sale de escala. Impacto = pico mayor a 3 g.
- Librería de pantalla: **U8g2** (maneja SSD1306 y SH1106).
- El MAX30100 va en la **yema del dedo**, en contacto directo; en la muñeca la señal es demasiado débil.

### CO: escala relativa para la demo

El MQ-7 no se calibra en ppm (eso pide 48 h de precalentamiento). Va a 5 V continuo y el ESP32 convierte su lectura en un índice de 0 a 40:

1. Durante 2 a 3 minutos manda `coState: "warming"`.
2. Al terminar el calentamiento, promedia 10 lecturas en aire limpio: ese valor equivale a 0.
3. `CO_TOPE` es la lectura con la fuente de gas del ensayo y equivale a 40. Se calibra antes de la demo. Nunca encender un encendedor cerca del sensor.
4. Conversión con decimales y acotada; `map()` de Arduino no sirve porque usa enteros y puede dar negativos:

```cpp
float v = (adc - coBase) / (CO_TOPE - coBase) * 40.0;
return constrain(v, 0, 40);
```

## Decisiones cerradas (no reabrir sin el equipo)

- HTTPS POST desde la pulsera. No MQTT, no conexión por USB a la app.
- Un servidor en la nube para Nave y Tierra; Tierra con 60 s de retraso (`GROUND_DELAY_SEC`).
- Socket.IO con namespaces `/ship` y `/ground`; los eventos de Tierra llegan envueltos en `{ payload, originalAt, deliveredAt }`.
- Prisma con columnas planas; motor de reglas por paquete y un timer aparte para "sin señal".
- Interfaz en inglés. Colores de nivel: normal `#6fcf97`, atención `#f2a93b`, peligro `#ff5a5a`, sin señal `#7b8593`; vista Tierra en lila `#b9a4ff`. Peligro = banner rojo; atención = solo el panel en ámbar.
- El sueño no tiene sensor: solo aparece como síntoma registrado a mano.
- Gemini (si entra) solo explica alertas y nunca decide; nada de diagnósticos ni medicamentos.

## Fuera de alcance para la entrega

No lo implementes salvo que el equipo lo pida: inicio de sesión/JWT, asistente con Gemini (solo si sobra tiempo), cola en flash del ESP32, descarga de umbrales desde `/api/config` en el firmware, historial agregado por minuto, prueba de reacción, varios astronautas, sensores de CO2 o radiación, y MediaPipe o cámara.

## Reglas para subir cambios

1. **`main` siempre funciona.** Trabaja en una rama (`back/...`, `device/...`, `web/...`, `docs/...`) y abre un PR. Otra persona lo revisa antes de integrarlo. Nada de push directo a `main`.
2. **Cambios pequeños y enfocados.** No reescribas ni reformatees archivos que no tienen que ver con tu tarea. No agregues dependencias sin decir por qué.
3. **Antes de abrir un PR:**
   - `npm run typecheck` sin errores.
   - Si tocaste la app: `npm run build:web`.
   - Si tocaste el servidor: levántalo con PostgreSQL local y corre `npm run sim -- --scenario co`; debe aparecer la alerta de CO.
   - Si tocaste el firmware: compila con `pio run`.
   - Di en el PR qué probaste y qué no pudiste probar.
4. **Contrato, umbrales, reglas y textos de alerta** se cambian solo con acuerdo del equipo, y el cambio se anota en el documento (secciones 6 y 12).
5. **Nada de secretos.** `.env`, `firmware/include/config.h`, API keys y URLs privadas no se suben. Usa `.env.example` y `config.example.h`.
6. **Honestidad del dato:** lo simulado se marca SIMULATED, el CO es un índice relativo y nada se presenta como medición clínica.
7. **Idiomas:** interfaz y textos de alerta en inglés. Comentarios, documentación y mensajes de commit en español, explicando qué cambió y por qué.
8. **Si tomas una decisión nueva**, dila en tu respuesta para que se anote en la sección 12 del documento el mismo día.

## Comandos

```bash
npm install
docker compose up -d db                      # PostgreSQL local
cp apps/server/.env.example apps/server/.env
npm run db:push                              # crea las tablas
npm run dev:server                           # http://localhost:3000/api/health
npm run dev:web                              # http://localhost:5173  (Tierra: /#ground)
npm run sim -- --scenario co                 # simulador de terminal
npm run typecheck
cd firmware && cp include/config.example.h include/config.h && pio run -t upload
```

Variables del servidor: `DATABASE_URL`, `DEVICE_API_KEYS`, `GROUND_DELAY_SEC` (60), `OFFLINE_AFTER_SEC` (10), `RULE_TIME_SCALE` (1; 0.1 para la demo), `BASELINE_SAMPLES` (30), `SIM_ENABLED` (true), `CORS_ORIGIN` (debe incluir el dominio donde se publique la app).
