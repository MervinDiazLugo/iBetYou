---
name: "API Route Handler conventions"
description: "Patrones obligatorios para route handlers en app/api/"
applyTo: "app/api/**/*.ts"
---

# Convenciones para Route Handlers

## Autenticación — elegir el correcto

**Ruta de backoffice** (solo admins):
```ts
const auth = await requireBackofficeAdmin(request)
if (!auth.authorized) return auth.response
// Usar auth.userId
```

**Ruta de usuario autenticado**:
```ts
const userId = await getAuthenticatedUserId(request)
if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

**Ruta pública** (marketplace, sin auth):
No es necesario verificar. Si se pasa `user_id` como query param, validar que coincida
con el usuario autenticado si hay sesión.

## Supabase client — cuál usar

- Operaciones de DB en server → `createAdminSupabaseClient()` (service role, bypassa RLS)
- Verificar token de usuario → `createServerSupabaseClient()` solo para `auth.getUser(token)`
- NUNCA `createBrowserSupabaseClient()` en route handlers

## Respuestas de error

```ts
return NextResponse.json({ error: 'Mensaje' }, { status: 400 | 401 | 403 | 404 | 500 })
```

## NO usar `next: { revalidate }` en route handlers

Solo es válido en Server Components. En Route Handlers usar `cache: 'no-store'` en fetch
si se necesita deshabilitar cache.

## Llamadas a api-sports.io

SIEMPRE usar `node:https` directamente — la API rechaza requests con headers extra que
Node.js fetch inyecta. Ver `app/api/events/route.ts` para el helper `fetchApiSports`.

## Lógica de negocio

TODO va aquí. El frontend solo renderiza. Cálculos de fees, validaciones de estado,
transiciones — todo en el API.
