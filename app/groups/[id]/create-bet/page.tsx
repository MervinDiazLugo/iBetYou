// app/groups/[id]/create-bet/page.tsx
"use client"

import { useState, useEffect, Suspense } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useAuth } from "@/components/providers"
import { useToast } from "@/components/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChevronLeft, Trophy, DollarSign, AlertCircle, Coins } from "lucide-react"
import Link from "next/link"
import { Navbar } from "@/components/navbar"

interface EventRow {
  id: number
  sport: string
  home_team: string; away_team: string; start_time: string
  league: string; country?: string; status: string
  home_logo?: string; away_logo?: string
  metadata?: {
    predictions?: {
      percent?: { home: string; draw: string; away: string } | null
      advice?: string | null
      home_league_form?: string | null
      away_league_form?: string | null
      home_goals_avg?: string | null
      away_goals_avg?: string | null
    }
  }
}

const betTypes = [
  { id: "direct", label: "Directa", icon: "⚔️" },
  { id: "exact_score", label: "Resultado Exacto", icon: "🎯" },
  { id: "run_line", label: "Run Line", icon: "📐" },
  { id: "total_runs", label: "Total Carreras", icon: "🔢" },
  { id: "score_margin", label: "Margen de Victoria", icon: "📏" },
  { id: "first_scorer", label: "Primer Anotador", icon: "🥅" },
  { id: "half_time", label: "Medio Tiempo", icon: "⏱️" },
]

function getAvailableBetTypes(sport: string) {
  if (sport === "football") return betTypes.filter((t) => !["run_line", "total_runs", "score_margin"].includes(t.id))
  if (sport === "basketball") return betTypes.filter((t) => ["direct", "score_margin"].includes(t.id))
  if (sport === "baseball") return betTypes.filter((t) => ["direct", "run_line", "total_runs"].includes(t.id))
  return betTypes.filter((t) => t.id === "direct")
}

const sports = [
  { id: "football", name: "Fútbol", icon: "⚽" },
  { id: "basketball", name: "Basketball", icon: "🏀" },
  { id: "baseball", name: "Béisbol", icon: "⚾" },
]

function CreateGroupBetInner() {
  const { id: groupId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const presetEventId = searchParams.get("eventId") ? Number(searchParams.get("eventId")) : null
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()

  const [group, setGroup] = useState<{ name: string; sport: string | null; leagues: string[] } | null>(null)
  const [groupBalance, setGroupBalance] = useState(0)
  const [events, setEvents] = useState<EventRow[]>([])
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null)
  const [selectedSport, setSelectedSport] = useState("football")
  const [betType, setBetType] = useState("direct")
  const [betSelection, setBetSelection] = useState("")
  const [exactScoreHome, setExactScoreHome] = useState(0)
  const [exactScoreAway, setExactScoreAway] = useState(0)
  const [multiplier, setMultiplier] = useState(1)
  const [amount, setAmount] = useState(100)
  const [feeIncluded, setFeeIncluded] = useState(true)
  const [eventFilter, setEventFilter] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const fee = amount * 0.03
  const betAmount = feeIncluded ? amount - fee : amount
  const totalNeeded = amount + fee
  const maxAmountInteger = Math.max(1, Math.floor(groupBalance / 1.03))

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
        const res = await authFetch(`/api/groups/${groupId}`)
        if (!res.ok) { router.push("/groups"); return }
        const d = await res.json()
        const g = { name: d.group.name, sport: d.group.sport, leagues: d.group.leagues || [] }
        setGroup(g)
        setGroupBalance(d.my_wallet?.balance ?? 0)
        if (g.sport) setSelectedSport(g.sport)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user?.id, groupId])

  useEffect(() => {
    if (!selectedSport) return
    async function fetchEvents() {
      const res = await fetch(`/api/events/list?sport=${selectedSport}`)
      if (!res.ok) return
      const d = await res.json()
      const evs: EventRow[] = Array.isArray(d) ? d : (d.events || [])
      setEvents(evs.filter((e) => e.status === "scheduled" || e.status === "live"))
    }
    fetchEvents()
  }, [selectedSport])

  // Pre-select event from URL param
  useEffect(() => {
    if (presetEventId && events.length > 0 && !selectedEvent) {
      const found = events.find(e => e.id === presetEventId)
      if (found) setSelectedEvent(found)
    }
  }, [presetEventId, events])

  // Reset bet type when sport changes
  useEffect(() => {
    const available = getAvailableBetTypes(selectedSport)
    if (!available.some(t => t.id === betType)) {
      setBetType("direct")
      setBetSelection("")
    }
  }, [selectedSport, betType])

  useEffect(() => {
    if (betType !== "exact_score" && multiplier !== 1) setMultiplier(1)
  }, [betType, multiplier])

  useEffect(() => {
    setAmount(prev => Math.min(Math.max(prev, 1), maxAmountInteger))
  }, [maxAmountInteger])

  const filteredEvents = (selectedEvent ? [selectedEvent] : events.filter((e) => {
    if (group?.sport && e.sport !== group.sport) return false
    if (group?.leagues && group.leagues.length > 0 && !group.leagues.includes(e.league)) return false
    if (eventFilter) {
      const s = eventFilter.toLowerCase()
      return e.home_team.toLowerCase().includes(s) || e.away_team.toLowerCase().includes(s) || e.league.toLowerCase().includes(s)
    }
    return true
  }))

  function getBetOptions() {
    if (!selectedEvent) return []
    switch (betType) {
      case "direct":
        return [
          { id: "home_win", label: `Gana ${selectedEvent.home_team}`, value: selectedEvent.home_team },
          ...(selectedSport === "football" ? [{ id: "draw", label: "Empate", value: "Empate" }] : []),
          { id: "away_win", label: `Gana ${selectedEvent.away_team}`, value: selectedEvent.away_team },
        ]
      case "exact_score":
        return []
      case "first_scorer":
        return [
          { id: "home_team", label: selectedEvent.home_team, value: selectedEvent.home_team },
          { id: "away_team", label: selectedEvent.away_team, value: selectedEvent.away_team },
        ]
      case "run_line":
        return [
          { id: "home_rl", label: selectedEvent.home_team, sublabel: "Gana por 2 o más carreras", value: "home_rl" },
          { id: "away_rl", label: selectedEvent.away_team, sublabel: "Gana o pierde por 1", value: "away_rl" },
        ]
      case "total_runs":
        return [
          { id: "over_7", label: "Más de 7", value: "over_7" },
          { id: "under_7", label: "Menos de 7", value: "under_7" },
          { id: "over_8", label: "Más de 8", value: "over_8" },
          { id: "under_8", label: "Menos de 8", value: "under_8" },
          { id: "over_9", label: "Más de 9", value: "over_9" },
          { id: "under_9", label: "Menos de 9", value: "under_9" },
          { id: "over_10", label: "Más de 10", value: "over_10" },
          { id: "under_10", label: "Menos de 10", value: "under_10" },
        ]
      case "score_margin":
        return [
          { id: "home_1_5", label: `${selectedEvent.home_team} +1–5`, value: "home_1_5" },
          { id: "home_6_10", label: `${selectedEvent.home_team} +6–10`, value: "home_6_10" },
          { id: "home_11_15", label: `${selectedEvent.home_team} +11–15`, value: "home_11_15" },
          { id: "home_16plus", label: `${selectedEvent.home_team} +16`, value: "home_16plus" },
          { id: "away_1_5", label: `${selectedEvent.away_team} +1–5`, value: "away_1_5" },
          { id: "away_6_10", label: `${selectedEvent.away_team} +6–10`, value: "away_6_10" },
          { id: "away_11_15", label: `${selectedEvent.away_team} +11–15`, value: "away_11_15" },
          { id: "away_16plus", label: `${selectedEvent.away_team} +16`, value: "away_16plus" },
        ]
      case "half_time":
        return [
          { id: "home_win", label: `Gana ${selectedEvent.home_team}`, value: `${selectedEvent.home_team} HT` },
          { id: "draw", label: "Empate", value: "Empate HT" },
          { id: "away_win", label: `Gana ${selectedEvent.away_team}`, value: `${selectedEvent.away_team} HT` },
        ]
      default:
        return []
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (!selectedEvent) { setError("Selecciona un evento"); return }

    let finalSelection = betSelection
    if (betType === "exact_score") {
      finalSelection = `${exactScoreHome}-${exactScoreAway}`
    } else if (!finalSelection) {
      setError("Selecciona una opción")
      return
    }

    if (groupBalance < totalNeeded) { setError("Tokens de grupo insuficientes"); return }

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
          userId: user!.id,
          eventId: selectedEvent.id,
          betType,
          selection: { betType, selection: finalSelection, exactScoreHome, exactScoreAway, event: selectedEvent },
          amount: Math.round(betAmount),
          multiplier,
          fee: Math.round(fee),
          group_id: groupId,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Error al crear apuesta"); return }
      showToast("Apuesta creada en el grupo", "success")
      router.push(`/groups/${groupId}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (!user) return <><Navbar /><div className="p-8 text-center">Inicia sesión para continuar</div></>
  if (loading) return <><Navbar /><div className="p-8 text-center text-muted-foreground">Cargando...</div></>

  const isGroupSportLocked = Boolean(group?.sport)
  const preds = selectedEvent?.metadata?.predictions

  return (
    <>
    <Navbar />
    <div className="container mx-auto px-4 py-6 max-w-xl">
      <Link href={`/groups/${groupId}`} className="text-sm text-muted-foreground flex items-center gap-1 mb-4 hover:text-foreground">
        <ChevronLeft className="w-4 h-4" /> Volver al grupo
      </Link>

      <Card className="flex flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" />
            Crear Apuesta
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 flex-1">
          <form onSubmit={handleSubmit} className="space-y-4 pb-4">
            {/* Group balance banner */}
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 rounded-lg text-sm">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="font-semibold">{groupBalance.toLocaleString()} tokens disponibles</span>
              <span className="text-xs text-muted-foreground ml-auto">{group?.name}</span>
            </div>

            {error && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            {/* Sport selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Deporte</label>
              <div className="flex flex-wrap gap-2">
                {sports.map((sport) => (
                  <Button
                    key={sport.id}
                    type="button"
                    variant={selectedSport === sport.id ? "default" : "outline"}
                    size="sm"
                    disabled={isGroupSportLocked}
                    onClick={() => { setSelectedSport(sport.id); setSelectedEvent(null); setBetSelection("") }}
                  >
                    {sport.icon} {sport.name}
                  </Button>
                ))}
              </div>
            </div>

            {/* Bet type cards */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo de Apuesta</label>
              <div className="grid grid-cols-2 gap-2">
                {getAvailableBetTypes(selectedSport).map((type) => (
                  <div
                    key={type.id}
                    className={`p-2 rounded-lg border cursor-pointer ${betType === type.id ? "border-primary bg-primary/10" : "hover:border-primary/50"}`}
                    onClick={() => { setBetType(type.id); setBetSelection("") }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{type.icon}</span>
                      <span className="font-medium text-sm truncate">{type.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Event picker */}
            <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium">Evento</label>
                {selectedEvent && !presetEventId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => { setSelectedEvent(null); setBetSelection("") }}
                  >
                    Cancelar selección
                  </Button>
                )}
              </div>
              {!selectedEvent && (
                <Input
                  placeholder="Buscar evento..."
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
                  className="mb-2"
                />
              )}
              {filteredEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No hay eventos disponibles para este grupo.</p>
              ) : (
                <div className="grid gap-2 max-h-48 overflow-y-auto">
                  {filteredEvents.map((event) => (
                    <div
                      key={event.id}
                      className={`p-2.5 rounded-lg border cursor-pointer ${selectedEvent?.id === event.id ? "border-primary bg-primary/10" : "hover:border-primary/50"}`}
                      onClick={() => { setSelectedEvent(event); setBetSelection("") }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-[30%] min-w-[108px] rounded-md bg-muted/20 px-2 py-1.5">
                          <div className="flex items-center gap-1 text-[10px] leading-tight min-w-0">
                            <span className="text-sm shrink-0">
                              {event.sport === "football" && "⚽"}
                              {event.sport === "basketball" && "🏀"}
                              {event.sport === "baseball" && "⚾"}
                            </span>
                            <span className="truncate font-medium">{event.league}</span>
                            {event.country && (
                              <>
                                <span className="text-muted-foreground shrink-0">|</span>
                                <span className="truncate text-muted-foreground">{event.country}</span>
                              </>
                            )}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                            {new Date(event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" })} - {new Date(event.start_time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
                          </div>
                        </div>
                        <div className="w-[70%] min-w-0 flex items-center">
                          <div className="w-full flex items-center min-w-0 px-1">
                            <div className="w-[calc(50%-18px)] min-w-0 flex items-center gap-2.5">
                              {event.home_logo ? (
                                <img src={event.home_logo} alt="" className="w-5 h-5 object-contain shrink-0" />
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold shrink-0">{event.home_team[0]}</div>
                              )}
                              <span className="font-semibold text-xs truncate">{event.home_team}</span>
                            </div>
                            <span className="w-9 text-center text-[11px] text-muted-foreground shrink-0 px-1">vs</span>
                            <div className="w-[calc(50%-18px)] min-w-0 flex items-center justify-end gap-2.5">
                              <span className="font-semibold text-xs truncate text-right">{event.away_team}</span>
                              {event.away_logo ? (
                                <img src={event.away_logo} alt="" className="w-5 h-5 object-contain shrink-0" />
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold shrink-0">{event.away_team[0]}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Predictions */}
            {preds?.percent && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 space-y-3">
                <div className="text-xs font-semibold text-blue-300 mb-1">🤖 Predicción</div>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-md bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground mb-0.5 truncate">{selectedEvent!.home_team}</div>
                    <div className="text-lg font-bold text-blue-300">{preds.percent.home}</div>
                    {preds.home_league_form && (
                      <div className="flex gap-0.5 justify-center mt-1">
                        {preds.home_league_form.slice(-5).split("").map((c, i) => (
                          <span key={i} className={`inline-block w-2 h-2 rounded-full ${c === "W" ? "bg-green-500" : c === "D" ? "bg-gray-400" : "bg-red-500"}`} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 rounded-md bg-gray-500/10 border border-gray-500/20 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground mb-0.5">Empate</div>
                    <div className="text-lg font-bold text-gray-300">{preds.percent.draw}</div>
                  </div>
                  <div className="flex-1 rounded-md bg-orange-500/10 border border-orange-500/20 p-2 text-center">
                    <div className="text-[10px] text-muted-foreground mb-0.5 truncate">{selectedEvent!.away_team}</div>
                    <div className="text-lg font-bold text-orange-300">{preds.percent.away}</div>
                    {preds.away_league_form && (
                      <div className="flex gap-0.5 justify-center mt-1">
                        {preds.away_league_form.slice(-5).split("").map((c, i) => (
                          <span key={i} className={`inline-block w-2 h-2 rounded-full ${c === "W" ? "bg-green-500" : c === "D" ? "bg-gray-400" : "bg-red-500"}`} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {preds.advice && (
                  <p className="text-xs text-center text-amber-300/80 leading-snug">💡 {preds.advice}</p>
                )}
                {(preds.home_goals_avg || preds.away_goals_avg) && (
                  <div className="flex justify-between text-[10px] text-muted-foreground px-1">
                    <span>Goles/partido: <span className="text-foreground font-semibold">{preds.home_goals_avg}</span></span>
                    <span>Goles/partido: <span className="text-foreground font-semibold">{preds.away_goals_avg}</span></span>
                  </div>
                )}
              </div>
            )}

            {/* Selection */}
            {selectedEvent && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Tu Selección</label>
                {betType === "total_runs" && (
                  <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                    📊 Apuesta al <strong>total de carreras sumadas</strong> entre los dos equipos.
                  </p>
                )}
                {betType === "score_margin" && (
                  <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                    📏 Elegí un equipo <strong>y por cuántos puntos gana</strong>.
                  </p>
                )}
                {betType === "run_line" && (
                  <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                    📐 <strong>Run Line</strong>: el favorito necesita ganar por 2+ carreras.
                  </p>
                )}
                {betType === "exact_score" ? (
                  <div className="flex items-center justify-center gap-4">
                    <div className="text-center">
                      <p className="font-semibold mb-2">{selectedEvent.home_team}</p>
                      <Input
                        type="number" min={0} max={20} value={exactScoreHome}
                        onChange={(e) => setExactScoreHome(Number(e.target.value))}
                        className="w-20 text-center"
                      />
                    </div>
                    <span className="text-2xl font-bold">-</span>
                    <div className="text-center">
                      <p className="font-semibold mb-2">{selectedEvent.away_team}</p>
                      <Input
                        type="number" min={0} max={20} value={exactScoreAway}
                        onChange={(e) => setExactScoreAway(Number(e.target.value))}
                        className="w-20 text-center"
                      />
                    </div>
                  </div>
                ) : (
                  <div className={`grid gap-2 ${["score_margin", "total_runs", "run_line"].includes(betType) ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
                    {getBetOptions().map((option) => {
                      const sub = (option as any).sublabel as string | undefined
                      return (
                        <Button
                          key={option.id}
                          type="button"
                          variant={betSelection === option.value ? "default" : "outline"}
                          size="sm"
                          className={sub ? "h-auto py-2.5 flex flex-col items-center gap-0.5" : ""}
                          onClick={() => setBetSelection(option.value)}
                        >
                          <span className={sub ? "font-semibold text-sm leading-tight" : ""}>{option.label}</span>
                          {sub && <span className="text-xs font-normal opacity-75 leading-tight">{sub}</span>}
                        </Button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Amount */}
            <div className="space-y-2">
              <div className="rounded-lg border p-3 bg-muted/20">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Coins className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm">Tokens a apostar</span>
                  </div>
                  <span className="text-lg font-semibold">{amount.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={maxAmountInteger}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: "#eab308" }}
                />
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>{maxAmountInteger.toLocaleString()}</span>
                </div>
                <input
                  type="number"
                  min={1}
                  max={maxAmountInteger}
                  value={amount}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v) && v >= 1) setAmount(Math.min(v, maxAmountInteger))
                  }}
                  className="mt-2 w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Máximo disponible: {maxAmountInteger.toLocaleString()} tokens de grupo
              </p>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={feeIncluded}
                  onChange={(e) => setFeeIncluded(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-muted-foreground">Fee incluido</span>
              </label>
            </div>

            {betType === "exact_score" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Multiplicador</label>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((mult) => (
                    <Button
                      key={mult}
                      type="button"
                      variant={multiplier === mult ? "default" : "outline"}
                      size="sm"
                      onClick={() => setMultiplier(mult)}
                    >
                      x{mult}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-card/95 backdrop-blur border-t border-border">
              {groupBalance < totalNeeded && (
                <p className="text-xs text-center text-destructive mb-2">Tokens de grupo insuficientes</p>
              )}
              <div className="flex flex-row gap-2">
                <Button type="button" variant="outline" onClick={() => router.push(`/groups/${groupId}`)} className="flex-1">
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={
                    submitting ||
                    !selectedEvent ||
                    (betType !== "exact_score" && !betSelection) ||
                    groupBalance < totalNeeded ||
                    maxAmountInteger < 1
                  }
                >
                  {submitting ? "Creando..." : `Publicar (${amount.toLocaleString()} tokens)`}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
    </>
  )
}

export default function CreateGroupBetPage() {
  return (
    <Suspense fallback={<><Navbar /><div className="p-8 text-center text-muted-foreground">Cargando...</div></>}>
      <CreateGroupBetInner />
    </Suspense>
  )
}
