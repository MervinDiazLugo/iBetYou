# Diseño: Apuestas en vivo (in-play) + pantalla de evento

**Fecha:** 2026-07-26
**Estado:** Propuesta — pendiente de revisión del usuario

---

## 1. Objetivo

Convertir cada tarjeta de evento en una puerta a una **pantalla de evento** rica
(`/event/[id]`, nueva pestaña) que:

1. Muestre un **panel en vivo** con datos visuales minuto a minuto que incentiven apostar.
2. Permita crear las apuestas actuales (**vs. la casa** y **P2P**) desde ahí.
3. Ofrezca **nuevos tipos de apuestas EN VIVO** (durante el partido) para fútbol, basket y béisbol.

**Restricción de negocio dura:** la casa siempre conserva ventaja (edge). Consumo de
**tokens de IA = $0 adicionales** (ver §7).

---

## 2. Hallazgos de la API (TheSportsDB Premium) — determinan qué es posible

> El proyecto NO usa api-sports.io para datos de partido; usa **TheSportsDB Premium**
> (`lib/tsdb.ts`, `THESPORTSDB_API_KEY`). CLAUDE.md está desactualizado en este punto.

Probado en vivo contra la API el 2026-07-26:

| Dato | Disponibilidad | Notas |
|---|---|---|
| Marcador (`intHomeScore/Away`) | ✅ En vivo, todas las ligas | |
| Estado (`strStatus`) | ✅ En vivo | `1H/2H/HT`, `Q1–Q4/OT`, `IN1–IN9` |
| **Progreso** (`strProgress`) | ✅ En vivo | Minuto (fútbol `"29"`), inning (`"IN1"`), cuarto (basket) |
| `updated` timestamp | ✅ | Permite detectar frescura del dato |
| Estadísticas in-play (posesión, tiros) | ❌ **Vacío en vivo** | `event_stats` → "No data found" durante el partido |
| Timeline in-play (goles/tarjetas minuto a minuto) | ❌ **Vacío en vivo** | `event_timeline` → "No data found" durante el partido |
| Estadísticas finales | ⚠️ Post-partido, **solo ligas grandes** | EPL sí (tiros, posesión); LATAM/menores escaso |
| Timeline final (goleadores, tarjetas, fotos jugador) | ⚠️ Post-partido, ligas grandes | Incluye `strCutout` (foto jugador) |
| Highlights (`strVideo`) | ⚠️ Post-partido, ligas grandes | Enlace YouTube |
| **Transmisión en vivo / imágenes en vivo** | ❌ **No existe** | Solo escudos estáticos de equipo/liga |

**Consecuencia de diseño:** una apuesta in-play sólo es ofrecible si se puede **resolver**
a partir de (a) marcador + estado + progreso en vivo, o (b) marcador/estadística final.
Nada de "próximo córner", "posesión %", "tiros" en vivo — ese dato no existe en este proveedor.
No hay stream ni imágenes en vivo; el panel se nutre de marcador, progreso, probabilidad
calculada, y (post-partido) estadísticas + highlights de YouTube en ligas grandes.

---

## 3. Decisiones tomadas (usuario, 2026-07-26)

| Tema | Decisión |
|---|---|
| Modelo de apuesta en vivo | **Ambos**: P2P en vivo + casa en vivo |
| Frecuencia de refresco | **Cada 2–3 min** (cron externo) |
| Click en tarjeta (fuera de botones) | **Nueva pestaña → `/event/[id]`** |
| Deportes v1 | **Los 3 a la vez** (fútbol, basket, béisbol) |

---

## 4. Arquitectura de resolución (clave del negocio)

La ventana de refresco de 2–3 min introduce **latencia**. Se resuelve enrutando cada
mercado según quién asume el riesgo:

### 4.1 Mercados CASA-en-vivo → sólo los que se liquidan al FINAL del partido
La casa da cuota, pero el resultado se decide al terminar el partido. Un solo gol no
resuelve la apuesta al instante, así que 2–3 min de retraso afectan la **cuota mostrada**,
no la justicia de la liquidación.

- `live_match_winner` — ganador del partido, cuota recalculada con estado actual.
- `live_total_ou` — total de goles/puntos/carreras del partido completo, cuota recalculada.

**Protecciones de la casa (suspensión de cuota):** no se acepta una apuesta casa-en-vivo si
- el último poll tiene > 6 min (dato viejo), o
- el marcador cambió entre los dos últimos polls (evento reciente → congelar 1 ciclo), o
- transición de periodo (HT, fin de cuarto/inning), o
- tramo final de alta varianza (últimos 5 min fútbol / Q4 últimos 2 min / último inning).
- Edge extra in-play: `LIVE_EDGE` sobre `HOUSE_EDGE` (1.10 → efectivo ~1.13–1.15).
- Topes de exposición: reutilizar `MAX_DIRECT_EXPOSURE` / `MAX_EXACT_EXPOSURE`.

### 4.2 Mercados P2P-en-vivo → aquí van los de resolución instantánea
La casa es neutral (sólo cobra fee), así que la latencia no la expone. Ambos usuarios
enfrentan la misma latencia → justo.

- Fútbol: `live_next_goal` (qué equipo marca el próximo gol / no más goles),
  `live_goal_before_min` (¿gol antes del min X?), `live_2h_goals_ou`.
- Basket: `live_next_quarter_winner`, `live_race_to_points` (primero en llegar a N puntos totales).
- Béisbol: `live_next_inning_runs` (¿carreras en el próximo inning? sí/no),
  `live_team_scores_inning_N`.

**Liquidación:** el poller (§6) observa el cambio de marcador + progreso y resuelve.
Caso borde: si **ambos** equipos marcan dentro de una misma ventana de poll y no se puede
determinar el orden (p.ej. `live_next_goal`), esa apuesta se **reembolsa** (void). Se documenta.

---

## 5. Modelo de probabilidad in-play (sin IA, matemática pura)

Reutiliza los helpers Poisson ya existentes en `lib/house-odds.ts`. **Cero llamadas a Claude.**

### Fútbol (Poisson)
- Prior: `λ_home`, `λ_away` desde `metadata.predictions.home/away_goals_avg` (ya persistido por
  el cron de predicciones). Fallback: derivar de `predictions.percent` o `λ=1.3` c/u.
- Fracción de tiempo restante `f = max(0, 90 − minuto)/90`. Goles esperados restantes `λ·f`.
- `P(gana local) = Σ P(h+X > a+Y)` con `X~Poisson(λ_home·f)`, `Y~Poisson(λ_away·f)` (cap 8).
  Igual para empate y visita. → cuota con `HOUSE_EDGE · LIVE_EDGE`.

### Basket (Normal)
- Diferencia actual `d = home − away`. Diferencia final esperada `≈ d + prior_diff·f`,
  `SD ∝ √(tiempo restante)`. `P(gana local) = Φ(esperada/SD)`. Total puntos análogo.

### Béisbol (tabla de win-expectancy estática)
- Tabla `(diferencia_carreras, inning) → P(gana local)` a partir de win-expectancy MLB
  conocido (constante en código, costo de cómputo nulo). Béisbol se mantiene conservador:
  sólo `live_match_winner` + `live_total_ou` con topes ajustados.

---

## 6. Componentes técnicos

### 6.1 Pantalla de evento — `app/event/[id]/page.tsx` (nueva)
Ruta pública. Click en la tarjeta del marketplace (fuera de los botones existentes) abre
`/event/[id]` con `target="_blank"`. Secciones del panel:

1. **Marcador en vivo** — escudos, marcador grande, pill "🔴 EN VIVO" pulsante, minuto/inning/cuarto.
2. **Barra de probabilidad en vivo** — %local/empate/visita, se anima al desplazarse; flecha de "momentum" vs snapshot previo.
3. **Línea de tiempo de marcador** (construida por nosotros) — lista de cambios de marcador detectados (`⚽ 24' 1-0`), desde `metadata.live.snapshots`.
4. **Análisis pre-partido** (IA existente) — `percent` + `advice`.
5. **Tablero de cuotas casa-en-vivo** — mercados de §4.1, tap → crear apuesta casa.
6. **Mercado P2P-en-vivo** — crear rápido + lista de P2P en vivo abiertas para tomar.
7. **Mercados pre-partido** (vs-casa / P2P actuales) — visibles hasta el saque; durante el juego se muestra el set en vivo.
8. **Post-partido** — tabla de estadísticas finales (ligas grandes, `event_stats`) + highlights YouTube (`strVideo`) + resultado de apuestas.

### 6.2 Endpoint de datos del panel — `app/api/events/[id]/live/route.ts` (GET público)
Devuelve el evento + `metadata.live` + apuestas en vivo abiertas. El panel hace polling
client-side ~30–60s (lee de DB, barato) para sentirse vivo entre escrituras del cron.

### 6.3 Poller en vivo — `app/api/cron/sync-live/route.ts` (nuevo, cron-job.org cada 2–3 min)
Auth `Bearer CRON_SECRET`. Por ejecución:
1. 3 llamadas `livescore/{soccer,basketball,baseball}`.
2. Para eventos con apuestas en vivo activas **o** featured-y-en-vivo:
   - Actualiza `metadata.live` (marcador, progreso, estado, `updated_at`).
   - Detecta cambio de marcador → añade snapshot (capado a ~30).
   - Recalcula `win_prob` (matemática §5).
   - Actualiza flags de suspensión (§4.1).
   - Liquida mercados P2P-en-vivo instantáneos cuya condición se cumplió/imposibilitó.
3. En transición a `finished`: dispara enriquecimiento post-partido (`event_stats`, `strVideo`)
   y el flujo existente `auto-resolve-finished` (extendido con los nuevos tipos que liquidan al final).

> Vercel Hobby sólo permite crons diarios → por eso el poller va en cron-job.org (externo),
> igual que el `sync-scores` actual.

### 6.4 Extensiones a código existente
- `lib/house-odds.ts` — nuevas funciones in-play (`calcLiveMatchWinnerOdds`, `calcLiveTotalOuOdds`, tabla béisbol).
- `app/api/bets/house/route.ts` — aceptar tipos live; validar evento en vivo + no suspendido; snapshot de cuota al momento.
- `app/api/admin/bets/auto-resolve-finished/route.ts` — ramas de resolución para tipos live que liquidan al final.
- `components/marketplace.tsx` — envolver la tarjeta con navegación a `/event/[id]` (`target="_blank"`), preservando `stopPropagation` en los botones internos ya existentes.
- `types/index.ts` — documentar nuevos `bet_type` y codificación de `selection`.

### 6.5 Modelo de datos (`events.metadata`)
```jsonc
"live": {
  "status": "2H", "progress": "67", "home_score": 1, "away_score": 0,
  "updated_at": "2026-07-26T18:44:32Z",
  "snapshots": [{ "t": "...", "minute": 24, "home": 1, "away": 0 }],
  "win_prob": { "home": 0.62, "draw": 0.23, "away": 0.15 },
  "suspended": false, "suspend_reason": null
},
"match_stats": { /* post-partido, ligas grandes */ },
"video": "https://youtube.com/..."
```

---

## 7. Análisis de costo (restricción del usuario)

- **Tokens de IA (Claude): $0 adicionales/mes.** Las cuotas in-play son matemática pura sobre
  las predicciones pre-partido ya persistidas. No hay IA por usuario ni por partido nuevo.
  El batch Haiku de predicciones existente no cambia.
- **Llamadas a TheSportsDB (no es IA):** poller = 3 llamadas/ejecución. Cada 2.5 min ≈ 24
  ejec/hora → tope teórico 24×3×24h ≈ 1.728 llamadas/día ≈ **~52k/mes**, muy por debajo del
  límite Premium. Optimización: el poller sólo ejecuta la lógica completa si hay eventos en
  vivo con apuestas. Enriquecimiento post-partido: 1–2 llamadas por evento finalizado.
- **Cómputo Vercel:** `sync-live` es liviano; invocación cada 2.5 min sin problema.

---

## 8. Fases de entrega (ordenadas por riesgo, entregan todo lo pedido)

| Fase | Alcance | Riesgo casa |
|---|---|---|
| **M1** | Pantalla `/event/[id]` + click-nueva-pestaña + panel en vivo **solo lectura** (marcador, prob, timeline, mercados existentes). Poller escribe `metadata.live`. Sin tipos nuevos aún. | Ninguno |
| **M2** | Mercados **P2P-en-vivo** (3 deportes) + liquidación en el poller. Casa = fee. | Ninguno |
| **M3** | Mercados **casa-en-vivo** (`live_match_winner` + `live_total_ou`, 3 deportes) + cuotas in-play + suspensión + topes. | Controlado |
| **M4** | Enriquecimiento post-partido (stats + highlights) + pulido visual. | Ninguno |

---

## 9. Fuera de alcance (YAGNI)

- Stream / video en vivo (no lo ofrece el proveedor).
- Estadísticas in-play (posesión, tiros) — no existen en vivo en este proveedor.
- Comentario/narración generado por IA en vivo (violaría la restricción de tokens).
- Cash-out de apuestas en vivo (fase futura, requiere modelo de valoración continua).

---

## 10. Riesgos abiertos

1. **Latencia 2–3 min en P2P `next_goal`:** mitigado con reembolso cuando ambos marcan en la
   misma ventana. Aceptable; si molesta, se sube el cron a 1 min (sigue siendo 3 llamadas/min).
2. **Ligas menores sin stats/highlights post-partido:** el panel degrada con elegancia
   (oculta secciones vacías); marcador + prob + timeline propio siempre presentes.
3. **Modelo béisbol:** varianza alta; se limita el set casa-en-vivo y se usan topes conservadores.
