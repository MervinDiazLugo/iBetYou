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
  admin/bets/route.ts             ← Moderación de apuestas
  admin/bets/auto-resolve-*       ← Auto-resolución de apuestas disputadas/finalizadas
  admin/metrics/route.ts          ← Métricas del dashboard backoffice
  admin/users/route.ts            ← CRUD usuarios
  admin/wallets/route.ts          ← Gestión wallets
  bets/route.ts                   ← GET marketplace de apuestas
  bets/create/route.ts            ← POST crear apuesta
  bets/[id]/route.ts              ← GET/PATCH una apuesta (tomar, cancelar)
  bets/[id]/resolve/route.ts      ← POST resolver apuesta (creator/acceptor reportan resultado)
  events/route.ts                 ← GET eventos de api-sports.io (backoffice, usa node:https)
  events/list/route.ts            ← GET eventos guardados en DB (público, para el marketplace)
  cron/sync-events/route.ts       ← GET cron diario 5AM UTC (sincroniza próximos 7 días)
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

---

## Cron jobs

`vercel.json` configura:
- **`/api/cron/sync-events`** — todos los días a las 5 AM UTC
  - Descarga próximos 7 días de fútbol, basketball y béisbol de api-sports.io
  - Solo inserta eventos nuevos (no toca `featured` ni otros campos de eventos existentes)
  - Autenticación: `Authorization: Bearer {CRON_SECRET}`

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
