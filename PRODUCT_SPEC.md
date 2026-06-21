# iBetYou — Especificación de Producto

> Documento para Product Owner y agentes de construcción. Describe toda la lógica de negocio sin referencias a implementación actual. El agente constructor debe derivar su propia arquitectura técnica a partir de este documento.

---

## 1. Visión del Producto

**iBetYou** es una plataforma de predicciones deportivas P2P. Los usuarios crean predicciones sobre eventos deportivos reales; otros usuarios toman la posición contraria. También existe la modalidad **vs Casa**, donde el usuario juega directamente contra la plataforma con cuotas calculadas automáticamente.

### Principios de diseño
- No hay casa tradicional tomando margen en P2P — el pozo íntegro va al ganador (menos fees de plataforma)
- Las predicciones son simétricas: si alguien predice que A gana, el oponente predice automáticamente que B gana o empata
- La plataforma solo gana dinero via fees de servicio (P2P) y margen de casa (vs Casa)
- Toda la lógica de negocio vive en el servidor — el frontend solo renderiza

### URLs y acceso
- Plataforma principal: acceso público para ver eventos, requiere registro para predecir
- Panel de administración: ruta protegida solo para administradores

### Idioma
- UI: español
- Código y base de datos: inglés

---

## 2. Deportes y Cobertura

| Deporte | Tipos de predicción disponibles |
|---|---|
| Fútbol | Resultado, Marcador Exacto, Medio Tiempo, Primer Gol |
| Basketball | Resultado, Margen de Victoria |
| Béisbol | Resultado, Marcador Exacto, Run Line, Total Carreras |

### Ligas cubiertas
**Fútbol LATAM:** Argentina Primera División, Brazilian Serie A, Liga MX, Liga de Colombia, Chile Primera, Venezuela Primera, Uruguay Primera, Perú Primera, Ecuador Serie A, Paraguay Primera, Bolivia Primera

**Fútbol Europa:** Premier League, La Liga, Serie A, Bundesliga, Ligue 1

**Fútbol Internacional:** Champions League, Europa League, Conference League, Copa Libertadores, Copa Sudamericana, Copa América, Eurocopa, World Cup

**Basketball:** NBA, EuroLeague, EuroCup, FIBA World Cup, FIBA AmeriCup, Liga Nacional Argentina (LNB)

**Béisbol:** MLB, NPB (Japón), KBO (Corea), Liga Mexicana de Béisbol, Liga Venezolana de Béisbol Profesional

---

## 3. Monedas y Modos de Juego

La plataforma opera con dos monedas paralelas:

| Moneda | Nombre | Valor | Uso |
|---|---|---|---|
| Fantasy Tokens (FT) | Fichas de juego | Sin valor real | Modo Fantasy — todos los usuarios |
| iBY Coins (iBY) | Moneda real | 1 iBY = 1 USD | Modo Real — requiere KYC + país habilitado |

Ambas monedas corren en paralelo. Una predicción se crea en **un solo modo** (no mezcla).

---

## 4. Roles de Usuario

| Rol | Puede predecir | Accede a backoffice | Recibe bonos |
|---|---|---|---|
| Usuario normal | ✅ | ❌ | ✅ |
| Administrador de backoffice | ❌ | ✅ | ❌ |

Los administradores no pueden crear, tomar, ni clonar predicciones. Tampoco reciben bonos de login ni referidos.

---

## 5. Registro y Autenticación

### Flujo de registro
1. Usuario ingresa email y contraseña
2. Elige un nickname único
3. Opcionalmente ingresa un código de referido
4. Se crea su wallet Fantasy con saldo 0
5. Al primer login, recibe bono de bienvenida

### Bono de login diario
- **Primera vez (bienvenida):** 50 Fantasy Tokens, otorgado una sola vez
- **Logins posteriores:** 50 FT por login
- **Cap diario:** máximo 500 FT en un mismo día calendario
- **Cap de por vida:** máximo 1.000 FT acumulados en total vía login bonus
- Los administradores reciben 0 FT

### Ejemplo de bono de login
```
Usuario con 400 FT acumulados de vida, no ha recibido bonus hoy:
→ Recibe: min(50, 500-0, 1000-400) = 50 FT
→ Total acumulado: 450 FT

Usuario con 980 FT acumulados de vida:
→ Recibe: min(50, 500-0, 1000-980) = 20 FT (limitado por cap de vida)
```

---

## 6. Wallets

Cada usuario tiene wallets separadas:

### 6.1 Wallet Fantasy
- `saldo_fantasy`: saldo disponible en Fantasy Tokens
- `total_acumulado`: suma histórica total recibida (para limitar el bono de login)

### 6.2 Wallet iBY (Modo Real)
- `saldo`: saldo total en iBY Coins
- `saldo_bloqueado`: monto reservado por operaciones en curso
- `disponible = saldo - saldo_bloqueado`
- Requiere depósito previo aprobado por admin

### 6.3 Wallet de Grupo
- Una wallet separada por grupo, por usuario
- Se nutre de grants diarios automáticos (no del saldo principal del usuario)
- Solo se usa para predicciones dentro de ese grupo específico

### 6.4 Wallet de la Casa
- Wallet propia de la plataforma, separada Fantasy e iBY
- Se debita cuando la casa asume riesgo en una predicción vs Casa
- Se acredita cuando el usuario pierde una predicción vs Casa

---

## 7. Sistema de Transacciones

Toda operación monetaria genera un registro de transacción con:
- A quién pertenece
- Tipo de moneda (fantasy / iBY / group_fantasy)
- Monto (positivo = ingreso, negativo = egreso)
- Tipo de operación
- Referencia (ID de predicción si aplica)

| Tipo de operación | Descripción |
|---|---|
| `welcome_bonus` | Bono de bienvenida primer login |
| `login_bonus` | Bono por login diario |
| `bet_created` | Creador reserva stake + fee |
| `bet_taken` | Aceptante reserva stake + fee |
| `bet_won` | Ganador recibe el pozo total |
| `house_bet_created` | Usuario pone stake vs Casa |
| `house_bet_won` | Usuario gana vs Casa |
| `house_bet_lost` | Casa retiene stake del usuario |
| `group_bet_created` | Predicción en grupo (desde wallet de grupo) |
| `group_bet_taken` | Tomar predicción en grupo |
| `deposit` | Depósito iBY aprobado |
| `withdrawal` | Retiro iBY aprobado |

---

## 8. Estructura de un Evento Deportivo

Un evento es un partido entre dos equipos con:

| Campo | Descripción | Ejemplo |
|---|---|---|
| Identificador externo | ID único de la API deportiva | `tsdb_1234567` |
| Deporte | football / basketball / baseball | `football` |
| Liga | Nombre de la competición | `Premier League` |
| País | País de la liga | `England` |
| Equipo local | Nombre | `Arsenal` |
| Equipo visitante | Nombre | `Chelsea` |
| Logo local / visitante | URL de imagen | `https://...` |
| Inicio | Fecha y hora en UTC | `2026-07-01T20:00:00Z` |
| Estado | scheduled / live / finished / postponed | `scheduled` |
| Marcador local / visitante | null hasta que finalice | `2 / 1` |
| Destacado (featured) | Si acepta predicciones vs Casa | `true` |
| Es demo | Si es un evento de demostración | `false` |
| Metadata | Datos adicionales (estadio, análisis) | ver abajo |

### Estructura de metadata
```
metadata:
  venue:
    name: "Emirates Stadium"
    city: "London"
  
  predictions:
    percent:
      home: "65%"
      draw: "20%"
      away: "15%"
    advice: "Arsenal to win"
    winner: "Arsenal"
    home_league_form: "WWDLW"    ← últimos 5 partidos locales
    away_league_form: "WLWDL"
    home_goals_avg: "1.8"        ← promedio de goles por partido
    away_goals_avg: "1.2"
    comparison:
      attacks: { home: "55%", away: "45%" }
      defense: { home: "60%", away: "40%" }
    h2h:                          ← historial de enfrentamientos
      - date: "2024-05-01"
        home: "Arsenal"
        away: "Chelsea"
        home_score: 2
        away_score: 1
```

Las predictions en metadata son necesarias para:
- Calcular cuotas de predicciones vs Casa
- Mostrar el análisis de IA en el marketplace
- Marcar un evento como destacado (featured)

**Regla:** No se puede marcar un evento como `featured = true` si no tiene `metadata.predictions` completo.

---

## 9. Sincronización de Eventos desde la API Deportiva

La plataforma usa **TheSportsDB Premium** como fuente de datos deportivos.

### Sincronización diaria (5AM UTC)
- Se consulta el calendario de cada liga configurada
- Solo se insertan eventos de las próximas 7 días
- Nunca se sobreescriben campos ya editados manualmente (como `featured`)
- Si el evento ya existe (por ID externo), se ignora

### Sincronización de scores (cada 2 horas)
- Se actualizan marcadores de eventos en estado `live` o recién `finished`
- Si un evento pasa a `finished` con marcadores definidos, se dispara auto-resolución de predicciones

### Mapeo de estados de la API → estados internos
```
FT, AET, PEN, MATCH FINISHED → "finished"
1H, 2H, HT, LIVE, Q1, Q2, Q3, Q4 → "live"
POSTP, CANC, SUSP → "postponed"
todo lo demás → "scheduled"
```

---

## 10. Tipos de Predicción: Reglas y Selecciones

### 10.1 Resultado (`direct`)
"¿Quién gana el partido?"

**Selecciones disponibles:**
- `home` — Gana el equipo local
- `away` — Gana el equipo visitante
- `draw` — Empate

**Mecánica:**
- El creador elige una opción
- El aceptante apuesta automáticamente por "no ocurre eso" (el resto de opciones)
- Ambos ponen el mismo monto

**Ejemplo:**
```
Creador elige: Arsenal gana (home)
Aceptante recibe: Chelsea gana o empate (draw + away)
Stake: 100 FT cada uno
Pozo total: 200 FT → al ganador
```

### 10.2 Marcador Exacto (`exact_score`)
"¿Cuál será el marcador final?"

**Selecciones:** cualquier marcador formato `"2-1"`, `"0-0"`, `"3-2"`, etc.

**Mecánica asimétrica:**
- El creador elige el marcador exacto Y un multiplicador (entre 1x y 100x)
- El creador paga: `monto_base`
- El aceptante paga: `monto_base × multiplicador` (más riesgo para compensar la baja probabilidad)
- Si el marcador es exactamente ese: gana el creador y recibe `monto_base + monto_base × multiplicador`
- Si el marcador es cualquier otro: gana el aceptante

**Ejemplo:**
```
Creador: Arsenal 2-1 con multiplicador 5x, monto 100 FT
Aceptante pone: 100 × 5 = 500 FT

Si sale 2-1: Creador gana 600 FT (100 + 500)
Si sale cualquier otro: Aceptante gana 600 FT
```

### 10.3 Medio Tiempo (`half_time`)
"¿Quién va ganando al final del primer tiempo?"

**Solo disponible en fútbol.**
**Restricción de tiempo:** solo se puede crear/tomar ANTES de que inicie el partido.

**Selecciones:**
- `"{equipo_local} HT"` → Local va ganando al descanso
- `"{equipo_visitante} HT"` → Visitante va ganando al descanso
- `"Empate HT"` → Empate al descanso

### 10.4 Primer Gol (`first_scorer`)
"¿Qué equipo anota primero?"

**Solo disponible en fútbol.**
**Restricción de tiempo:** solo se puede crear/tomar ANTES de que inicie el partido.

**Selecciones:**
- Nombre del equipo local
- Nombre del equipo visitante

### 10.5 Run Line (`run_line`)
"¿Ganará el favorito por 2+ carreras o el partido será cerrado?"

**Solo disponible en béisbol.**

**Selecciones:**
- `home_rl` → Local gana por 2 o más carreras
- `away_rl` → Visitante gana el partido, o local gana por solo 1 carrera

**Ejemplo:**
```
Pittsburgh Pirates vs Chicago Cubs
Creador: Pirates gana por 2+ (home_rl)
Aceptante: Cubs gana o Pirates gana por 1 (away_rl)
```

### 10.6 Total de Carreras (`total_runs`)
"¿Cuántas carreras totales se anotarán?"

**Solo disponible en béisbol.**

**Selecciones disponibles:**
- `over_7` / `under_7`
- `over_8` / `under_8`
- `over_9` / `under_9`
- `over_10` / `under_10`

**Mecánica:** Total = carreras del local + carreras del visitante. Over gana si es estrictamente mayor, Under gana si es estrictamente menor.

### 10.7 Margen de Victoria (`score_margin`)
"¿Por cuántos puntos ganará un equipo?"

**Solo disponible en basketball.**

**Selecciones formato:** `"{equipo}_{rango}"` donde equipo = `home` o `away`

| Selección | Significado |
|---|---|
| `home_1_5` | Local gana por 1 a 5 puntos |
| `home_6_10` | Local gana por 6 a 10 puntos |
| `home_11_15` | Local gana por 11 a 15 puntos |
| `home_16plus` | Local gana por 16+ puntos |
| `away_1_5` | Visitante gana por 1 a 5 puntos |
| (igual para away) | ... |

Si el equipo elegido pierde (diferencia negativa), la predicción pierde.

---

## 11. Restricciones de Tiempo para Predicciones

| Tipo | Cuándo se puede crear | Cuándo se puede tomar |
|---|---|---|
| `direct` | Antes del inicio | Hasta 10 min después del inicio |
| `exact_score` | Antes del inicio | Hasta 10 min después del inicio |
| `run_line` | Antes del inicio | Hasta 10 min después del inicio |
| `total_runs` | Antes del inicio | Hasta 10 min después del inicio |
| `score_margin` | Antes del inicio | Hasta 10 min después del inicio |
| `half_time` | **Estrictamente antes del inicio** | **Estrictamente antes del inicio** |
| `first_scorer` | **Estrictamente antes del inicio** | **Estrictamente antes del inicio** |

**Ventana de reporte de resultado:** los participantes pueden reportar el resultado solo a partir de **2 horas después** del inicio del evento, independientemente del estado real del partido.

---

## 12. Ciclo de Vida de una Predicción P2P

```
OPEN (abierta)
  │
  │  Alguien la toma (dentro de la ventana de tiempo)
  ▼
TAKEN (en curso)
  │
  │  Cualquier participante reporta resultado
  │  (mínimo 2h después del inicio del evento)
  ▼
PENDING_RESOLUTION (esperando confirmación)
  │
  ├──► Otro participante CONFIRMA → RESOLVED ✅ (dinero al ganador)
  │
  └──► Otro participante RECHAZA → DISPUTED ⚠️ (va a arbitraje)

Desde cualquier estado previo a RESOLVED:
  └──► Admin cancela → CANCELLED ❌ (se reembolsan los stakes sin fees)
```

### Sub-estados de resolución pendiente
Para mayor trazabilidad, se distingue quién reportó primero:
- `pending_resolution_creator` — solo el creador reportó
- `pending_resolution_acceptor` — solo el aceptante reportó
- Cuando ambas partes confirman el mismo resultado: `resolved`

---

## 13. Estructura de Fees (Comisiones)

### Predicciones P2P
| Quién paga | Cuánto | Cuándo |
|---|---|---|
| Creador | 3% del monto base | Al crear la predicción |
| Aceptante | 3% del stake del aceptante | Al tomar la predicción |

**El fee no se devuelve al cancelar.** Si la predicción se cancela antes de ser tomada, el creador recupera `monto + fee`. Si se cancela después de ser tomada (casos excepcionales), cada parte recupera su stake pero el fee ya se pagó.

**Caso asimétrico (exact_score):**
```
Monto base: 100 FT, multiplicador: 5x
Creador paga: 100 FT + (100 × 3%) = 103 FT
Aceptante paga: 500 FT + (500 × 3%) = 515 FT
Pozo al ganador: 100 + 500 = 600 FT
```

### Predicciones vs Casa
- **Sin fee adicional** — la plataforma gana via el margen integrado en las cuotas (10%)

### Predicciones de Grupo
- **Sin fee** — las predicciones dentro de grupos no cobran comisión

---

## 14. Invariante Crítico de Pagos

> **Nunca mover dinero sin antes actualizar el estado de la predicción en la base de datos.**

El orden SIEMPRE debe ser:
```
1. Registrar / actualizar estado de la predicción en DB
   └── Si esto falla → return error, no se mueve dinero

2. Actualizar saldo en wallet
   └── Si esto falla → revertir el estado de la predicción

3. Registrar transacción
```

Este invariante aplica en:
- Crear predicción (insertar antes de debitar)
- Tomar predicción (cambiar a "taken" antes de debitar al aceptante)
- Resolver predicción (cambiar a "resolved" antes de pagar al ganador)
- Predicciones vs Casa (insertar antes de debitar)

**Bloqueo contra concurrencia:** al cambiar estado de la predicción, se verifica que el estado anterior sea exactamente el esperado. Si dos usuarios intentan tomar la misma predicción simultáneamente, solo uno lo logra (el otro recibe error 409).

---

## 15. Predicciones vs Casa (House Bets)

### Requisitos para que un evento admita predicciones vs Casa
1. Debe estar marcado como `featured = true`
2. Debe tener `metadata.predictions.percent` con probabilidades home/draw/away
3. No puede estar en estado `finished`, `cancelled` o `postponed`
4. Para marcador exacto (fútbol): necesita `home_goals_avg` y `away_goals_avg`

### Tipos disponibles por deporte y liga

**Fútbol:** Resultado (`direct`), Marcador Exacto (`exact_score`)

**Basketball:** Resultado (`direct`), Margen de Victoria (`score_margin`)

**Béisbol MLB (Major League Baseball):** Resultado (`direct`), Marcador Exacto (`exact_score`), Run Line (`run_line`), Total Carreras (`total_runs`)

**Béisbol no-MLB:** Resultado (`direct`), Marcador Exacto (`exact_score`), Total Carreras (`total_runs`)

Detección MLB: si el nombre de la liga contiene "mlb", "major league baseball", "american league" o "national league".

### Flujo de predicción vs Casa
1. Usuario elige tipo y selección
2. Sistema calcula cuota (house_odds) automáticamente
3. Si la cuota es válida y hay liquidez en la casa, la predicción se crea directamente en estado **TAKEN** (no necesita que otro usuario la tome)
4. Usuario paga el stake inmediatamente
5. La casa reserva su posible pérdida (potential_payout - stake)
6. La predicción se resuelve automáticamente cuando el evento finaliza

---

## 16. Cálculo de Cuotas vs Casa

La casa aplica un **margen del 10%** sobre todas las cuotas.

### Resultado (`direct`)
```
Cuota local = 1 / (probabilidad_local × 1.10)
Cuota visita = 1 / (probabilidad_visita × 1.10)
Cuota empate = 1 / (probabilidad_empate × 1.10)

Ejemplo:
prob_local=65%, prob_visita=15%, prob_empate=20%
→ cuota_local = 1 / (0.65 × 1.10) = 1.40x
→ cuota_visita = 1 / (0.15 × 1.10) = 6.06x
→ cuota_empate = 1 / (0.20 × 1.10) = 4.55x
```

**Bloqueo:** si la probabilidad del favorito supera el 80%, no se ofrecen predicciones directas vs Casa para ese evento (el underdog tendría cuota demasiado alta = riesgo excesivo para la casa).

### Marcador Exacto — Fútbol
Usa distribución de Poisson con el promedio de goles:
```
prob(marcador X-Y) = poisson(X, lambda_local) × poisson(Y, lambda_visita)
cuota = min(1 / (prob × 1.10), 150)   ← máximo 150x

Ejemplo: lambda_local=1.8, lambda_visita=1.2
Para marcador 2-1:
  poisson(2, 1.8) ≈ 0.269
  poisson(1, 1.2) ≈ 0.361
  prob ≈ 0.097
  cuota = 1 / (0.097 × 1.10) ≈ 9.37x
```

### Marcador Exacto — Béisbol
Cuota fija: **15.0x** (béisbol tiene alta varianza de marcadores)

### Run Line — Béisbol
```
Tasa de victorias por paliza en MLB: ~68% de las victorias son por 2+ carreras

prob_home_rl = probabilidad_local × 0.68
prob_away_rl = 1 - prob_home_rl

cuota = 1 / (prob × 1.10)

Ejemplo: probabilidad_local = 60%
prob_home_rl = 0.60 × 0.68 = 0.408
cuota_home_rl = 1 / (0.408 × 1.10) = 2.23x
cuota_away_rl = 1 / (0.592 × 1.10) = 1.54x
```

### Total de Carreras — Béisbol (cuotas fijas)
| Selección | Cuota |
|---|---|
| over_7 | 1.40x |
| under_7 | 2.60x |
| over_8 | 1.65x |
| under_8 | 2.02x |
| over_9 | 2.27x |
| under_9 | 1.52x |
| over_10 | 3.03x |
| under_10 | 1.30x |

### Margen de Victoria — Basketball (cuotas fijas)
| Rango | Cuota (para cualquier equipo) |
|---|---|
| 1-5 puntos | 5.5x |
| 6-10 puntos | 6.5x |
| 11-15 puntos | 9.5x |
| 16+ puntos | 9.0x |

### Límites de exposición de la casa
```
Exposición máxima directa (direct, run_line): 500.000 tokens
Exposición máxima exacta (exact_score, otros): 200.000 tokens
```

Si el riesgo acumulado de la casa en una selección ya superó el límite, la predicción se rechaza ("La casa ha alcanzado el límite de exposición para esta selección").

### Ejemplo de pago vs Casa
```
Stake del usuario: 100 FT
Cuota calculada: 2.50x
Pago potencial: 250 FT

Si el usuario gana:
  → Usuario recibe 250 FT
  → La casa pierde 150 FT (250 - 100)

Si el usuario pierde:
  → La casa gana 100 FT (el stake)
```

---

## 17. Resolución Automática (Auto-Resolve)

Cuando un evento pasa a `finished` con marcadores definidos, el sistema resuelve automáticamente las predicciones P2P y vs Casa asociadas.

### Lógica por tipo

**Resultado (`direct`):**
```
si home_score > away_score → ganó "home"
si away_score > home_score → ganó "away"
si home_score == away_score → ganó "draw"
```

**Marcador Exacto (`exact_score`):**
```
si marcador_final == creator_selection → gana el creador
de lo contrario → gana el aceptante (o la casa retiene el stake en house bet)
```

**Medio Tiempo (`half_time`):**
```
Usa metadata.predictions.halftime_home_score y halftime_away_score
(misma lógica que direct pero con marcador del primer tiempo)
```

**Run Line (`run_line`):**
```
diferencia = home_score - away_score

"home_rl" gana si diferencia >= 2
"away_rl" gana si diferencia <= 1 (o visitante gana)
```

**Total de Carreras (`total_runs`):**
```
total = home_score + away_score

"over_N" gana si total > N
"under_N" gana si total < N
```

**Margen de Victoria (`score_margin`):**
```
diferencia_local = home_score - away_score
diferencia_visita = away_score - home_score

"home_1_5" gana si 1 <= diferencia_local <= 5
"home_6_10" gana si 6 <= diferencia_local <= 10
"home_11_15" gana si 11 <= diferencia_local <= 15
"home_16plus" gana si diferencia_local >= 16
(igual para away con diferencia_visita)

Si el equipo elegido no ganó (diferencia <= 0): pierde
```

**Primer Gol (`first_scorer`):** **No tiene auto-resolve.** Requiere datos del primer gol que no están disponibles en el score final. Debe resolverse manualmente por el árbitro o por los participantes.

### Cuando no se puede auto-resolver
Si el tipo no es soportado, si hay empate en tipo que no admite empate, o si los datos son insuficientes → la predicción pasa a estado `disputed` para revisión manual.

---

## 18. Arbitraje y Registro de Decisiones

Toda acción sobre una predicción queda registrada con:
- ID de la predicción
- Acción tomada (ver tabla abajo)
- Estado anterior y estado nuevo
- Ganador determinado (si aplica)
- Razón en texto legible
- Quién decidió (ID del usuario o "system")

### Tabla de acciones registradas

| Acción | Cuándo ocurre |
|---|---|
| `participant_claim` | Un participante reporta ganar o perder |
| `participant_confirm` | El otro participante confirma → predicción resuelta |
| `participant_reject_to_dispute` | El otro participante rechaza → predicción disputada |
| `resolve` | Admin resuelve manualmente |
| `cancel` | Admin cancela |
| `dispute` | Admin envía a disputa |
| `approve_pending` | Admin aprueba resolución pendiente |
| `auto_resolve_finished_direct` | Sistema resuelve predicción directa por score |
| `auto_resolve_finished_exact_score` | Sistema resuelve marcador exacto |
| `auto_resolve_finished_run_line` | Sistema resuelve run line |
| `auto_resolve_finished_total_runs` | Sistema resuelve total de carreras |
| `auto_resolve_finished_score_margin` | Sistema resuelve margen de victoria |
| `auto_resolve_finished_half_time` | Sistema resuelve medio tiempo |
| `auto_resolve_disputed` | Sistema resuelve disputa automáticamente |
| `false_claim_penalty` | Admin penaliza por falsa reclamación |

---

## 19. Sistema de Notificaciones

Cada usuario tiene un buzón de notificaciones con:
- Título corto
- Descripción
- Referencia a la predicción (si aplica)
- Modo (fantasy/real) — para mostrar el contexto correcto
- Estado de lectura (leída / no leída)

Las notificaciones se entregan en **tiempo real** (sin polling) usando suscripciones de base de datos.

### Eventos que generan notificaciones

| Tipo | Para quién | Cuándo |
|---|---|---|
| `bet_created` | Creador | Al crear predicción |
| `bet_taken` | Creador | Alguien tomó su predicción |
| `result_reported` | El otro participante | Su rival reportó un resultado |
| `bet_resolved_win` | Ganador | Predicción resuelta, ganaste |
| `bet_resolved_loss` | Perdedor | Predicción resuelta, perdiste |
| `bet_disputed` | Ambos | Predicción enviada a disputa |
| `bet_cancelled` | Participantes | Predicción cancelada |
| `referral_registered` | Quien compartió código | Nuevo usuario registrado via tu código |
| `referral_bonus_unlocked` | Beneficiario | Tu bono de referido fue desbloqueado |
| `withdrawal_approved` | Usuario | Retiro aprobado |
| `withdrawal_rejected` | Usuario | Retiro rechazado |

---

## 20. Sistema de Referidos

### Mecánica
1. Cada usuario tiene un código de referido único (8 caracteres alfanuméricos en mayúscula)
2. Al registrarse con el código de otro usuario, ambos reciben un **bono bloqueado de 50 FT**
3. El bono se desbloquea cuando el beneficiario acumula **750 FT en wagering** (apuestas de 10+ FT en predicciones resueltas)
4. Máximo 50 referidos por usuario (configurable por admin)

### Cálculo de wagering
```
wagering_required = bono × 15 = 50 × 15 = 750 FT

Se cuenta: participar en predicciones resueltas con monto >= 10 FT
No se cuenta: predicciones canceladas, predicciones de menos de 10 FT
```

### Anti-fraude
- No se puede referir a uno mismo
- No se puede referir a alguien que te refirió a ti (referido circular)
- Un usuario solo puede tener un referidor
- Si el código es inválido, se ignora silenciosamente (no falla el registro)

### Ejemplo
```
Ana comparte su código → código: "A3F7B2C9"
Juan se registra con ese código

→ Ana recibe: 50 FT bloqueados (necesita 750 FT de wagering para desbloquear)
→ Juan recibe: 50 FT bloqueados (necesita 750 FT de wagering)

Juan predice 100 FT en predicciones que se resuelven:
→ Su wagering_progress pasa de 0 a 100

Cuando Juan llega a 750 FT de wagering:
→ Sus 50 FT se desbloquean y puede usarlos
→ Ana también recibe notificación cuando sus propios 750 FT se completan
```

---

## 21. Sistema de Grupos

Los grupos permiten predicciones privadas entre amigos o comunidades.

### Características de un grupo
- **Nombre** y **código de invitación** único (8 chars)
- **Filtro de deporte** (opcional): solo predicciones de ese deporte
- **Filtro de ligas** (opcional): solo predicciones de esas ligas
- **Estado**: activo o archivado
- **Roles**: admin (creador) y miembro

### Wallet de grupo
- Cada miembro tiene una wallet **separada** dentro del grupo
- El saldo del grupo **no está conectado** al saldo principal del usuario
- Los miembros reciben un **grant diario automático** de fichas la primera vez que crean o toman una predicción del día en ese grupo
- La cantidad del grant es configurable por el admin del grupo

### Reglas de predicciones en grupos
- Solo los miembros del grupo pueden ver y tomar predicciones del grupo
- No hay fee (0% de comisión)
- Siempre en modo Fantasy (nunca modo Real)
- Los eventos deben coincidir con el sport/liga configurado en el grupo (si hay filtro)
- El pozo se paga en tokens del grupo, no en el saldo principal

### Leaderboard de grupo
- Ranking interno de quién ganó más dentro del grupo

---

## 22. Modo Demo

El modo demo muestra un entorno de prueba para todos los usuarios mientras está activo.

### Al activar
1. Se seleccionan 16 eventos reales próximos de la base de datos
2. Se marcan como `is_demo = true`
3. Se les asigna una hora de inicio = "ahora + 2 horas" para que no expiren rápido
4. Se crean predicciones de demostración de cada tipo disponible por deporte
5. El marketplace muestra un banner informativo y solo muestra los eventos demo

### Mientras está activo
- Los usuarios pueden predecir normalmente con sus Fantasy Tokens reales
- Los eventos demo saltan las restricciones de tiempo (no importa si el evento "ya empezó")
- Si un evento demo llega a estado `finished`, se resetea automáticamente a `scheduled` para seguir aceptando predicciones

### Rotación diaria (3:30 AM UTC)
Si el modo demo está activo:
1. Se generan resultados sintéticos para los eventos demo del día anterior
2. Se resuelven todas las predicciones demo pendientes
3. Se activan 16 nuevos eventos demo para el siguiente día

### Al desactivar
1. Los eventos demo se eliminan o demarcan
2. Las predicciones demo abiertas se cancelan
3. El marketplace vuelve a mostrar todos los eventos normales

---

## 23. Marketplace (Pantalla Principal)

El marketplace es la pantalla de inicio con:

### Secciones
1. **Banner demo** (si está activo) — aviso de que es un entorno de prueba
2. **Eventos destacados** — eventos con `featured = true`, con sección de predicciones vs Casa
3. **Tabs por deporte** — Fútbol / Basketball / Béisbol
4. **Por cada deporte:**
   - Eventos disponibles con sus predicciones abiertas P2P
   - Para eventos featured: tabs de tipos de predicción vs Casa con cuotas en tiempo real
5. **"Mis predicciones en curso"** — predicciones del usuario autenticado en estado taken/pending

### Visualización de predicciones abiertas P2P
Cada predicción muestra:
- Tipo de predicción con ícono
- Selección del creador (en texto legible, no en código interno)
- Monto y potencial retorno
- Creador (nickname)
- Botón "Tomar predicción" (deshabilitado si ya fue tomada, si es propia, o si venció la ventana)

### Análisis de IA (sección "🤖 Análisis")
Para eventos featured que tienen predictions en metadata:
- Porcentajes de probabilidad (home/draw/away)
- Consejo del sistema ("Arsenal to win")
- Forma reciente de cada equipo
- Historial de enfrentamientos (H2H)
- Promedios de goles

---

## 24. Flujo de Creación de Predicción P2P (Perspectiva Usuario)

```
1. Usuario hace clic en "Crear Predicción"

2. Selector de deporte (Fútbol / Basketball / Béisbol)

3. Lista de eventos disponibles para ese deporte
   → Filtrable por nombre de equipo
   → Solo eventos scheduled o live dentro de la ventana

4. Selección del tipo de predicción
   → Se muestran solo los tipos válidos para ese deporte
   → Cada tipo tiene ícono, nombre y descripción corta

5. Selección de la predicción concreta
   → Para "direct": 3 cards con logos de equipos (local / empate / visita)
   → Para "half_time": 3 cards con logos
   → Para "first_scorer": 2 cards con logos
   → Para "run_line": 2 cards descriptivas
   → Para "total_runs": 8 opciones (over/under × 4 valores)
   → Para "score_margin": cards por equipo × 4 rangos
   → Para "exact_score": input de marcador + selector de multiplicador

6. Monto en tokens
   → Limitado por saldo disponible
   → Limitado por configuración máxima de la plataforma
   → Se muestra en tiempo real: fee, total a reservar, potencial ganancia

7. Confirmar → se descuenta de wallet y la predicción aparece en marketplace
```

---

## 25. Controles de Seguridad y Validaciones

### Al crear predicción (verificaciones en servidor)
- Evento existe y no está postponed
- Tipo de predicción válido para el deporte
- Si es half_time o first_scorer: evento no ha iniciado
- Si es otro tipo: evento inició hace menos de 10 minutos (o aún no inició)
- Usuario no está baneado
- Usuario no es admin
- Usuario no está en período de bloqueo temporal (betting_blocked_until)
- Si modo real: país habilitado para modo real + cuenta habilitada para real
- Saldo suficiente
- Monto no supera el límite máximo de la plataforma

### Al tomar predicción
- Predicción está en estado open
- No es el propio creador tomando su predicción
- Ventana de tiempo no venció
- Usuario no está baneado
- Saldo suficiente
- Si es predicción de grupo: usuario es miembro del grupo

### Saldo insuficiente → ban automático
Si un usuario intenta crear o tomar una predicción sin saldo suficiente, **se banea automáticamente**. Esto protege contra race conditions donde el saldo es drenado entre la verificación y la operación. El admin puede levantar el ban desde backoffice.

---

## 26. Panel de Administración (Backoffice)

### Módulo: Dashboard
- Métricas en tiempo real: predicciones abiertas, tomadas, resueltas, disputadas
- Volumen en Fantasy Tokens e iBY Coins
- Usuarios activos
- Balance de la casa

### Módulo: Eventos
- Listar eventos con filtros (sport, status, featured, fecha)
- Importar eventos desde la API deportiva (TheSportsDB) por liga o fecha
- Marcar/desmarcar como featured (⭐)
- Sincronizar score individual de un evento
- Eliminar eventos antiguos sin predicciones
- Detectar y deduplicar eventos duplicados

### Módulo: Moderación de Predicciones
- Listar predicciones con filtros (status, sport, tipo, modo, creador)
- Por predicción: ver detalle completo, historial de decisiones
- Acciones disponibles:
  - **Resolver**: elegir ganador manualmente y razón
  - **Cancelar**: cancelar con razón (reembolsa stakes, retiene fees)
  - **Enviar a disputa**: para revisión más detallada
  - **Aprobar pendiente**: confirmar resolución que requiere aprobación admin
- **Auto-resolver lote**: ejecutar auto-resolve para todas las predicciones de eventos finalizados
- **Limpiar predicciones expiradas**: cancelar predicciones open que ya vencieron la ventana de tiempo

### Módulo: Usuarios
- Listar con búsqueda (email, nickname)
- Ver perfil completo y todas sus predicciones
- **Banear / desbanear** (bloqueo global)
- **Bloqueo temporal de predicciones** (betting_blocked_until)
- **Editar saldo** de wallet Fantasy o iBY
- **Cambiar rol** (hacer/quitar admin)
- **Penalizar** por falsa reclamación (registra en historial)

### Módulo: Wallet de la Casa
- Ver balance fantasy e iBY
- Ver predicciones activas vs Casa agrupadas por selección (para ver exposición)
- Configurar límite máximo de predicción P2P
- Configurar límite máximo de predicción vs Casa

### Módulo: Demo
- Activar / desactivar modo demo
- Ver estado actual: cuántos eventos demo, cuántas predicciones demo
- Ver resultado de la última rotación

### Módulo: Países
- Habilitar/deshabilitar por país:
  - Modo Real (iBY Coins)
  - Predicciones vs Casa en Fantasy
  - Predicciones vs Casa en Real

### Módulo: Depósitos iBY
- Ver solicitudes de depósito pendientes
- Aprobar: acredita iBY al usuario
- Rechazar: notifica al usuario
- Gestionar cuentas bancarias de la plataforma (donde los usuarios deben depositar)

### Módulo: Retiros
- Ver solicitudes de retiro pendientes
- Aprobar: debita iBY del usuario, se procesa pago externo
- Rechazar: notifica al usuario

### Módulo: Referidos
- Estadísticas globales: total de referidos, bonos pendientes, bonos desbloqueados

### Módulo: Auditoría
- Log de todas las operaciones del sistema con timestamp

### Módulo: Simulación
- Herramienta interna para simular escenarios: calcular exposición estimada de la casa bajo distintos escenarios de predicciones

---

## 27. Cron Jobs (Tareas Programadas)

| Tarea | Horario | Qué hace |
|---|---|---|
| Sincronizar eventos | 5:00 AM UTC diario | Importa eventos de las próximas 7 días de todas las ligas configuradas |
| Auto-destacar eventos | 12:00 PM UTC diario | Marca como featured los eventos con predictions en metadata; desmarca los que perdieron predictions |
| Auto-crear predicciones vs Casa | 12:30 PM UTC diario | Crea predicciones vs Casa (de todos los tipos válidos) para cada evento featured |
| Auto-resolver predicciones | 3:00 AM UTC diario | Resuelve predicciones P2P y vs Casa de eventos que finalizaron |
| Rotar demo | 3:30 AM UTC diario | Si demo activo: genera resultados sintéticos y rota los 16 eventos demo |
| Actualizar scores | Cada 2 horas (externo) | Actualiza marcadores de partidos live o recién terminados; dispara auto-resolve |
| Sincronizar predictions de IA | Configurable | Actualiza metadata.predictions con datos frescos de la API deportiva |

---

## 28. KYC (Verificación de Identidad)

Requerido para usar Modo Real (iBY Coins).

| Estado | Descripción |
|---|---|
| `none` | Usuario no ha iniciado proceso |
| `pending` | Documentación enviada, en revisión |
| `approved` | Verificado, puede usar Modo Real |
| `rejected` | Rechazado, no puede usar Modo Real |

El proceso de revisión se gestiona desde el backoffice (admin aprueba/rechaza).

---

## 29. Modelo de Datos: Entidades Principales

### Usuario
```
id: uuid (= ID de autenticación)
email: string
nickname: string (único)
avatar_url: string | null
rol: null | "backoffice_admin"
kyc_status: "none" | "pending" | "approved" | "rejected"
pais: string | null
es_baneado: boolean
bloqueado_hasta: timestamp | null
codigo_referido: string (8 chars, único)
referido_por: uuid | null
cantidad_referidos: int
max_referidos: int (default 50)
modo_real_habilitado: boolean
creado_en: timestamp
```

### Evento
```
id: int (auto)
id_externo: string (único, ej: "tsdb_7654321")
deporte: "football" | "basketball" | "baseball"
liga: string
pais: string
equipo_local: string
equipo_visita: string
logo_local: string | null
logo_visita: string | null
inicio: timestamp
estado: "scheduled" | "live" | "finished" | "postponed"
goles_local: int | null
goles_visita: int | null
destacado: boolean
es_demo: boolean
metadata: jsonb
```

### Predicción
```
id: uuid
id_evento: int → Evento
id_creador: uuid → Usuario
id_aceptante: uuid | null → Usuario
tipo: "symmetric" | "asymmetric"
tipo_prediccion: "direct" | "exact_score" | "half_time" | "first_scorer" | "run_line" | "total_runs" | "score_margin"
seleccion_creador: string (texto legible)
seleccion_aceptante: string | null
monto: decimal
multiplicador: decimal (1 para simétricas)
fee_monto: decimal
estado: "open" | "taken" | "pending_resolution" | "pending_resolution_creator" | "pending_resolution_acceptor" | "resolved" | "cancelled" | "disputed"
id_ganador: uuid | null
modo: "fantasy" | "real"
es_house_bet: boolean
cuota_house: decimal | null
pago_potencial: decimal | null
creador_reporto: boolean
aceptante_reporto: boolean
id_grupo: uuid | null
es_demo: boolean
creado_en: timestamp
resuelto_en: timestamp | null
```

### Transacción
```
id: uuid
id_usuario: uuid
tipo_token: "fantasy" | "iBY" | "group_fantasy"
monto: decimal (negativo = débito, positivo = crédito)
operacion: string (ver tabla de tipos)
id_referencia: uuid | null (ID de predicción si aplica)
creado_en: timestamp
```

### Notificación
```
id: uuid
id_usuario: uuid
tipo: string (ver tipos de notificación)
titulo: string
descripcion: string
id_prediccion: uuid | null
modo: "fantasy" | "real" | null
leida: boolean
creado_en: timestamp
```

### Decisión de Arbitraje
```
id: uuid
id_prediccion: uuid
accion: string (ver tabla de acciones)
estado_anterior: string
estado_nuevo: string
id_ganador_decidido: uuid | null
razon: string
detalles: jsonb
decidido_por: string (uuid de usuario o "system")
creado_en: timestamp
```

### Bono de Referido
```
id: uuid
id_beneficiario: uuid
id_referidor: uuid
id_referido: uuid
monto_bono: decimal (50 FT)
wagering_requerido: decimal (750 FT)
wagering_progreso: decimal
estado: "locked" | "unlocked" | "claimed"
creado_en: timestamp
desbloqueado_en: timestamp | null
```

### Grupo
```
id: uuid
nombre: string
codigo: string (8 chars, único)
id_creador: uuid
deporte: "football" | "basketball" | "baseball" | null
ligas: string[] (vacío = todas)
estado: "active" | "archived"
creado_en: timestamp
```

### Miembro de Grupo
```
id_grupo: uuid
id_usuario: uuid
rol: "admin" | "member"
unido_en: timestamp
```

### Wallet de Grupo
```
id_grupo: uuid
id_usuario: uuid
saldo: decimal
ultimo_grant_diario: date | null
```

### Configuración de la Plataforma (key-value)
```
clave: string
valor: string | number | boolean

Claves conocidas:
  max_bet_amount         → límite máximo por predicción P2P
  max_bet_amount_house   → límite máximo por predicción vs Casa
  demo_mode              → "true" | "false"
```

---

## 30. Reglas de Negocio No Obvias (Must-Know)

1. **Predicciones van directamente a "taken" en vs Casa:** a diferencia de P2P (que empiezan en "open" y esperan aceptante), las predicciones vs Casa se insertan directamente como "taken".

2. **Saldo insuficiente bana automáticamente:** si alguien intenta crear/tomar sin saldo, se banea automáticamente. Esto protege contra race conditions. El admin puede desbanear.

3. **Lock de concurrencia:** la transición de estado de la predicción actúa como lock optimista. Si dos usuarios toman la misma predicción simultáneamente, solo uno gana; el otro recibe error de conflicto y la predicción ya está tomada.

4. **Fee no se devuelve:** el fee es de servicio, no de depósito. Al cancelar, el creador recupera su stake pero el fee queda en la plataforma. Al aceptar y luego cancelar (raro, solo admin), cada quien recupera su stake pero pierde el fee.

5. **Reporte de resultado bloqueado hasta 2h después del inicio:** incluso si el partido terminó antes (ej. en 90 min), el sistema no permite reportar hasta que pasen 2h del inicio nominal del evento.

6. **Eventos demo ignoran restricciones de tiempo:** los eventos demo siempre aceptan predicciones y se resetean a "scheduled" si llegaron a "finished".

7. **Run line solo para MLB en vs Casa:** el tipo run_line está disponible en béisbol P2P para cualquier liga, pero en vs Casa solo para ligas MLB.

8. **Bloqueo por probabilidad alta (direct vs Casa):** si la probabilidad del favorito supera 80%, no se ofrecen predicciones directas vs Casa. El underdog tendría cuota >5.68x, creando riesgo excesivo para la casa a bajo volumen.

9. **Predicciones de grupo sin fee y siempre fantasy:** en grupos no hay comisión y siempre se usa modo Fantasy, independientemente de si el usuario tiene iBY.

10. **featured requiere predictions:** el sistema automático verifica que existan datos de predicción antes de marcar como featured. No se puede hacer featured manual sin predictions válidas.

11. **Admin no recibe tokens de login ni referidos:** si el rol es backoffice_admin, cualquier llamada al endpoint de bono de login retorna 0 y no acredita nada.

12. **Wagering de referidos solo cuenta predicciones de ≥10 FT resueltas:** predicciones canceladas o de montos bajos no cuentan para desbloquear el bono.

13. **Resolución de half_time usa datos de halftime del metadata del evento:** el score al descanso no viene en el score principal (home_score/away_score) sino en `metadata.predictions.halftime_home_score` y `halftime_away_score`. El cron de sincronización de scores debe guardar estos datos.

14. **Casa reserva su exposición al crear predicción vs Casa:** inmediatamente al crear una house bet, la wallet de la casa debita `potential_payout - stake` para garantizar que tiene liquidez para pagar si el usuario gana.

15. **Rollback de pago en caso de falla:** si el cambio de estado de la predicción fue exitoso pero el pago falla, el sistema intenta revertir el estado. Si también falla el revert, se genera un log crítico para intervención manual.

---

## 31. Flujo End-to-End: Predicción P2P Completa

```
CREACIÓN
───────
Ariel ve Arsenal vs Chelsea en el marketplace
→ Elige tipo: Resultado
→ Elige selección: Arsenal gana (home)
→ Elige monto: 100 FT
→ Sistema calcula: fee = 3 FT, total a reservar = 103 FT
→ Ariel confirma
→ Servidor: inserta predicción (open) → descuenta 103 FT de Ariel
→ Ariel ve su predicción publicada en marketplace

TOMA
────
Bruno ve la predicción de Ariel en marketplace
→ Ve: "Ariel predice Arsenal gana, 100 FT"
→ Entiende: si toma, él apostará a "Chelsea gana o empate"
→ Bruno confirma
→ Servidor: cambia estado a "taken", asigna Bruno como aceptante
           → descuenta 103 FT de Bruno (100 stake + 3 fee)
→ Ariel recibe notificación: "Bruno tomó tu predicción"

EVENTO OCURRE: Arsenal 2 - Chelsea 1

REPORTE (2h después del inicio)
────────────────────────────────
Ariel (creador, eligió Arsenal gana) → reporta "Gané"
→ Estado cambia a pending_resolution, winner_id = Ariel
→ Bruno recibe: "Tu rival reportó que ganó. Confirma o disputa."

Bruno ve el resultado, Arsenal sí ganó
→ Bruno confirma
→ Estado cambia a "resolved", winner_id = Ariel
→ Ariel recibe: 200 FT (su 100 + los 100 de Bruno)
→ Notificaciones: Ariel "Ganaste 200 FT", Bruno "Perdiste esta predicción"

ESCENARIO ALTERNATIVO (Bruno no confirma, disputa)
────────────────────────────────────────────────────
Bruno dice que no sabe o cree que el resultado es otro
→ Bruno rechaza
→ Estado cambia a "disputed"
→ Notificaciones a ambos: "Predicción en disputa"
→ Admin revisa, decide, resuelve manualmente
→ O el auto-resolve verifica el score del evento y resuelve automáticamente
```

---

## 32. Flujo End-to-End: Predicción vs Casa Completa

```
CREACIÓN
───────
Carmen ve el partido Lakers vs Celtics (Featured ⭐)
→ Elige tipo: Margen de Victoria
→ Elige: Lakers gana por 6-10 puntos (home_6_10)
→ Cuota calculada: 6.5x
→ Elige monto: 50 FT
→ Pago potencial: 50 × 6.5 = 325 FT
→ Confirma
→ Servidor: inserta predicción (taken, house_bet=true, house_odds=6.5, potential_payout=325)
           → descuenta 50 FT de Carmen
           → descuenta 275 FT de wallet de la casa (325 - 50 = riesgo de la casa)
→ Carmen ve su predicción activa

EVENTO OCURRE: Lakers 112 - Celtics 104 (diferencia = 8 puntos)

AUTO-RESOLVE (3AM siguiente día)
─────────────────────────────────
Sistema detecta evento finished con scores 112-104
diferencia_local = 112 - 104 = 8

Evalúa selección "home_6_10" (6 <= 8 <= 10) → GANÓ

→ Carmen recibe 325 FT
→ Wallet de la casa: acredita 50 FT (el stake que ya tenía) - ya perdió los 275 que reservó
→ Estado predicción: resolved, winner_id = Carmen

ESCENARIO ALTERNATIVO (Carmen pierde)
──────────────────────────────────────
Lakers 115 - Celtics 100 (diferencia = 15 puntos, no es 6-10)

Evalúa "home_6_10" → 15 no está en 6-10 → PERDIÓ

→ Carmen no recibe nada (pierde los 50 FT)
→ Wallet de la casa: recupera los 275 FT reservados + se queda con los 50 de Carmen
   (total: 325 FT ingresados, 0 pagados = ganancia neta 50 FT para la casa)
→ Estado predicción: resolved, winner_id = null (la casa ganó)
```

---

*Fin del documento de especificación de producto*
