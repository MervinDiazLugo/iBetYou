# iBetYou — Especificación de Negocio Completa

> Documento para Product Owner / Agent. Cubre toda la lógica de negocio necesaria para reconstruir la plataforma desde cero.

---

## 1. Visión General

**iBetYou** es una plataforma de predicciones deportivas P2P. Los usuarios crean predicciones sobre eventos deportivos reales y otros usuarios las toman, apostando el resultado contrario. También existe la modalidad "vs Casa", donde el usuario juega contra la plataforma.

- **URL producción:** https://i-bet-you.vercel.app
- **Idioma UI:** Español
- **Idioma código:** Inglés
- **Monedas:** Fantasy Tokens (juego) e iBY Coins (valor real, 1 iBY = $1 USD)
- **Deportes:** Fútbol, Basketball, Béisbol

---

## 2. Stack Técnico

| Capa | Tecnología |
|---|---|
| Framework | Next.js 14 App Router (TypeScript) |
| Base de datos | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email + password) |
| UI | Tailwind CSS + shadcn/ui |
| Deploy | Vercel (Cron Jobs nativos) |
| API deportiva | TheSportsDB Premium (key en URL para V1, header para V2) |
| Email | Resend |

---

## 3. Roles de Usuario

| Rol | Descripción |
|---|---|
| `null` (usuario normal) | Puede crear, tomar y resolver predicciones. Accede al marketplace. |
| `backoffice_admin` | Solo accede al panel `/backoffice`. No puede crear ni tomar predicciones. |

**Campo en DB:** `profiles.role` — `null` o `'backoffice_admin'`

---

## 4. Autenticación

- Supabase Auth (email/password)
- En rutas API de usuario autenticado: header `Authorization: Bearer {access_token}`
- En rutas de backoffice admin: se valida `profiles.role === 'backoffice_admin'`
- En cron jobs: header `Authorization: Bearer {CRON_SECRET}`

### Funciones helper
```
getAuthenticatedUserId(request)  → string | null
requireBackofficeAdmin(request)  → { authorized: true, userId } | { authorized: false, response: NextResponse }
```

### Login bonus
- Al hacer login, se llama `POST /api/auth/login-bonus`
- **Primera vez (welcome bonus):** $50 Fantasy Tokens si `fantasy_total_accumulated === 0`
- **Logins posteriores:** $50 por login, cap $500/día, cap acumulado $1,000 total de por vida
- Lock optimista sobre `balance_fantasy` y `fantasy_total_accumulated` para evitar doble grant
- Admins reciben $0

---

## 5. Sistema de Wallets

Tres wallets separadas por usuario:

### 5.1 Wallet Fantasy (tabla `wallets`)
| Campo | Descripción |
|---|---|
| `balance_fantasy` | Saldo Fantasy Tokens disponible |
| `balance_real` | Campo legacy (sin uso activo) |
| `fantasy_total_accumulated` | Total histórico acumulado (para cap de login bonus) |

### 5.2 Wallet iBY Real (tabla `iby_wallets`)
| Campo | Descripción |
|---|---|
| `balance` | Saldo iBY Coins |
| `balance_blocked` | Monto reservado para operaciones en curso |

- Disponible = `balance - balance_blocked`
- Requiere KYC aprobado + país habilitado para Modo Real

### 5.3 Wallet de Grupo (tabla `group_wallets`)
| Campo | Descripción |
|---|---|
| `group_id` | FK → groups |
| `user_id` | FK → profiles |
| `balance` | Saldo Fantasy dentro del grupo |
| `last_daily_grant` | Última vez que se otorgó el grant diario |

- Cada miembro recibe un **grant diario automático** de fichas al crear/tomar su primera predicción del día en el grupo
- La cantidad del grant está configurada en el grupo

### 5.4 Wallet de la Casa (tabla `house_wallet`)
| Campo | Descripción |
|---|---|
| `balance_fantasy` | Liquidez de la casa en Fantasy |
| `balance_real` | Liquidez de la casa en iBY |

---

## 6. Estructura de Transacciones

Tabla `transactions`:
| Campo | Valores típicos de `operation` |
|---|---|
| `bet_created` | Creador paga stake + fee |
| `bet_taken` | Aceptante paga stake (+ fee si P2P) |
| `bet_won` | Ganador recibe prize total |
| `house_bet_created` | Usuario paga stake vs Casa |
| `house_bet_won` | Usuario gana vs Casa |
| `house_bet_lost` | Casa retiene stake del usuario |
| `welcome_bonus` | +50 FT en registro |
| `login_bonus` | +50 FT por login |
| `group_bet_created` | Desde wallet de grupo |
| `group_bet_taken` | Desde wallet de grupo |

---

## 7. Estructura de Eventos

Tabla `events`:
| Campo | Tipo | Notas |
|---|---|---|
| `id` | int | PK auto |
| `external_id` | text | `tsdb_{idEvent}` — único |
| `sport` | text | `'football'` \| `'basketball'` \| `'baseball'` |
| `league` | text | Nombre de la liga |
| `country` | text | País de la liga |
| `home_team` / `away_team` | text | |
| `home_logo` / `away_logo` | text | URLs de TheSportsDB (dominio: `www.thesportsdb.com` o `r2.thesportsdb.com`) |
| `start_time` | timestamptz | Siempre mostrar con `timeZone: 'UTC'` |
| `status` | text | `'scheduled'` \| `'live'` \| `'finished'` \| `'postponed'` |
| `home_score` / `away_score` | int | null hasta que finalice |
| `featured` | boolean | DEFAULT false — eventos para predicciones vs Casa |
| `is_demo` | boolean | DEFAULT false — eventos del modo demo |
| `metadata` | jsonb | Ver estructura abajo |

### 7.1 Estructura de metadata
```json
{
  "venue": { "name": "Estadio X", "city": "Buenos Aires" },
  "predictions": {
    "percent": { "home": "65%", "draw": "20%", "away": "15%" },
    "advice": "River Plate to win",
    "winner": "River Plate",
    "home_league_form": "WWDLW",
    "away_league_form": "WLWDL",
    "home_goals_avg": "1.8",
    "away_goals_avg": "1.2",
    "comparison": { "attacks": { "home": "55%", "away": "45%" }, ... },
    "h2h": [{ "date": "2024-05-01", "home": "River", "away": "Boca", "home_score": 2, "away_score": 1 }]
  }
}
```

Las predicciones en `metadata.predictions` son requeridas para:
- Calcular cuotas de predicciones vs Casa
- Mostrar sección "🤖 Análisis" en el marketplace
- Marcar un evento como `featured` (no se puede featured sin predictions)

---

## 8. API Deportiva: TheSportsDB

### Versiones
- **V1:** `https://www.thesportsdb.com/api/v1/json/{API_KEY}/...` — key en URL
- **V2:** `https://www.thesportsdb.com/api/v2/json/...` — key en header `X-API-KEY`

### Endpoint de sincronización
`V1: /eventsseason.php?id={leagueId}&s={season}` — Trae TODOS los eventos de la temporada (sin cap de 15 eventos)

### Ligas configuradas (35 ligas)
**Fútbol LATAM:** Argentina Primera, Brazilian Serie A, Liga MX, Colombian Liga, Chile Primera, Venezuela Primera, Uruguay Primera, Perú Primera, Ecuador Serie A, Paraguay Primera, Bolivia Primera

**Fútbol Europa:** Premier League, La Liga, Serie A, Bundesliga, Ligue 1

**Fútbol Internacional:** Champions League, Europa League, Conference League, Copa Libertadores, Copa Sudamericana, Copa América, Euro, World Cup

**Basketball:** NBA, EuroLeague, EuroCup, FIBA World Cup, FIBA AmeriCup, LNB Argentina

**Béisbol:** MLB, NPB (Japón), KBO (Corea), Liga Mexicana, Liga Venezolana

### Mapeo de estados TSDB → internos
```
FT, AET, PEN, FT_PEN, AP, MATCH FINISHED → "finished"
1H, 2H, HT, ET, BT, P, LIVE, Q1-Q4, OT  → "live"
POSTP, CANC, SUSP, PST, ABD, WO          → "postponed"
todo lo demás                              → "scheduled"
```

### Formato de fecha TSDB
Puede venir en varios formatos — `buildStartTime()` normaliza a ISO 8601:
- `"2026-06-19 20:00:00"` → `"2026-06-19T20:00:00Z"`
- `"21:00:00+00:00"` (strTime con offset) → combinar con strDate
- `"21:00:00-07:00"` (offset negativo) → detectar con `/[+-]\d{2}:\d{2}$/`

---

## 9. Tipos de Predicción

| `bet_type` | Nombre UI | Deportes | Simétrico |
|---|---|---|---|
| `direct` | Resultado | Todos | Sí |
| `exact_score` | Marcador Exacto | Todos (no basketball en Casa) | No (asimétrico) |
| `half_time` | Medio Tiempo | Solo fútbol | Sí |
| `first_scorer` | Primer Gol | Solo fútbol | Sí |
| `run_line` | Run Line | Solo béisbol (solo MLB para Casa) | Sí |
| `total_runs` | Total Carreras | Solo béisbol | Sí |
| `score_margin` | Margen de Victoria | Solo basketball | Sí |

### 9.1 Restricciones de tiempo
- `half_time` y `first_scorer`: solo se pueden crear/tomar **antes** de que empiece el evento (`PRE_MATCH_ONLY_BET_TYPES`)
- Todos los demás: se pueden tomar hasta **10 minutos después** del inicio del evento (`ACCEPT_WINDOW_MINUTES = 10`)
- Para reportar resultado: se habilita **2 horas después** del inicio del evento

### 9.2 Selecciones por tipo

**`direct`**
- Creador elige: `"home"` | `"away"` | `"draw"`
- Aceptante recibe automáticamente el opuesto (si home → draw+away; si draw → home+away; etc.)

**`exact_score`**
- Creador elige: `"2-1"`, `"3-0"`, etc.
- Creador define multiplicador (1-100x) — apuesta asimétrica
- Aceptante paga: `amount × multiplier`, gana si el resultado NO es ese marcador
- Creador paga: `amount`, gana si el resultado ES ese marcador y cobra `amount × multiplier + amount`

**`half_time`**
- Selecciones: `"{home_team} HT"`, `"{away_team} HT"`, `"Empate HT"`

**`first_scorer`**
- Selecciones: `"{home_team}"` | `"{away_team}"`

**`run_line`** (béisbol)
- `"home_rl"`: equipo local gana por 2+ carreras
- `"away_rl"`: visitante gana o pierde por solo 1 carrera

**`total_runs`** (béisbol)
- `"over_7"` | `"under_7"` | `"over_8"` | `"under_8"` | `"over_9"` | `"under_9"` | `"over_10"` | `"under_10"`

**`score_margin`** (basketball)
- Formato: `"{team}_{range}"` donde team = `"home"` | `"away"` y range = `"1_5"` | `"6_10"` | `"11_15"` | `"16plus"`
- Ejemplo: `"home_6_10"` → Local gana por 6-10 puntos

---

## 10. Ciclo de Vida de una Predicción P2P

```
open
  ↓ alguien la toma (PATCH /api/bets/[id])
taken
  ↓ cualquier participante reporta resultado (PATCH /api/bets/[id]/resolve con action="claim_win" o "claim_lose")
pending_resolution         ← solo uno reportó
  ↓ el otro participante:
  ├─ confirm → resolved (winner_id definido, dinero se transfiere)
  └─ reject  → disputed (va a arbitraje admin)

También puede llegar a:
cancelled ← bet open no tomada después de inicio + 10min (auto-cron), o cancelación manual
disputed  ← conflicto no resuelto entre participantes
```

### 10.1 Tabla `bets` — campos clave
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | int | FK → events |
| `creator_id` | uuid | FK → profiles |
| `acceptor_id` | uuid | FK → profiles, null si nadie la tomó |
| `bet_type` | text | Ver tipos arriba |
| `type` | text | `'symmetric'` \| `'asymmetric'` (solo exact_score es asymmetric) |
| `selection` | text | JSON serializado de la selección |
| `creator_selection` | text | Valor legible de la selección del creador |
| `acceptor_selection` | text | Valor legible de la selección del aceptante |
| `amount` | numeric | Monto base |
| `multiplier` | numeric | DEFAULT 1, >1 solo en exact_score |
| `fee_amount` | numeric | Comisión pagada por el creador al crear |
| `status` | text | Ver ciclo de vida |
| `winner_id` | uuid | null hasta resolución |
| `mode` | text | `'fantasy'` \| `'real'` |
| `house_bet` | boolean | true si es vs Casa |
| `house_odds` | numeric | null si es P2P |
| `potential_payout` | numeric | Solo para house bets |
| `creator_claimed` | boolean | true si el creador ya reportó |
| `acceptor_claimed` | boolean | true si el aceptante ya reportó |
| `group_id` | uuid | null si no es predicción de grupo |
| `is_demo` | boolean | true si es predicción de demostración |
| `resolved_at` | timestamptz | Cuándo se resolvió |

---

## 11. Estructura de Fees (Comisiones P2P)

**Solo aplica en predicciones P2P (no vs Casa, no en grupos):**

- **Creador:** paga `amount × 3%` al crear → reserva `amount + fee` de su wallet
- **Aceptante:** paga `stake × 3%` al tomar → reserva `stake + fee` de su wallet
- Para exact_score: el stake del aceptante es `amount × multiplier`, así que su fee es `(amount × multiplier) × 3%`

**Premio total al ganador:**
```
totalPrize = amount + (amount × multiplier)
           = amount × (1 + multiplier)

// Para symmetric bets (multiplier=1): amount × 2
// Para exact_score: amount × (1 + multiplier)
```

Los fees NO se devuelven al cancelar — solo si la predicción nunca fue tomada el creador recupera `amount + fee` completo.

---

## 12. Invariante de Ordenamiento de Pagos

**Regla crítica: siempre actualizar el estado de la predicción en DB ANTES de mover dinero.**

```
1. UPDATE bets.status → si falla, return error (no se mueve dinero)
2. Deducir/acreditar wallets
3. INSERT en transactions
```

**Lock optimista:** las actualizaciones usan `.eq("status", expectedStatus)` como guard. Si 0 filas coinciden (concurrencia), se devuelve error 409.

Aplica en:
- `POST /api/bets/create` — bet se inserta ANTES de deducir wallet
- `PATCH /api/bets/[id]` — status cambia a "taken" ANTES de deducir wallet del aceptante
- `PATCH /api/bets/[id]/resolve` (confirm) — status cambia a "resolved" ANTES de pagar al ganador
- `POST /api/admin/bets/auto-resolve-finished` — igual

**Rollback:** si el pago falla después de cambiar el status, se revierte el status. Si el revert también falla, se loguea `PAYOUT_REVERT_FAILED` para intervención manual.

---

## 13. Predicciones vs Casa (House Bets)

Las predicciones vs Casa son instantáneas: se crean directamente en estado `"taken"`. No necesitan que otro usuario las tome.

### 13.1 Requisitos para un evento tener predicciones vs Casa
- `featured = true` en la tabla events
- `metadata.predictions.percent` presente (porcentajes home/draw/away)
- El evento no puede estar en status `finished`, `cancelled` o `postponed`
- El evento debe tener `metadata.predictions.home_goals_avg` y `away_goals_avg` para exact_score de fútbol

### 13.2 Tipos disponibles por deporte

| Deporte | Tipos disponibles |
|---|---|
| Fútbol | `direct`, `exact_score` |
| Basketball | `direct`, `score_margin` |
| Béisbol (MLB) | `direct`, `exact_score`, `run_line`, `total_runs` |
| Béisbol (no-MLB) | `direct`, `exact_score`, `total_runs` |

Detección MLB: liga contiene "mlb", "major league baseball", "american league" o "national league"

### 13.3 Cálculo de cuotas (house_odds)

**House edge:** 10% (`HOUSE_EDGE = 1.10`)

**`direct`:**
```
odds_home = 1 / (prob_home × 1.10)
odds_away = 1 / (prob_away × 1.10)
odds_draw = 1 / (prob_draw × 1.10)   // si existe
```
Bloqueado si `max(prob_home, prob_away) > 0.80` — diferencia demasiado alta

**`exact_score` fútbol:**
Distribución de Poisson con `home_goals_avg` y `away_goals_avg`:
```
prob = poissonPmf(home_goals, lambda_home) × poissonPmf(away_goals, lambda_away)
odds = min(1 / (prob × 1.10), 150)   // máximo 150x
```

**`exact_score` béisbol:** odds fijo = **15.0x**

**`run_line`:**
```
pHomeRL = prob_home × 0.68   // 68% de victorias son por 2+ carreras (MLB blowout rate)
pAwayRL = 1 - pHomeRL
odds = 1 / (prob_seleccion × 1.10)
```

**`total_runs`:** tabla fija
```
over_7: 1.40x    under_7: 2.60x
over_8: 1.65x    under_8: 2.02x
over_9: 2.27x    under_9: 1.52x
over_10: 3.03x   under_10: 1.30x
```

**`score_margin`:** tabla fija
```
1_5:    5.5x
6_10:   6.5x
11_15:  9.5x
16plus: 9.0x
```

### 13.4 Límites de exposición de la casa
```
MAX_DIRECT_EXPOSURE = 500,000 tokens
MAX_EXACT_EXPOSURE  = 200,000 tokens
```
Si `exposure_actual + riesgo_nueva_apuesta > límite` → se rechaza la predicción

### 13.5 Flujo de pago vs Casa
- Usuario paga: `stake` (sin fee adicional)
- Casa reserva: `potential_payout - stake` (riesgo de la casa)
- Si usuario gana: recibe `potential_payout`, casa paga `potential_payout - stake`
- Si usuario pierde: casa retiene `stake`

---

## 14. Flujo de Resolución Automática (Auto-Resolve)

El cron `POST /api/admin/bets/auto-resolve-finished` corre diariamente a las 3AM UTC.

Resuelve predicciones cuyo evento tiene `status = 'finished'` y `home_score`/`away_score` definidos.

### 14.1 Lógica por tipo

**`direct`:**
- Si `home_score > away_score` → ganó `"home"`
- Si `away_score > home_score` → ganó `"away"`
- Si igual → `"draw"`

**`exact_score`:**
- Si `home_score-away_score` coincide con `creator_selection` → gana el creador
- Sino → gana el aceptante (o la casa retiene si es house bet)

**`half_time`:**
- Lee `metadata.match_details.halftime_home_score` y `halftime_away_score`
- Misma lógica que direct pero con resultado al descanso

**`run_line`:**
- `"home_rl"`: gana si `home_score - away_score >= 2`
- `"away_rl"`: gana si `away_score >= home_score` o `home_score - away_score == 1`

**`total_runs`:**
- Total = `home_score + away_score`
- `"over_N"`: gana si total > N
- `"under_N"`: gana si total < N

**`score_margin`:**
- Si team = "home": diff = `home_score - away_score` (positivo si ganó local)
- Si team = "away": diff = `away_score - home_score`
- `"1_5"`: 1 ≤ diff ≤ 5; `"6_10"`: 6 ≤ diff ≤ 10; `"11_15"`: 11 ≤ diff ≤ 15; `"16plus"`: diff ≥ 16
- Si diff ≤ 0 (no ganó), pierde

**`first_scorer`:** no tiene auto-resolve (requiere datos de primer gol no disponibles en score final)

### 14.2 Resultado de auto-resolve
- Si se puede determinar ganador → `status = 'resolved'`, se paga
- Si hay conflicto o no se puede determinar → `status = 'disputed'` para revisión manual

---

## 15. Arbitraje y Registro de Decisiones

Tabla `arbitration_decisions`:
| Campo | Tipo | Descripción |
|---|---|---|
| `bet_id` | uuid | FK → bets |
| `action` | text | Ver tabla de acciones |
| `previous_status` | text | Estado antes de la acción |
| `new_status` | text | Estado después |
| `decided_winner_id` | uuid | null si cancelación |
| `reason` | text | Descripción legible |
| `details` | jsonb | Contexto extra |
| `decided_by` | text | UUID del usuario o `'system'` |

### Acciones registradas
| `action` | Cuándo |
|---|---|
| `participant_claim` | Participante reporta claim_win o claim_lose |
| `participant_reject_to_dispute` | Participante rechaza → disputed |
| `participant_confirm` | Participante confirma → resolved |
| `resolve` | Admin resuelve manualmente |
| `cancel` | Admin cancela |
| `dispute` | Admin envía a disputa |
| `approve_pending` | Admin aprueba resolución pendiente |
| `auto_resolve_finished_{type}` | Cron resuelve por score final |
| `auto_resolve_disputed_direct` | Auto-resolución de disputa directa |
| `false_claim_penalty` | Penalización por falsa reclamación |

---

## 16. Sistema de Notificaciones

Tabla `notifications`:
| Campo | Tipo |
|---|---|
| `user_id` | uuid |
| `type` | text — ver tipos abajo |
| `title` | text |
| `body` | text |
| `bet_id` | uuid nullable |
| `mode` | text — `'fantasy'` \| `'real'` |
| `read` | boolean DEFAULT false |

**Tipos:** `bet_created`, `bet_taken`, `result_reported`, `bet_resolved_win`, `bet_resolved_loss`, `bet_disputed`, `bet_cancelled`, `referral_registered`, `referral_bonus_unlocked`, `withdrawal_approved`, `withdrawal_rejected`

**Realtime:** La tabla `notifications` debe estar habilitada en la publicación `supabase_realtime` para que el badge de la campana se actualice en tiempo real sin polling.

---

## 17. Sistema de Referidos

### Reglas
- Cada usuario tiene un `referral_code` único (8 chars hex uppercase)
- Al registrarse con código de referido → se crea bono de $50 FT para **ambos** (referrer y referee)
- El bono está **bloqueado** hasta completar wagering = `50 × 15 = 750 tokens` en predicciones de ≥10 tokens
- Anti-fraude: no auto-referido, no referido circular, no doble referido, máximo 50 referidos por usuario

### Tabla `referral_bonuses`
| Campo | Descripción |
|---|---|
| `beneficiary_id` | Quién recibe el bono |
| `referrer_id` | Quien compartió el código |
| `referee_id` | Quien usó el código |
| `bonus_amount` | 50 FT |
| `wagering_required` | 750 FT |
| `wagering_progress` | Cuánto lleva |
| `status` | `'locked'` \| `'unlocked'` \| `'claimed'` |

El wagering progress se actualiza cada vez que el usuario participa en una predicción resuelta de ≥10 tokens.

---

## 18. Sistema de Grupos

Los grupos permiten predicciones entre amigos con una wallet separada.

### Tabla `groups`
| Campo | Descripción |
|---|---|
| `id` | uuid PK |
| `name` | Nombre del grupo |
| `code` | Código de invitación (8 chars) |
| `creator_id` | uuid FK → profiles |
| `sport` | Filtro de deporte (`null` = todos) |
| `leagues` | Array de ligas permitidas (`[]` = todas) |
| `status` | `'active'` \| `'archived'` |

### Tabla `group_members`
| Campo | Descripción |
|---|---|
| `group_id` | FK → groups |
| `user_id` | FK → profiles |
| `role` | `'admin'` \| `'member'` |

### Tabla `group_wallets`
| Campo | Descripción |
|---|---|
| `group_id` | FK |
| `user_id` | FK |
| `balance` | Saldo en el grupo |
| `last_daily_grant` | Fecha del último grant automático |

### Reglas de negocio de grupos
- Predicciones en grupos usan `mode = 'fantasy'` siempre (sin modo real)
- No tienen fee (fee = 0)
- Grant diario automático por miembro al crear/tomar primera predicción del día
- Solo miembros del grupo pueden ver y tomar predicciones del grupo
- Los eventos deben coincidir con el sport/league configurado en el grupo
- Los grupos pueden tener leaderboard interno

---

## 19. Modo Demo

El modo demo muestra eventos y predicciones ficticias para todos los usuarios mientras está activo.

### Cómo funciona
1. Admin activa demo desde `/backoffice/demo`
2. El sistema selecciona 16 eventos reales próximos de la DB y los marca como `is_demo = true`
3. Se generan predicciones de demostración (`is_demo = true`) de cada tipo disponible por deporte
4. El marketplace muestra un banner amarillo y solo eventos demo para todos
5. Los usuarios pueden predecir con sus Fantasy Tokens normales en eventos demo
6. Los eventos demo se crean con `start_time = now() + 2 horas` para no expirar

### Cron `demo-refresh` (3:30 AM UTC)
- Si demo está activo: genera resultados sintéticos para los eventos demo actuales, resuelve las predicciones, activa 16 nuevos eventos demo para el día siguiente

### Al desactivar demo
- Se limpian los eventos demo
- Las predicciones abiertas de demo se cancelan
- El marketplace vuelve a mostrar todos los eventos normales

### Comportamiento especial de eventos demo
- Saltan la validación de tiempo (no importa si el evento "ya empezó")
- Si un evento demo llega a status `finished`, se auto-resetea a `scheduled` para que sigan admitiendo predicciones
- Las predicciones vs Casa también funcionan en eventos demo

---

## 20. Leaderboard

`GET /api/stats` devuelve clasificaciones por:
- **Ganancias netas** (ganado − perdido)
- **Predicciones participadas** (total de predicciones resueltas)
- **Tasa de victorias** (% de predicciones ganadas, mínimo 3 para aparecer)

Cubre las últimas 2 semanas. Solo predicciones resueltas (no demo).

---

## 21. Control de Acceso por País

Tabla `country_access` (o `iby_settings`):
- Cada país puede tener habilitado/deshabilitado por separado:
  - **Modo Real** (iBY Coins)
  - **Predicciones vs Casa Fantasy**
  - **Predicciones vs Casa Real**

Funciones:
```
canCountryUseRealMoney(country) → boolean
canCountryUseHouseBetting(country, mode) → boolean
```

---

## 22. KYC (Know Your Customer)

Campo `profiles.kyc_status`: `'none'` | `'pending'` | `'approved'` | `'rejected'`

- Solo usuarios con `kyc_status = 'approved'` pueden usar Modo Real
- El proceso KYC se gestiona desde backoffice
- Los retiros en iBY real requieren KYC aprobado

---

## 23. Sistema iBY Real (Dinero Real)

### Depósitos
- Tabla `iby_deposit_requests`: usuario solicita depósito con `amount` y `bank_account`
- Admin revisa y aprueba/rechaza desde backoffice
- Al aprobar, se acredita en `iby_wallets.balance`

### Retiros
- Tabla `withdrawals`: usuario solicita retiro con `amount` y método de pago
- Admin revisa y aprueba/rechaza
- Al aprobar, se debita de `iby_wallets.balance`
- Requiere KYC aprobado

### Cuentas bancarias de la plataforma
Tabla `iby_deposit_accounts`: las cuentas donde los usuarios deben hacer sus depósitos.

---

## 24. Cron Jobs

| Ruta | Schedule | Descripción |
|---|---|---|
| `/api/cron/sync-events` | 5:00 AM UTC diario | Sincroniza eventos de las próximas 24h desde TheSportsDB para todas las ligas configuradas |
| `/api/cron/auto-featured` | 12:00 PM UTC diario | Auto-marca eventos como `featured=true` si tienen predicciones en metadata (y los desmarca si no las tienen) |
| `/api/cron/auto-bets` | 12:30 PM UTC diario | Crea automáticamente predicciones vs Casa para todos los eventos featured |
| `/api/cron/auto-resolve` | 3:00 AM UTC diario | Dispara auto-resolución de predicciones cuyos eventos ya finalizaron |
| `/api/cron/demo-refresh` | 3:30 AM UTC diario | Rota eventos demo si el modo demo está activo |
| `/api/cron/sync-scores` | Cada 2h (cron-job.org externo) | Actualiza scores de eventos live o recién finalizados desde api-sports.io y dispara auto-resolve |
| `/api/cron/sync-predictions` | Configurable | Sincroniza predicciones de IA para eventos featured |

**Autenticación cron:** Header `Authorization: Bearer {CRON_SECRET}`

---

## 25. Panel Backoffice

Ruta protegida `/backoffice` — solo `backoffice_admin`.

### Módulos

**Dashboard `/backoffice`**
- Métricas: predicciones abiertas/tomadas/resueltas/disputadas, usuarios activos, volumen en Fantasy e iBY

**Eventos `/backoffice/events`**
- Listar, buscar, importar desde TheSportsDB, destacar/destastar (featured), sincronizar score individual, eliminar
- Botón ⭐ para marcar como featured
- Botón "Limpiar eventos sin predicciones"
- Botón "Deduplicar eventos"

**Moderación de Predicciones `/backoffice/bets`**
- Listar con filtros por status, sport, bet_type, mode
- Acciones por predicción: resolver, cancelar, enviar a disputa, aprobar pendiente
- Auto-resolver predicciones de marcador exacto
- Auto-resolver predicciones en disputa
- Sincronizar score de evento
- Limpiar predicciones abiertas fuera de tiempo

**Usuarios `/backoffice/users`**
- Listar usuarios, buscar, banear/desbanear, bloquear de predicciones temporalmente
- Editar wallet Fantasy e iBY manualmente
- Ver historial de predicciones del usuario
- Penalizar por falsa reclamación (marca `betting_blocked_until`)

**Wallets `/backoffice/wallets`**
- Gestionar wallets de usuarios (editar saldo directamente)

**House Wallet `/backoffice/house-wallet`**
- Ver balance de la casa en Fantasy e iBY
- Ver predicciones activas vs Casa agrupadas por selección
- Configurar `max_bet_amount` (límite P2P) y `max_bet_amount_house` (límite vs Casa)

**Demo `/backoffice/demo`**
- Activar/desactivar modo demo
- Ver estado actual y estadísticas

**Países `/backoffice/countries`**
- Habilitar/deshabilitar acceso por país para Modo Real y predicciones vs Casa

**Depósitos iBY `/backoffice/iby`**
- Revisar solicitudes de depósito
- Aprobar/rechazar
- Configurar cuentas bancarias de la plataforma

**Retiros `/backoffice/withdrawals`**
- Revisar solicitudes de retiro
- Aprobar/rechazar

**Referidos `/backoffice/referrals`**
- Ver estadísticas del sistema de referidos

**Auditoría `/backoffice/audit`**
- Log de todas las acciones del sistema

**Simulación `/backoffice/simulation`**
- Herramienta para simular escenarios de predicciones y estimar exposición de la casa

---

## 26. Catálogo de Endpoints API

### Públicos (no requieren auth)
```
GET  /api/events/list              — Eventos disponibles (marketplace)
GET  /api/bets                     — Predicciones abiertas del marketplace
GET  /api/stats                    — Leaderboard
GET  /api/demo-status              — Estado del modo demo
GET  /api/settings                 — Límites públicos de la plataforma
```

### Autenticados (usuario)
```
POST /api/bets/create              — Crear predicción P2P
GET  /api/bets/[id]                — Detalle de predicción
PATCH /api/bets/[id]               — Tomar predicción (action = accept)
PATCH /api/bets/[id]/resolve       — Reportar/confirmar/rechazar resultado
POST /api/bets/[id]/retract        — Retractarse (si era el creador y no fue tomada)
GET  /api/bets/[id]/clone          — Datos para clonar predicción
POST /api/bets/house               — Crear predicción vs Casa
GET  /api/bets/house/odds          — Consultar cuotas actuales de un evento
POST /api/auth/login-bonus         — Reclamar bono de login
GET  /api/my-bets                  — Predicciones del usuario autenticado
GET  /api/wallet                   — Balance de wallet
GET  /api/user/balance             — Historial de ganancias/pérdidas
GET  /api/user/info                — Perfil + balance combinados
GET  /api/user/profile             — Actualizar perfil
GET  /api/referrals/me             — Estado de mis referidos y bonos
GET  /api/notifications            — Notificaciones del usuario
POST /api/withdrawals              — Solicitar retiro iBY
GET  /api/iby/wallet               — Balance iBY del usuario
POST /api/iby/deposit-requests     — Solicitar depósito iBY
GET  /api/groups                   — Grupos del usuario
POST /api/groups                   — Crear grupo
GET  /api/groups/[id]              — Detalle de grupo
GET  /api/groups/[id]/bets         — Predicciones del grupo
POST /api/groups/[id]/bets         — Crear predicción en grupo
PATCH /api/groups/[id]/bets/[bid]  — Tomar predicción en grupo
POST /api/groups/[id]/invite       — Invitar miembro
POST /api/groups/[id]/join         — Unirse al grupo
POST /api/groups/join              — Unirse con código
GET  /api/groups/[id]/leaderboard  — Ranking del grupo
```

### Admin (requieren `backoffice_admin`)
```
GET  /api/admin/events             — Listar eventos
POST /api/admin/events             — Importar eventos desde TSDB
PATCH /api/admin/events            — Editar evento (featured, etc.)
DELETE /api/admin/events           — Eliminar evento
PATCH /api/admin/events/results    — Sincronizar score de evento
GET  /api/admin/bets               — Listar predicciones
PATCH /api/admin/bets              — Resolver/cancelar/disputar predicción
POST /api/admin/bets               — Auto-resolver predicciones
POST /api/admin/bets/auto-resolve-finished  — Auto-resolve por score final
POST /api/admin/bets/auto-resolve-disputed  — Auto-resolve disputas
GET  /api/admin/users              — Listar usuarios
PATCH /api/admin/users             — Editar usuario (ban, role, etc.)
GET  /api/admin/wallets            — Gestionar wallets
PATCH /api/admin/wallets           — Editar balance de wallet
GET  /api/admin/metrics            — Métricas del dashboard
GET  /api/admin/house-wallet       — Balance de la casa
GET  /api/admin/referrals          — Estadísticas de referidos
GET  /api/admin/countries          — Configuración de acceso por país
PATCH /api/admin/countries         — Actualizar acceso por país
GET  /api/admin/iby/accounts       — Cuentas bancarias de depósito
POST /api/admin/iby/accounts       — Crear cuenta bancaria
PATCH /api/admin/iby/deposit-requests/[id] — Aprobar/rechazar depósito
PATCH /api/admin/withdrawals/[id]  — Aprobar/rechazar retiro
GET  /api/admin/audit              — Log de auditoría
POST /api/admin/demo               — Activar/desactivar modo demo
POST /api/admin/simulation/generate — Simular escenario
GET  /api/admin/metrics            — Métricas globales
```

### Cron (requieren `CRON_SECRET`)
```
GET  /api/cron/sync-events         — Sincronizar eventos
GET  /api/cron/sync-scores         — Actualizar scores
GET  /api/cron/auto-resolve        — Auto-resolver predicciones finalizadas
GET  /api/cron/auto-featured       — Auto-marcar eventos featured
GET  /api/cron/auto-bets           — Crear predicciones vs Casa automáticamente
GET  /api/cron/demo-refresh        — Rotar demo diario
GET  /api/cron/sync-predictions    — Sincronizar predicciones de IA
```

---

## 27. Tablas de Base de Datos

### `events` — ya documentada en sección 7

### `bets` — ya documentada en sección 10

### `profiles`
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | = auth.users.id |
| `email` | text | |
| `nickname` | text | |
| `role` | text | null \| 'backoffice_admin' |
| `kyc_status` | text | 'none' \| 'pending' \| 'approved' \| 'rejected' |
| `is_banned` | boolean | Usuario baneado globalmente |
| `betting_blocked_until` | timestamptz | Bloqueo temporal de predicciones |
| `country` | text | Código ISO del país |
| `referral_code` | text | Código único 8 chars |
| `referred_by` | uuid | FK → profiles |
| `referral_count` | int | Cuántos referidos tiene |
| `max_referrals` | int | DEFAULT 50 |
| `real_betting_enabled` | boolean | DEFAULT true |

### `wallets` — ya documentada en sección 5.1

### `iby_wallets` — ya documentada en sección 5.2

### `group_wallets` — ya documentada en sección 5.3

### `house_wallet` — ya documentada en sección 5.4

### `transactions` — ya documentada en sección 6

### `notifications` — ya documentada en sección 16

### `arbitration_decisions` — ya documentada en sección 15

### `referral_bonuses` — ya documentada en sección 17

### `groups` / `group_members` — ya documentadas en sección 18

### `daily_rewards`
| Campo | Descripción |
|---|---|
| `user_id` | FK → profiles |
| `reward_amount` | Monto del bono |
| `rewarded_at` | Timestamp |

### `country_access`
| Campo | Descripción |
|---|---|
| `country` | Código ISO |
| `real_money_enabled` | boolean |
| `house_betting_fantasy_enabled` | boolean |
| `house_betting_real_enabled` | boolean |

### `iby_settings`
Key-value store para configuración de la plataforma:
| `key` | `value` | Descripción |
|---|---|---|
| `max_bet_amount` | número | Límite por predicción P2P |
| `max_bet_amount_house` | número | Límite por predicción vs Casa |
| `demo_mode` | 'true'/'false' | Estado del modo demo |

### `withdrawals`
| Campo | Descripción |
|---|---|
| `user_id` | FK → profiles |
| `amount` | Monto solicitado |
| `status` | 'pending' \| 'approved' \| 'rejected' |
| `payment_method` | Método de pago |
| `payment_details` | Datos del destinatario |

### `iby_deposit_requests`
| Campo | Descripción |
|---|---|
| `user_id` | FK → profiles |
| `amount` | Monto del depósito |
| `status` | 'pending' \| 'approved' \| 'rejected' |
| `bank_account_id` | FK → iby_deposit_accounts |

---

## 28. Variables de Entorno Requeridas

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# TheSportsDB Premium
THESPORTSDB_API_KEY              # para V1 (key en URL) y V2 (header X-API-KEY)

# Cron jobs y tareas automáticas
CRON_SECRET                      # Bearer token para /api/cron/*

# Comunicación
RESEND_API_KEY                   # Emails transaccionales

# Seguridad API
NEXT_PUBLIC_API_KEY              # Key pública para algunas operaciones
CLEANUP_API_SECRET               # Para endpoints de limpieza manual
```

---

## 29. Supabase: Requisitos de Infraestructura

### Realtime
La tabla `notifications` debe estar en la publicación `supabase_realtime`:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
```

### Row Level Security (RLS)
- Las operaciones de negocio usan `createAdminSupabaseClient()` (service role) — bypassa RLS
- El browser client sí respeta RLS

### Índices recomendados
```sql
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_event_id ON bets(event_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_arbitration_bet_id ON arbitration_decisions(bet_id);
```

### RPC Functions requeridas
```sql
-- Para referidos (atomic increment)
CREATE FUNCTION increment_referral_count(p_user_id uuid) ...

-- Para bonus referidos locked en wallet iBY
CREATE FUNCTION increment_referral_bonus_locked_ibc(p_user_id uuid, p_amount numeric) ...
```

---

## 30. Reglas de Negocio Críticas (No Obvias)

1. **Admins no pueden predecir:** `profiles.role === 'backoffice_admin'` bloquea crear/tomar/clonar predicciones

2. **Saldo insuficiente → ban automático:** si alguien intenta crear predicción sin saldo suficiente, se banea automáticamente (`profiles.is_banned = true`). Esto se revierte desde backoffice.

3. **Concurrencia con optimistic lock:** nunca usar `UPDATE ... WHERE id = X` sin verificar el estado esperado. Siempre agregar `.eq("status", "expected_status")` y verificar que se afectaron filas.

4. **Eventos no finalizados no se resuelven:** el auto-resolve solo actúa cuando `events.status = 'finished'` Y `home_score` y `away_score` son no-null.

5. **featured = true requiere predictions en metadata:** el cron `auto-featured` verifica esto. No se puede marcar featured manualmente sin tener predictions.

6. **Predicciones vs Casa están en status 'taken' desde el inicio:** a diferencia de P2P que empiezan en 'open', las house bets se insertan directamente como 'taken'.

7. **El fee no se devuelve al cancelar:** si una predicción se cancela en estado 'open', el creador recupera `amount + fee` completo. Si se cancela después de ser tomada, ambos recuperan lo que pusieron (amount para creador, stake para aceptante), pero los fees ya fueron pagados y quedan en la plataforma.

8. **Demo mode auto-reset:** los eventos demo en status 'finished' se resetean automáticamente a 'scheduled' cuando se intenta crear una predicción vs Casa en ellos.

9. **Predicciones de grupo sin fee:** las predicciones dentro de un grupo no cobran el 3% de fee.

10. **Lock de reporte de resultado:** el reporte de resultado solo se habilita 2 horas después del inicio del evento. Antes no se puede reportar.

11. **Wagering para referidos cuenta solo predicciones ≥10 tokens** y solo predicciones resueltas (no canceladas).

12. **Cuotas directas bloqueadas cuando diferencia es muy alta:** si la probabilidad del favorito supera 80%, no se ofrecen predicciones directas vs Casa para ese evento (el underdog tendría odds demasiado altos = riesgo excesivo para la casa).

---

## 31. Flujo Completo de una Predicción P2P (Paso a Paso)

```
1. Usuario A ve evento en marketplace
2. A abre "Crear Predicción"
3. A selecciona: evento, tipo, selección, monto
4. Frontend calcula: fee = monto × 3%, totalNeeded = monto + fee
5. Frontend verifica balance > totalNeeded
6. POST /api/bets/create:
   a. Validar JWT
   b. Validar evento existe y no está postponed
   c. Validar tipo de apuesta permitida para el deporte
   d. Validar restricciones de tiempo (pre-match only si aplica)
   e. Validar perfil: no baneado, no admin, no bloqueado
   f. Validar modo real: país habilitado, cuenta habilitada
   g. INSERT bet con status='open'  ← PRIMERO
   h. UPDATE wallet - totalNeeded    ← DESPUÉS
   i. INSERT transaction
   j. CREATE notification

7. Usuario B ve la predicción en marketplace
8. B hace clic en "Tomar Predicción"
9. PATCH /api/bets/[id] (tomar):
   a. Validar bet status = 'open'
   b. Validar tiempo: dentro de acceptance window (10 min después de inicio)
   c. Validar B no es el creador
   d. Calcular stake del aceptante (= amount para symmetric, = amount×multiplier para exact_score)
   e. UPDATE bet status='taken', acceptor_id=B  ← PRIMERO (optimistic lock)
   f. UPDATE wallet de B - (stake + fee)         ← DESPUÉS
   g. INSERT transaction
   h. NOTIFY A "tu predicción fue tomada"

10. Evento sucede en el mundo real

11. A o B (2h después del inicio del evento):
    PATCH /api/bets/[id]/resolve con action='claim_win' o 'claim_lose':
    a. Validar bet status = 'taken'
    b. Validar que ya pasaron 2h
    c. UPDATE bet status='pending_resolution', winner_id=X  ← PRIMERO (optimistic lock)
    d. NOTIFY otro participante "tu rival reportó resultado"
    e. INSERT arbitration_decision (participant_claim)

12. El otro participante:
    a. confirm: UPDATE bet status='resolved' ← PRIMERO
               payoutToMode(winner, totalPrize)  ← DESPUÉS
               NOTIFY ambos
               INSERT arbitration_decision (participant_confirm)
    
    b. reject:  UPDATE bet status='disputed'
               NOTIFY ambos "en disputa"
               INSERT arbitration_decision (participant_reject_to_dispute)

13. Si disputed → Admin resuelve desde backoffice
    O auto-resolve cron verifica score del evento y resuelve automáticamente
```

---

## 32. Flujo Completo de Predicción vs Casa

```
1. Usuario ve evento featured en marketplace
2. Hace clic en tipo de predicción vs Casa
3. Selecciona selección y monto
4. Frontend consulta GET /api/bets/house/odds para ver cuota actual
5. POST /api/bets/house:
   a. Validar JWT
   b. Validar evento: featured=true o is_demo=true
   c. Validar tipo permitido para el deporte (y para MLB en run_line)
   d. Calcular houseOdds según tipo y metadata
   e. Verificar bloqueo por prob > 80% (para direct)
   f. Verificar exposición < límite
   g. Verificar balance usuario ≥ stake
   h. INSERT bet status='taken', house_bet=true, house_odds=X, potential_payout=Y  ← PRIMERO
   i. UPDATE user wallet - stake (optimistic lock)  ← DESPUÉS
   j. houseWalletDebit(potential_payout - stake)    ← RESERVAR RIESGO CASA
   k. INSERT transaction
   l. NOTIFY usuario

6. Cron auto-resolve (3AM UTC):
   a. Busca house bets en status='taken' para eventos finished
   b. Determina ganador por lógica del tipo
   c. Si usuario ganó:
      - UPDATE bet status='resolved', winner_id=user
      - payoutToMode(user, potential_payout)
      - houseWalletCredit(potential_payout - stake)  ← liberar (ya no la casa perdió ese riesgo)
      - WAIT: actually houseWalletCredit += stake del usuario (el stake va a la casa)
   d. Si usuario perdió:
      - UPDATE bet status='resolved', winner_id=null (casa ganó)
      - houseWalletCredit(stake)  ← casa gana el stake del usuario
```

---

## 33. Páginas del Frontend

| Ruta | Descripción |
|---|---|
| `/` | Marketplace público: eventos + predicciones abiertas P2P + predicciones vs Casa |
| `/login` | Login con email/password |
| `/register` | Registro + selección de nickname + código referido opcional |
| `/my-bets` | Predicciones del usuario (creadas y tomadas) |
| `/bet/[id]` | Detalle de predicción: ver, resolver, disputar, cancelar |
| `/balance` | Historial de ganancias/pérdidas |
| `/leaderboard` | Ranking global |
| `/profile` | Perfil y configuración |
| `/como-jugar` | Guía explicativa de tipos de predicción |
| `/my-referrals` | Estado de referidos y bonos |
| `/groups` | Listado de grupos del usuario |
| `/groups/[id]` | Detalle de grupo: predicciones, ranking, miembros |
| `/create` | Alias para crear predicción |
| `/backoffice` | Dashboard admin |
| `/backoffice/events` | Gestión de eventos |
| `/backoffice/bets` | Moderación de predicciones |
| `/backoffice/users` | Gestión de usuarios |
| `/backoffice/wallets` | Gestión de wallets |
| `/backoffice/house-wallet` | Wallet de la casa |
| `/backoffice/demo` | Control del modo demo |
| `/backoffice/countries` | Control de acceso por país |
| `/backoffice/iby` | Depósitos/retiros iBY |

---

## 34. Componentes Clave del Frontend

| Componente | Descripción |
|---|---|
| `Navbar` | Navegación principal: logo, mis predicciones, crear predicción, balance, notificaciones |
| `Marketplace` | Componente principal de la home: tabs por deporte, predicciones disponibles, predicciones vs Casa |
| `CreateBetForm` | Modal para crear predicción P2P: selector de evento, tipo, selección con logos, monto |
| `ModeProvider` | Context global para modo Fantasy/Real |
| `useToast` | Sistema de toasts (no usar window.alert/confirm) |
| `NotificationBell` | Badge de notificaciones en tiempo real via Supabase Realtime |

### Reglas UI críticas
- **Nunca** `window.confirm()`, `alert()` o `prompt()` — siempre modales con estado
- Siempre mostrar fechas con `timeZone: 'UTC'`
- Siempre usar `formatCurrency(amount)` de `@/lib/utils` para montos
- Toasts: `showToast('mensaje', 'success' | 'error' | 'info')`
- Idioma UI: español (labels, toasts, errores al usuario)

---

## 35. Configuración de Next.js

### `next.config.ts` — dominios permitidos para imágenes
```typescript
images: {
  remotePatterns: [
    { protocol: "https", hostname: "www.thesportsdb.com" },
    { protocol: "https", hostname: "r2.thesportsdb.com" },  // CDN logos
  ]
}
```

### `vercel.json` — cron jobs
```json
{
  "crons": [
    { "path": "/api/cron/sync-events",        "schedule": "0 5 * * *" },
    { "path": "/api/cron/auto-featured",      "schedule": "0 12 * * *" },
    { "path": "/api/cron/auto-bets",          "schedule": "30 12 * * *" },
    { "path": "/api/cron/auto-resolve",       "schedule": "0 3 * * *" },
    { "path": "/api/cron/demo-refresh",       "schedule": "30 3 * * *" }
  ]
}
```

El cron `/api/cron/sync-scores` corre cada 2h pero desde **cron-job.org** (externo a Vercel), no en `vercel.json`.

---

*Fin del documento — generado el 2026-06-19 desde el código fuente de iBetYou*
