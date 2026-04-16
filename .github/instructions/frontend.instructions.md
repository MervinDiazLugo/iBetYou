---
name: "Frontend conventions"
description: "Patrones obligatorios para componentes y páginas React"
applyTo: "app/**/*.tsx"
---

# Convenciones para componentes y páginas

## Nunca dialogs nativos del browser

PROHIBIDO: `window.confirm()`, `alert()`, `window.prompt()`

En su lugar, estado en el componente:
```ts
// Confirmación simple
const [confirmDialog, setConfirmDialog] = useState<{
  title: string; message: string; onConfirm: () => void
} | null>(null)

// Con input de texto
const [promptDialog, setPromptDialog] = useState<{
  title: string; defaultValue: string; onConfirm: (value: string) => void
} | null>(null)
const [promptValue, setPromptValue] = useState('')
```

Ver `app/backoffice/events/page.tsx` y `app/bet/[id]/page.tsx` para implementaciones
de referencia completas (overlay modal, backdrop, botones Cancelar/Confirmar).

## Fechas — siempre timeZone: 'UTC'

```ts
// CORRECTO
new Date(event.start_time).toLocaleDateString('es-ES', {
  day: 'numeric', month: 'short', timeZone: 'UTC'
})

// MAL — muestra un día antes para usuarios en UTC-X
new Date(event.start_time).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
```

## Notificaciones

```ts
const { showToast } = useToast()
showToast('Mensaje de éxito', 'success')
showToast('Mensaje de error', 'error')
```

## Llamadas API autenticadas desde componentes

```ts
// Patrón básico (páginas de usuario)
const { data: { session } } = await supabase.auth.getSession()
const headers: HeadersInit = {}
if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
const res = await fetch('/api/...', { headers })

// Patrón authFetch (solo backoffice)
// Definir una función authFetch local que inyecta el token automáticamente
```

## Idioma

La UI es en español. Labels, placeholders, mensajes de error al usuario → español.
Código (variables, funciones, tipos) → inglés.

## Componentes UI

Usar siempre los de shadcn/ui en `components/ui/`:
`Card`, `Button`, `Badge`, `Input`, `Dialog`, `DialogContent`

Variantes de Badge para estados de apuesta:
- `open` → `secondary`
- `taken` → `default`  
- `pending_resolution*` → `outline`
- `resolved` → `default`
- `cancelled` / `disputed` → `destructive`
