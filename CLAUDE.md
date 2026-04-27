# iBetYou — Contexto del proyecto

Plataforma de apuestas P2P deportivas. Los usuarios crean apuestas sobre eventos
deportivos y otros usuarios las toman. URL de producción: https://i-bet-you.vercel.app

---

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 14 App Router (TypeScript) |
| Base de datos | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| UI | Tailwind CSS + shadcn/ui |
| Deploy | Vercel (con Cron Jobs) |
| APIs externas | api-sports.io (fútbol, basketball, béisbol) |

---

## Estructura de carpetas clave

```
app/
  page.tsx                        ← Marketplace público (eventos + apuestas abiertas)
  my-bets/page.tsx                ← Mis apuestas (usuario autenticado)
  balance/page.tsx                ← Balance/historial de ganancias-pérdidas
  bet/[id]/page.tsx               ← Detalle de apuesta (resolver, disputar, cancelar)
  backoffice/                     ← Panel de administración (solo backoffice_admin)
    events/page.tsx               ← Gestión de eventos (importar API, destacar)
    bets/page.tsx                 ← Moderación de apuestas
    users/page.tsx                ← Gestión de usuarios
    wallets/page.tsx              ← Gestión de wallets

app/api/
  admin/events/route.ts           ← CRUD admin de eventos (GET, POST, PATCH, DELETE)
  admin/events/results/route.ts   ← PATCH sync score de un evento desde api-sports.io
  admin/bets/route.ts             ← Moderación de apuestas (GET, PATCH, POST auto-resolve)
  admin/bets/auto-resolve-disputed/route.ts ← POST resolución automática de apuestas en disputa
  admin/bets/auto-resolve-finished/route.ts ← POST resolución automática de apuestas finalizadas
  admin/metrics/route.ts          ← Métricas del dashboard backoffice
  admin/users/route.ts            ← CRUD usuarios
  admin/wallets/route.ts          ← Gestión wallets
  bets/route.ts                   ← GET marketplace de apuestas
  bets/create/route.ts            ← POST crear apuesta
  bets/[id]/route.ts              ← GET/PATCH una apuesta (tomar, cancelar)
  bets/[id]/resolve/route.ts      ← PATCH resolver apuesta (creator/acceptor reportan resultado)
  events/route.ts                 ← GET eventos de api-sports.io (backoffice, usa node:https)
  events/list/route.ts            ← GET eventos guardados en DB (público, para el marketplace)
  cron/sync-events/route.ts       ← GET cron diario 5AM UTC (sincroniza próximos 7 días)
  cron/sync-scores/route.ts       ← GET cron cada 2h (actualiza scores de eventos live/recientes)
  my-bets/route.ts                ← GET apuestas del usuario autenticado
  user/balance/route.ts           ← GET historial de ganancias/pérdidas del usuario
  wallet/route.ts                 ← GET balance de wallet
  auth/*/route.ts                 ← Callbacks de auth Supabase

lib/
  supabase.ts                     ← Factories: createBrowserSupabaseClient, createAdminSupabaseClient
  server-auth.ts                  ← getAuthenticatedUserId, requireBackofficeAdmin
  bet-constants.ts                ← NON_FINAL_BET_STATUSES
  bet-resolution.ts               ← supportsPeerResolution
  utils.ts                        ← formatCurrency, formatDate

types/index.ts                    ← Interfaces: Event, Bet, User, Wallet, Transaction
```

---

## Esquema de base de datos (tablas principales)

### `events`
| Columna | Tipo | Notas |
|---|---|---|
| id | int | PK auto |
| sport | text | 'football' \| 'basketball' \| 'baseball' |
| league | text | Nombre de la liga |
| country | text | País |
| home_team / away_team | text | |
| home_logo / away_logo | text | URL logo |
| start_time | timestamptz | Siempre mostrar con `timeZone: 'UTC'` |
| status | text | 'scheduled' \| 'live' \| 'finished' |
| external_id | text | `football_12345` — unique |
| featured | boolean | DEFAULT false — evento destacado |
| home_score / away_score | int | null hasta que finalice |
| metadata | jsonb | `{ venue, match_details: { halftime_home_score, halftime_away_score } }` |

### `bets`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| event_id | int | FK → events |
| creator_id | uuid | FK → profiles |
| acceptor_id | uuid | FK → profiles, null si nadie ha tomado |
| bet_type | text | Ver tipos abajo |
| selection | text | Selección del creador (legacy) |
| creator_selection | text | Selección del creador |
| acceptor_selection | text | Selección del aceptante |
| amount | numeric | Monto base |
| multiplier | numeric | DEFAULT 1, mayor en exact_score |
| fee_amount | numeric | Comisión cobrada al creador |
| status | text | Ver ciclo de vida abajo |
| winner_id | uuid | null hasta resolución |
| created_at | timestamptz | |
| resolved_at | timestamptz | |
| decision_history | jsonb[] | Historial de acciones (auto_cancel, dispute, etc.) |

### `profiles` (users)
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | = auth.users.id |
| email | text | |
| nickname | text | |
| role | text | null \| 'backoffice_admin' |
| kyc_status | text | 'none' \| 'pending' \| 'approved' \| 'rejected' |

### `wallets`
| Columna | Tipo | Notas |
|---|---|---|
| user_id | uuid | FK → profiles |
| balance_fantasy | numeric | Saldo de juego (fichas) |
| balance_real | numeric | Saldo real |
| fantasy_total_accumulated | numeric | |

### `notifications`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → profiles |
| type | text | Ver tipos abajo |
| title | text | Título corto |
| body | text | Descripción |
| bet_id | uuid | FK → bets, nullable |
| read | boolean | DEFAULT false |
| created_at | timestamptz | |

**Tipos de notificación:** `bet_taken`, `result_reported`, `bet_resolved_win`, `bet_resolved_loss`, `bet_disputed`, `bet_cancelled`

> **Realtime requerido:** esta tabla necesita Realtime habilitado en Supabase (Publication `supabase_realtime`) para que el badge de la campana se actualice en vivo sin polling.

### `arbitration_decisions`
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| bet_id | uuid | FK → bets |
| action | text | Ver tabla de acciones abajo |
| previous_status | text | Estado de la apuesta antes |
| new_status | text | Estado de la apuesta después |
| decided_winner_id | uuid | nullable |
| reason | text | Descripción legible |
| details | jsonb | Datos extra del contexto |
| decided_by | text | UUID del usuario o `'system'` |
| source | text | Siempre `'system'` (campo reservado) |
| created_at | timestamptz | |

#### Acciones registradas (`action`)

| `action` | Fuente | Cuándo se escribe |
|---|---|---|
| `participant_claim` | `bets/[id]/resolve` | claim_win o claim_lose |
| `participant_reject_to_dispute` | `bets/[id]/resolve` | reject → disputed |
| `participant_confirm` | `bets/[id]/resolve` | confirm → resolved |
| `pending_timeout_to_dispute` | `admin/bets GET` | pending > 30 min → disputed |
| `false_claim_penalty` | `admin/bets PATCH` | falsa reclamación detectada |
| `resolve` | `admin/bets PATCH` | resolución manual por admin |
| `cancel` | `admin/bets PATCH` | cancelación por admin |
| `dispute` | `admin/bets PATCH` | admin envía a disputa |
| `approve_pending` | `admin/bets PATCH` | admin aprueba resolución pendiente |
| `auto_resolve_completed` | `admin/bets POST` | botón auto-resolver del backoffice |
| `auto_resolve_disputed` | `admin/bets POST` | conflicto detectado → disputed |
| `auto_resolve_finished_{type}` | `auto-resolve-finished` | cron/sync resuelve apuesta finalizada |
| `auto_resolve_disputed_direct` | `auto-resolve-disputed` | apuesta directa disputada resuelta |

---

## Tipos de apuesta (`bet_type`)

| Tipo | Descripción | Disponible para |
|---|---|---|
| `direct` | Ganador / empate | Todos los deportes |
| `exact_score` | Marcador exacto (con multiplicador) | Todos los deportes |
| `half_time` | Resultado al medio tiempo | Solo fútbol |
| `first_scorer` | Primer anotador | Solo fútbol |

---

## Ciclo de vida de una apuesta (`status`)

```
open
  ↓ (alguien la toma)
taken
  ↓ (ambos reportan resultado)
pending_resolution_creator   ← creador reportó
pending_resolution_acceptor  ← aceptante reportó
pending_resolution           ← ambos reportaron (compatibilidad)
  ↓ (admin o auto-resolve resuelve)
resolved  ← winner_id definido
cancelled ← cancelada (open expirada, manual, etc.)
disputed  ← creador y aceptante reportaron resultados distintos
```

---

## Autenticación en rutas API

### Rutas de backoffice (`/api/admin/*`)
```ts
const auth = await requireBackofficeAdmin(request)
if (!auth.authorized) return auth.response
// auth.userId disponible aquí
```

### Rutas de usuario autenticado
```ts
const userId = await getAuthenticatedUserId(request)
if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

### Frontend — llamadas autenticadas
```ts
const { data: { session } } = await supabase.auth.getSession()
const headers: HeadersInit = {}
if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
fetch('/api/...', { headers })
```

### Patrón `authFetch` (solo en backoffice pages)
```ts
async function authFetch(input: RequestInfo, init?: RequestInit) {
  const supabase = createBrowserSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init?.headers)
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}
```

---

## Reglas de arquitectura

### 1. Toda la lógica de negocio va en la API
El frontend solo renderiza. Cálculos de fees, validaciones, transiciones de estado —
todo ocurre en los route handlers de `app/api/`.

### 2. Nunca `window.confirm()`, `alert()` o `window.prompt()`
Siempre usar modales UI basados en estado:
```ts
// Confirmaciones
const [confirmDialog, setConfirmDialog] = useState<{
  title: string; message: string; onConfirm: () => void
} | null>(null)

// Prompts con input
const [promptDialog, setPromptDialog] = useState<{
  title: string; defaultValue: string; onConfirm: (value: string) => void
} | null>(null)
```

### 3. Fechas siempre en UTC
```ts
new Date(event.start_time).toLocaleDateString('es-ES', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  timeZone: 'UTC'  // ← SIEMPRE incluir esto
})
```

### 4. Llamadas a api-sports.io con `node:https`
La API de api-sports rechaza requests con headers extra que inyecta Node.js fetch.
Usar siempre el helper `fetchApiSports` de `app/api/events/route.ts` que usa
`node:https` directamente con solo `x-apisports-key`.

### 5. Notificaciones con `useToast`
```ts
const { showToast } = useToast()
showToast('Mensaje', 'success' | 'error')
```

### 6. Supabase clients — cuál usar dónde
| Contexto | Client | Por qué |
|---|---|---|
| Componentes React (browser) | `createBrowserSupabaseClient()` | Maneja sesión en cookies |
| API routes (server) — operaciones admin | `createAdminSupabaseClient()` | Service role, bypassa RLS |
| API routes — verificar token de usuario | `createServerSupabaseClient()` | Solo para auth.getUser() |

### 7. Ordenamiento de pagos (payment ordering invariant)
Siempre actualizar el estado de la apuesta en DB **antes** de mover dinero. Si la actualización
de la apuesta falla, no se mueve dinero. Si ya se dedujo y la operación siguiente falla, hacer rollback.

```
// Patrón correcto
1. Actualizar bets.status → si falla, return error (no se mueve dinero)
2. Creditar/debitar wallets
3. Insertar en transactions
```

Esto aplica en: `bets/create`, `bets/[id]` (take), `bets/[id]/resolve` (confirm),
`admin/bets/auto-resolve-disputed`, `admin/bets POST` (auto-resolve).

### 8. Notificaciones con `lib/notifications.ts`
```ts
import { createNotification, createNotifications } from "@/lib/notifications"

// Una notificación
await createNotification({ userId, type, title, body, betId })

// Varias de una vez (acepta client opcional para reusar conexión)
await createNotifications([
  { userId: winnerId, type: "bet_resolved_win", title: "...", body: "...", betId },
  { userId: loserId,  type: "bet_resolved_loss", title: "...", body: "...", betId },
], supabase) // ← pasar el client admin existente para evitar instanciar uno nuevo
```

Tipos válidos: `bet_taken` | `result_reported` | `bet_resolved_win` | `bet_resolved_loss` | `bet_disputed` | `bet_cancelled`

---

## Cron jobs

### Vercel Cron (`vercel.json`)
- **`/api/cron/sync-events`** — todos los días a las 5 AM UTC
  - Descarga próximos 7 días de fútbol, basketball y béisbol de api-sports.io
  - Solo inserta eventos nuevos (no toca `featured` ni otros campos de eventos existentes)
  - Autenticación: `Authorization: Bearer {CRON_SECRET}`

### cron-job.org (externo, no en Vercel)
- **`/api/cron/sync-scores`** — cada 2 horas
  - Actualiza `home_score`, `away_score`, `status`, `metadata` de eventos live o recién finalizados
  - Autenticación: `Authorization: Bearer {CRON_SECRET}`
  - Dispara auto-resolución de apuestas cuyo evento quedó `finished`

---

## Variables de entorno requeridas

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
API_FOOTBALL_KEY              ← misma key para los 3 deportes en api-sports.io
API_FOOTBALL_URL=https://v3.football.api-sports.io
API_BASKETBALL_URL=https://v1.basketball.api-sports.io   ← v1, NO v3
API_BASEBALL_URL=https://v1.baseball.api-sports.io
CRON_SECRET                   ← para autenticar el cron de Vercel
CLEANUP_API_SECRET
RESEND_API_KEY
NEXT_PUBLIC_API_KEY
```

---

## Convenciones de código

- **Idioma UI**: español (labels, toasts, mensajes de error al usuario)
- **Idioma código**: inglés (variables, funciones, comentarios técnicos)
- **Sin `next: { revalidate }` en Route Handlers** — solo válido en Server Components
- **`cache: 'no-store'`** si se necesita deshabilitar cache en fetch dentro de Route Handlers
- **Badges de estado** usan variantes de shadcn/ui: `default`, `secondary`, `outline`, `destructive`
- **Formateo de moneda**: siempre `formatCurrency(amount)` de `@/lib/utils`
- **No agregar comentarios** que expliquen QUÉ hace el código — solo WHY si no es obvio

---

## Requisitos de infraestructura Supabase

### Realtime
Las siguientes tablas deben estar habilitadas en la publicación `supabase_realtime`
(Supabase Dashboard → Database → Replication):

| Tabla | Por qué |
|---|---|
| `notifications` | Badge de campana en tiempo real (sin polling) |

Habilitar desde SQL:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
```

### Row Level Security (RLS)
Las operaciones de negocio usan `createAdminSupabaseClient()` (service role) que bypassa RLS.
El cliente del browser (`createBrowserSupabaseClient()`) sí respeta RLS — asegurarse de que
las políticas permitan a cada usuario leer solo sus propias `notifications`, `wallets`, etc.

### Índices recomendados
```sql
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_event_id ON bets(event_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_arbitration_bet_id ON arbitration_decisions(bet_id);
```

---

## Migraciones pendientes (SQL a ejecutar en Supabase)

```sql
-- Columna para eventos destacados (ejecutar si aún no existe)
ALTER TABLE events ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
```

---

## Flujo de eventos destacados

1. **Backoffice** (`/backoffice/events`) → botón ⭐ en tarjeta → `PATCH /api/admin/events` `{ id, featured: bool }`
2. **API pública** (`/api/events/list`) → ordena `featured DESC, start_time ASC`
3. **Marketplace** (`/`) → sección "⭐ Eventos Destacados" arriba de la grilla por deporte
   - Tarjetas con borde/gradiente dorado, más grandes que las regulares
   - También aparecen en su grupo de deporte con borde ámbar sutil
