// app/groups/[id]/create-bet/page.tsx
"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useAuth } from "@/components/providers"
import { useToast } from "@/components/toast"
import { Button } from "@/components/ui/button"
import { ChevronLeft } from "lucide-react"
import Link from "next/link"

interface EventRow {
  id: number
  home_team: string; away_team: string; start_time: string
  sport: string; league: string; status: string
}

const SELECTION_LABELS: Record<string, string> = {
  home: "Local", draw: "Empate", away: "Visitante"
}

export default function CreateGroupBetPage() {
  const { id: groupId } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()

  const [group, setGroup] = useState<{ name: string; sport: string | null } | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null)
  const [betType, setBetType] = useState("direct")
  const [selection, setSelection] = useState("home")
  const [amount, setAmount] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  async function authFetch(input: RequestInfo, init?: RequestInit) {
    const supabase = createBrowserSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  useEffect(() => {
    if (!user || !groupId) return
    async function load() {
      setLoading(true)
      try {
        const [groupRes, eventsRes] = await Promise.all([
          authFetch(`/api/groups/${groupId}`),
          authFetch("/api/events/list"),
        ])
        if (groupRes.ok) {
          const d = await groupRes.json()
          setGroup({ name: d.group.name, sport: d.group.sport })
        }
        if (eventsRes.ok) {
          const d = await eventsRes.json()
          const evs: EventRow[] = d.events || []
          setEvents(evs.filter((e) => e.status === "scheduled"))
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user, groupId])

  const filteredEvents = group?.sport
    ? events.filter((e) => e.sport === group.sport)
    : events

  async function handleSubmit() {
    if (!selectedEvent || !amount || !user) return
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { showToast("El monto debe ser un número positivo", "error"); return }

    setSubmitting(true)
    try {
      const supabase = createBrowserSupabaseClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch("/api/bets/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          userId: user.id,
          eventId: selectedEvent.id,
          betType,
          selection: { selection, betType },
          amount: amt,
          group_id: groupId,
        }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error al crear apuesta", "error"); return }
      showToast("Apuesta creada en el grupo", "success")
      router.push(`/groups/${groupId}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (!user) return <div className="p-8 text-center">Inicia sesión para continuar</div>
  if (loading) return <div className="p-8 text-center text-muted-foreground">Cargando...</div>

  return (
    <div className="container mx-auto px-4 py-6 max-w-xl">
      <Link href={`/groups/${groupId}`} className="text-sm text-muted-foreground flex items-center gap-1 mb-4 hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Volver al grupo
      </Link>
      <h1 className="text-xl font-bold mb-5">Crear apuesta en {group?.name ?? "el grupo"}</h1>

      <div className="mb-4">
        <label className="text-sm font-medium mb-1.5 block">Evento</label>
        {filteredEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay eventos disponibles para este grupo.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {filteredEvents.map((ev) => (
              <button
                key={ev.id}
                onClick={() => setSelectedEvent(ev)}
                className={`w-full text-left px-4 py-3 text-sm border-b last:border-b-0 transition-colors ${
                  selectedEvent?.id === ev.id ? "bg-primary/10" : "hover:bg-muted/50"
                }`}
              >
                <div className="font-medium">{ev.home_team} vs {ev.away_team}</div>
                <div className="text-xs text-muted-foreground">{ev.league} · {new Date(ev.start_time).toLocaleString("es-ES", { timeZone: "UTC" })}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedEvent && (
        <>
          <div className="mb-4">
            <label className="text-sm font-medium mb-1.5 block">Tipo de apuesta</label>
            <select
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              value={betType}
              onChange={(e) => setBetType(e.target.value)}
            >
              <option value="direct">Ganador directo</option>
              {selectedEvent.sport === "football" && <option value="half_time">Resultado medio tiempo</option>}
            </select>
          </div>

          <div className="mb-4">
            <label className="text-sm font-medium mb-1.5 block">Tu selección</label>
            <div className="grid grid-cols-3 gap-2">
              {["home", "draw", "away"].map((s) => (
                <button
                  key={s}
                  onClick={() => setSelection(s)}
                  className={`py-2 px-3 rounded border text-sm font-medium transition-colors ${
                    selection === s ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted/50"
                  }`}
                >
                  {SELECTION_LABELS[s] ?? s}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <label className="text-sm font-medium mb-1.5 block">Monto (tokens de grupo)</label>
            <input
              type="number"
              min="1"
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              placeholder="Ej: 100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={submitting || !amount}>
            {submitting ? "Creando..." : "Publicar apuesta"}
          </Button>
        </>
      )}
    </div>
  )
}
