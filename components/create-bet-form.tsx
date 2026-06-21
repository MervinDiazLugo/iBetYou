"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"
import { useMode } from "@/components/mode-provider"
import { Trophy, Calendar, DollarSign, AlertCircle } from "lucide-react"

interface Event {
  id: number
  sport: string
  home_team: string
  away_team: string
  home_logo?: string
  away_logo?: string
  start_time: string
  league: string
  country?: string
  metadata?: {
    venue?: { name?: string | null; city?: string | null }
    predictions?: {
      percent?: { home: string; draw: string; away: string } | null
      advice?: string | null
      winner?: string | null
      home_league_form?: string | null
      away_league_form?: string | null
      home_goals_avg?: string | null
      away_goals_avg?: string | null
    }
  }
}

const betTypes = [
  { id: "direct",                 label: "Resultado",      icon: "🏆", desc: "¿Quién gana?" },
  { id: "exact_score",            label: "Marcador exacto", icon: "🎯", desc: "Score exacto" },
  { id: "goals_over_under",       label: "Goles",          icon: "⚽", desc: "Over/Under goles" },
  { id: "both_teams_score",       label: "Ambos anotan",   icon: "🔁", desc: "¿Ambos equipos marcan?" },
  { id: "cards_over_under",       label: "Tarjetas",       icon: "🟨", desc: "Over/Under amarillas" },
  { id: "run_line",               label: "Run Line",       icon: "⚡", desc: "±1.5 carreras" },
  { id: "total_runs",             label: "Total carreras", icon: "📊", desc: "Over / Under" },
  { id: "first_inning_score",     label: "1er Inning",     icon: "⚾", desc: "NRFI / YRFI" },
  { id: "total_hits_over_under",  label: "Total Hits",     icon: "💥", desc: "Over / Under hits" },
  { id: "score_margin",           label: "Margen",         icon: "📏", desc: "Por cuántos puntos" },
  { id: "first_half_winner",      label: "1er Tiempo",     icon: "⏱️", desc: "Gana el 1er tiempo" },
  { id: "total_points_over_under",label: "Total Puntos",   icon: "🔢", desc: "Over / Under puntos" },
  { id: "first_scorer",           label: "Primer gol",     icon: "🥅", desc: "Quién anota primero" },
  { id: "half_time",              label: "Medio tiempo",   icon: "🕐", desc: "Resultado 1er tiempo" },
]

const sports = [
  { id: "football", name: "Fútbol", icon: "⚽" },
  { id: "basketball", name: "Basketball", icon: "🏀" },
  { id: "baseball", name: "Béisbol", icon: "⚾" },
]

function getAvailableBetTypes(sport: string) {
  if (sport === "football") return betTypes.filter((t) =>
    !["run_line", "total_runs", "score_margin", "first_inning_score", "total_hits_over_under", "first_half_winner", "total_points_over_under"].includes(t.id)
  )
  if (sport === "basketball") return betTypes.filter((t) =>
    ["direct", "score_margin", "first_half_winner", "total_points_over_under"].includes(t.id)
  )
  if (sport === "baseball") return betTypes.filter((t) =>
    ["direct", "run_line", "total_runs", "first_inning_score", "total_hits_over_under"].includes(t.id)
  )
  return betTypes.filter((t) => t.id === "direct")
}

const GOALS_OPTIONS = [
  { id: "over_0.5",  label: "Más de 0.5",  value: "over_0.5" },
  { id: "under_0.5", label: "Menos de 0.5", value: "under_0.5" },
  { id: "over_1.5",  label: "Más de 1.5",  value: "over_1.5" },
  { id: "under_1.5", label: "Menos de 1.5", value: "under_1.5" },
  { id: "over_2.5",  label: "Más de 2.5",  value: "over_2.5" },
  { id: "under_2.5", label: "Menos de 2.5", value: "under_2.5" },
  { id: "over_3.5",  label: "Más de 3.5",  value: "over_3.5" },
  { id: "under_3.5", label: "Menos de 3.5", value: "under_3.5" },
  { id: "over_4.5",  label: "Más de 4.5",  value: "over_4.5" },
  { id: "under_4.5", label: "Menos de 4.5", value: "under_4.5" },
]

const BOTH_TEAMS_OPTIONS = [
  { id: "yes", label: "Sí — ambos anotan",          value: "yes" },
  { id: "no",  label: "No — al menos uno no anota", value: "no" },
]

const FIRST_INNING_OPTIONS = [
  { id: "nrfi", label: "NRFI — Ningún equipo anota en el 1er inning", value: "nrfi" },
  { id: "yrfi", label: "YRFI — Al menos un equipo anota en el 1er inning", value: "yrfi" },
]

const TOTAL_HITS_OPTIONS = [
  { id: "over_12.5",  label: "Más de 12.5 hits",  value: "over_12.5" },
  { id: "under_12.5", label: "Menos de 12.5 hits", value: "under_12.5" },
  { id: "over_14.5",  label: "Más de 14.5 hits",  value: "over_14.5" },
  { id: "under_14.5", label: "Menos de 14.5 hits", value: "under_14.5" },
  { id: "over_16.5",  label: "Más de 16.5 hits",  value: "over_16.5" },
  { id: "under_16.5", label: "Menos de 16.5 hits", value: "under_16.5" },
  { id: "over_18.5",  label: "Más de 18.5 hits",  value: "over_18.5" },
  { id: "under_18.5", label: "Menos de 18.5 hits", value: "under_18.5" },
  { id: "over_20.5",  label: "Más de 20.5 hits",  value: "over_20.5" },
  { id: "under_20.5", label: "Menos de 20.5 hits", value: "under_20.5" },
]

const FIRST_HALF_WINNER_OPTIONS = [
  { id: "home", label: "Local gana el 1er tiempo",    value: "home" },
  { id: "draw", label: "Empate al descanso",           value: "draw" },
  { id: "away", label: "Visitante gana el 1er tiempo", value: "away" },
]

const TOTAL_POINTS_OPTIONS = [
  { id: "over_210.5",  label: "Más de 210.5 puntos",  value: "over_210.5" },
  { id: "under_210.5", label: "Menos de 210.5 puntos", value: "under_210.5" },
  { id: "over_220.5",  label: "Más de 220.5 puntos",  value: "over_220.5" },
  { id: "under_220.5", label: "Menos de 220.5 puntos", value: "under_220.5" },
  { id: "over_230.5",  label: "Más de 230.5 puntos",  value: "over_230.5" },
  { id: "under_230.5", label: "Menos de 230.5 puntos", value: "under_230.5" },
  { id: "over_240.5",  label: "Más de 240.5 puntos",  value: "over_240.5" },
  { id: "under_240.5", label: "Menos de 240.5 puntos", value: "under_240.5" },
  { id: "over_250.5",  label: "Más de 250.5 puntos",  value: "over_250.5" },
  { id: "under_250.5", label: "Menos de 250.5 puntos", value: "under_250.5" },
]

const CARDS_OPTIONS = [
  { id: "over_1.5",  label: "Más de 1.5",  value: "over_1.5" },
  { id: "under_1.5", label: "Menos de 1.5", value: "under_1.5" },
  { id: "over_2.5",  label: "Más de 2.5",  value: "over_2.5" },
  { id: "under_2.5", label: "Menos de 2.5", value: "under_2.5" },
  { id: "over_3.5",  label: "Más de 3.5",  value: "over_3.5" },
  { id: "under_3.5", label: "Menos de 3.5", value: "under_3.5" },
  { id: "over_4.5",  label: "Más de 4.5",  value: "over_4.5" },
  { id: "under_4.5", label: "Menos de 4.5", value: "under_4.5" },
  { id: "over_5.5",  label: "Más de 5.5",  value: "over_5.5" },
  { id: "under_5.5", label: "Menos de 5.5", value: "under_5.5" },
]

interface CreateBetFormProps {
  onClose: () => void
  cloneBetId?: string | null
  initialEvent?: Event | null
}

export function CreateBetForm({ onClose, cloneBetId, initialEvent }: CreateBetFormProps) {
  const router = useRouter()
  const supabase = createBrowserSupabaseClient()
  const { showToast } = useToast()
  
  const [user, setUser] = useState<{ email: string; nickname: string } | null>(null)
  const { mode } = useMode()
  const [balance, setBalance] = useState<{ fantasy: number; real: number; iBY: number }>({ fantasy: 0, real: 0, iBY: 0 })
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  
  const [selectedSport, setSelectedSport] = useState("football")
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [betType, setBetType] = useState("direct")
  const [betSelection, setBetSelection] = useState<string>("")
  const [exactScoreHome, setExactScoreHome] = useState("0")
  const [exactScoreAway, setExactScoreAway] = useState("0")
  const [amount, setAmount] = useState(() => {
    if (typeof window === "undefined") return 10
    const saved = Number(localStorage.getItem("lastBetAmount"))
    return Number.isFinite(saved) && saved > 0 ? saved : 10
  })
  const [amountStr, setAmountStr] = useState(() => {
    if (typeof window === "undefined") return "10"
    const saved = Number(localStorage.getItem("lastBetAmount"))
    return String(Number.isFinite(saved) && saved > 0 ? saved : 10)
  })
  const [multiplier, setMultiplier] = useState(1)
  const [feeIncluded, setFeeIncluded] = useState(true)
  const [balanceLoaded, setBalanceLoaded] = useState(false)
  const [eventFilter, setEventFilter] = useState("")
  const [maxBetSetting, setMaxBetSetting] = useState<number | null>(null)

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then(d => { if (d.max_bet_amount) setMaxBetSetting(d.max_bet_amount) })
      .catch(() => {})
  }, [])

  const fee = amount * 0.03
  const betAmount = feeIncluded ? amount - fee : amount
  const isAsymmetric = betType === "exact_score"
  const totalNeeded = amount + fee // el creador reserva monto base + fee al publicar
  const activeBalance = mode === "real" ? (Number(balance.iBY) || 0) : (Number(balance.fantasy) || 0)
  const maxAmountByBalance = Math.max(
    0,
    Math.floor((activeBalance / 1.03) * 100) / 100
  )
  const maxAllowedAmount = maxBetSetting !== null
    ? Math.min(maxAmountByBalance, maxBetSetting)
    : maxAmountByBalance
  const maxAmountInteger = Math.max(1, Math.floor(maxAllowedAmount))
  const openedFromEventCard = Boolean(initialEvent && !cloneBetId)
  const formatPesos = (value: number) => `$${value.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

  useEffect(() => {
    const availableBetTypes = getAvailableBetTypes(selectedSport)
    const currentBetTypeIsValid = availableBetTypes.some((type) => type.id === betType)

    if (!currentBetTypeIsValid) {
      setBetType("direct")
      setBetSelection("")
    }
  }, [selectedSport, betType])

  useEffect(() => {
    if (betType !== "exact_score" && multiplier !== 1) {
      setMultiplier(1)
    }
  }, [betType, multiplier])

  useEffect(() => {
    if (!balanceLoaded) return
    setAmount((prev) => {
      const normalized = Math.min(Math.max(Math.round(prev), 1), maxAmountInteger)
      setAmountStr(String(normalized))
      return normalized
    })
  }, [maxAmountInteger, balanceLoaded])

  useEffect(() => {
    async function checkAuth() {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        router.push("/login")
        return
      }

      // Get user info and balance from API
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token

        if (token) {
          const res = await fetch("/api/user/info", {
            headers: { 
              Authorization: `Bearer ${token}`,
            }
          })

          if (res.ok) {
            const data = await res.json()
            setUser({ email: data.user.email, nickname: data.user.nickname })
            setBalance(data.balance)
            setBalanceLoaded(true)
          }
        }
      } catch (err) {
        console.error("Error loading user info:", err)
      }
    }
    checkAuth()
  }, [router, supabase])

  // Load cloned bet data
  useEffect(() => {
    async function loadCloneBet() {
      if (!cloneBetId && initialEvent) return
      if (!cloneBetId) return
      
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser()
        const { data: { session } } = await supabase.auth.getSession()
        const userQuery = authUser?.id ? `?user_id=${authUser.id}` : ""

        const res = await fetch(`/api/bets/${cloneBetId}/clone${userQuery}`, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          }
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Error fetching clone bet" }))
          const message = data.error || "No se pudo clonar la predicción"
          setError(message)
          showToast(message, "error")
          return
        }

        const data = await res.json()
        const bet = data.bet

        if (bet && bet.event) {
          setSelectedSport(bet.event.sport)
          setSelectedEvent(bet.event)
          setBetType(bet.bet_type)
          setAmount(bet.amount)
          setAmountStr(String(bet.amount))
          setMultiplier(bet.multiplier || 1)

          // Parse selection
          try {
            const sel = JSON.parse(bet.selection)
            if (sel.selection) {
              setBetSelection(sel.selection)
            } else if (bet.creator_selection) {
              setBetSelection(bet.creator_selection)
            }
            if (sel.exactScoreHome !== undefined) {
              setExactScoreHome(String(sel.exactScoreHome))
            }
            if (sel.exactScoreAway !== undefined) {
              setExactScoreAway(String(sel.exactScoreAway))
            }
          } catch {
            if (bet.creator_selection) {
              setBetSelection(bet.creator_selection)
            }
          }
        }
      } catch (err) {
        console.error("Error loading clone bet:", err)
        const message = "No se pudo cargar la predicción para clonar"
        setError(message)
        showToast(message, "error")
      }
    }
    
    loadCloneBet()
  }, [cloneBetId])

  // Pre-select event from marketplace
  useEffect(() => {
    if (initialEvent && !cloneBetId) {
      setSelectedSport(initialEvent.sport)
      setSelectedEvent(initialEvent)
    }
  }, [initialEvent?.id])

  useEffect(() => {
    async function fetchEvents() {
      try {
        const res = await fetch(`/api/events/list?sport=${selectedSport}`)
        const data = await res.json()
        if (Array.isArray(data)) {
          const mappedEvents = data.map((match: any) => ({
            id: match.id,
            sport: match.sport,
            home_team: match.home_team,
            away_team: match.away_team,
            home_logo: match.home_logo,
            away_logo: match.away_logo,
            start_time: match.start_time,
            league: match.league,
            country: match.country,
          }))

          if (openedFromEventCard && initialEvent && initialEvent.sport === selectedSport) {
            const alreadyIncluded = mappedEvents.some((event: Event) => event.id === initialEvent.id)
            setEvents(alreadyIncluded ? mappedEvents : [initialEvent, ...mappedEvents])
            return
          }

          setEvents(mappedEvents)
        }
      } catch (err) {
        console.error("Error fetching events:", err)
      }
    }
    fetchEvents()
  }, [selectedSport, openedFromEventCard, initialEvent?.id])

  const visibleEvents = selectedEvent
    ? [selectedEvent]
    : events.filter((event) => {
        if (!eventFilter) return true
        const search = eventFilter.toLowerCase()
        return (
          event.home_team.toLowerCase().includes(search) ||
          event.away_team.toLowerCase().includes(search) ||
          event.league.toLowerCase().includes(search)
        )
      })

  const getBetOptions = () => {
    if (!selectedEvent) return []
    type Option = { id: string; label: string; value: string; logo?: string | null; sublabel?: string }
    const options: Option[] = []

    switch (betType) {
      case "direct":
        options.push({ id: "home_win", label: selectedEvent.home_team, value: selectedEvent.home_team, logo: selectedEvent.home_logo ?? null })
        if (selectedSport === "football") {
          options.push({ id: "draw", label: "Empate", value: "Empate", logo: null })
        }
        options.push({ id: "away_win", label: selectedEvent.away_team, value: selectedEvent.away_team, logo: selectedEvent.away_logo ?? null })
        return options
      case "goals_over_under":
        return GOALS_OPTIONS
      case "both_teams_score":
        return BOTH_TEAMS_OPTIONS
      case "cards_over_under":
        return CARDS_OPTIONS
      case "exact_score":
        return [
          { id: "1-0", label: "1-0", value: "1-0" },
          { id: "2-0", label: "2-0", value: "2-0" },
          { id: "2-1", label: "2-1", value: "2-1" },
          { id: "3-0", label: "3-0", value: "3-0" },
          { id: "3-1", label: "3-1", value: "3-1" },
          { id: "0-0", label: "0-0", value: "0-0" },
          { id: "0-1", label: "0-1", value: "0-1" },
          { id: "1-1", label: "1-1", value: "1-1" },
          { id: "1-2", label: "1-2", value: "1-2" },
          { id: "2-2", label: "2-2", value: "2-2" },
        ]
      case "first_scorer":
        return [
          { id: "home_team", label: selectedEvent.home_team, value: selectedEvent.home_team, logo: selectedEvent.home_logo ?? null },
          { id: "away_team", label: selectedEvent.away_team, value: selectedEvent.away_team, logo: selectedEvent.away_logo ?? null },
        ]
      case "run_line":
        return [
          { id: "home_rl", label: selectedEvent.home_team, sublabel: "Gana por 2 o más carreras", value: "home_rl", logo: selectedEvent.home_logo ?? null },
          { id: "away_rl", label: selectedEvent.away_team, sublabel: "Gana el partido o pierde por 1", value: "away_rl", logo: selectedEvent.away_logo ?? null },
        ]
      case "total_runs":
        return [
          { id: "over_7",   label: "Más de 7",   value: "over_7" },
          { id: "under_7",  label: "Menos de 7",  value: "under_7" },
          { id: "over_8",   label: "Más de 8",   value: "over_8" },
          { id: "under_8",  label: "Menos de 8",  value: "under_8" },
          { id: "over_9",   label: "Más de 9",   value: "over_9" },
          { id: "under_9",  label: "Menos de 9",  value: "under_9" },
          { id: "over_10",  label: "Más de 10",  value: "over_10" },
          { id: "under_10", label: "Menos de 10", value: "under_10" },
        ]
      case "first_inning_score":
        return FIRST_INNING_OPTIONS
      case "total_hits_over_under":
        return TOTAL_HITS_OPTIONS
      case "first_half_winner":
        return [
          { id: "home", label: `${selectedEvent.home_team} gana el 1er tiempo`,    value: "home", logo: selectedEvent.home_logo ?? null },
          { id: "draw", label: "Empate al descanso",                                  value: "draw", logo: null },
          { id: "away", label: `${selectedEvent.away_team} gana el 1er tiempo`, value: "away", logo: selectedEvent.away_logo ?? null },
        ]
      case "total_points_over_under":
        return TOTAL_POINTS_OPTIONS
      case "score_margin":
        return [
          { id: "home_1_5",    label: `${selectedEvent.home_team} +1–5`,   value: "home_1_5" },
          { id: "home_6_10",   label: `${selectedEvent.home_team} +6–10`,  value: "home_6_10" },
          { id: "home_11_15",  label: `${selectedEvent.home_team} +11–15`, value: "home_11_15" },
          { id: "home_16plus", label: `${selectedEvent.home_team} +16`,    value: "home_16plus" },
          { id: "away_1_5",    label: `${selectedEvent.away_team} +1–5`,   value: "away_1_5" },
          { id: "away_6_10",   label: `${selectedEvent.away_team} +6–10`,  value: "away_6_10" },
          { id: "away_11_15",  label: `${selectedEvent.away_team} +11–15`, value: "away_11_15" },
          { id: "away_16plus", label: `${selectedEvent.away_team} +16`,    value: "away_16plus" },
        ]
      case "half_time":
        return [
          { id: "home_win", label: selectedEvent.home_team, value: `${selectedEvent.home_team} HT`, logo: selectedEvent.home_logo ?? null },
          { id: "draw",     label: "Empate",                value: "Empate HT",                      logo: null },
          { id: "away_win", label: selectedEvent.away_team, value: `${selectedEvent.away_team} HT`, logo: selectedEvent.away_logo ?? null },
        ]
      default:
        return []
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    const { data: { user: authUser } } = await supabase.auth.getUser()
    const { data: { session } } = await supabase.auth.getSession()

    let finalSelection = betSelection
    if (betType === "exact_score") {
      const homeNum = Number(exactScoreHome)
      const awayNum = Number(exactScoreAway)
      if (!Number.isFinite(homeNum) || !Number.isFinite(awayNum) || homeNum < 0 || awayNum < 0) {
        setError("Ingresa un resultado válido")
        setLoading(false)
        return
      }
      finalSelection = `${homeNum}-${awayNum}`
    }

    if (!authUser || !selectedEvent || !finalSelection) {
      setError("Selecciona una opción")
      setLoading(false)
      return
    }

    if (activeBalance < totalNeeded) {
      setError(mode === "real" ? "Saldo iBYC insuficiente" : "Balance insuficiente")
      setLoading(false)
      return
    }

    // Call API to create bet
    try {
      const res = await fetch("/api/bets/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          userId: authUser.id,
          eventId: selectedEvent.id,
          betType,
          selection: { betType, selection: finalSelection, exactScoreHome, exactScoreAway, event: selectedEvent },
          amount: betAmount,
          multiplier,
          fee,
          mode,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        if (data.banned) {
          showToast("Tu cuenta fue suspendida por seguridad. Comunícate con soporte.", "error")
          await supabase.auth.signOut()
          router.push("/")
          return
        }
        const message = data.error || "Error al crear la predicción"
        showToast(message, "error")
        throw new Error(message)
      }

      showToast("¡Predicción publicada! 🎯", "success", "Ya está en el marketplace esperando a alguien que la tome.")
      localStorage.setItem("lastBetAmount", String(amount))
      window.dispatchEvent(new Event("wallet:updated"))
      setLoading(false)
      onClose()
    } catch (err: any) {
      setError(err.message || "Error al crear la predicción")
      setLoading(false)
    }
  }

  if (!user) return null

  return (
    <Card className="max-h-[82vh] sm:max-h-[86vh] flex flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-6 w-6 text-primary" />
          Crear Predicción
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 flex-1 overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4 pb-4">
          {error && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Deporte</label>
            <div className="flex flex-wrap gap-2">
              {sports.map((sport) => (
                <Button
                  key={sport.id}
                  type="button"
                  variant={selectedSport === sport.id ? "default" : "outline"}
                  size="sm"
                  disabled={openedFromEventCard}
                  onClick={() => { setSelectedSport(sport.id); setSelectedEvent(null) }}
                >
                  {sport.icon} {sport.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Tipo de Predicción</label>
            <div className="grid grid-cols-2 gap-2">
              {getAvailableBetTypes(selectedSport).map((type) => {
                const isActive = betType === type.id
                return (
                  <div
                    key={type.id}
                    onClick={() => setBetType(type.id)}
                    className={`relative cursor-pointer rounded-xl border-2 py-3 px-2 text-center transition-all select-none ${
                      isActive
                        ? "border-primary bg-primary/15 shadow-md shadow-primary/20"
                        : "border-border bg-muted/10 hover:border-primary/40 hover:bg-muted/20"
                    }`}
                  >
                    {isActive && (
                      <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                        <span className="text-[9px] text-primary-foreground font-bold">✓</span>
                      </div>
                    )}
                    <div className="text-xl mb-1">{type.icon}</div>
                    <div className={`text-xs font-bold leading-tight ${isActive ? "text-primary" : ""}`}>{type.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{type.desc}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium">Evento</label>
              {!openedFromEventCard && selectedEvent && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setSelectedEvent(null)
                    setBetSelection("")
                  }}
                >
                  Cancelar seleccion
                </Button>
              )}
            </div>
            {!openedFromEventCard && !selectedEvent && (
              <Input
                placeholder="Buscar evento..."
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="mb-2"
              />
            )}
            <div className="grid gap-2 max-h-48 overflow-y-auto">
              {visibleEvents.map((event) => (
                <div
                  key={event.id}
                  className={`p-2.5 rounded-lg border cursor-pointer ${selectedEvent?.id === event.id ? "border-primary bg-primary/10" : "hover:border-primary/50"}`}
                  onClick={() => setSelectedEvent(event)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-[30%] min-w-[108px] rounded-md bg-muted/20 px-2 py-1.5">
                      <div className="flex items-center gap-1 text-[10px] leading-tight min-w-0">
                        <span className="text-sm shrink-0">
                          {event.sport === 'football' && '⚽'}
                          {event.sport === 'basketball' && '🏀'}
                          {event.sport === 'baseball' && '⚾'}
                        </span>
                        <span className="truncate font-medium">{event.league}</span>
                        {event.country && (
                          <>
                            <span className="text-muted-foreground shrink-0">|</span>
                            <span className="truncate text-muted-foreground">{event.country}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground truncate" title={`${new Date(event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short" })} - ${new Date(event.start_time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}${(event.metadata?.venue?.name || event.metadata?.venue?.city) ? ` · ${[event.metadata?.venue?.name, event.metadata?.venue?.city].filter(Boolean).join(', ')}` : ''}`}>
                        {new Date(event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short" })} - {new Date(event.start_time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                        {(event.metadata?.venue?.name || event.metadata?.venue?.city) && ` · ${[event.metadata?.venue?.name, event.metadata?.venue?.city].filter(Boolean).join(', ')}`}
                      </div>
                    </div>

                    <div className="w-[70%] min-w-0 flex items-center">
                      <div className="w-full flex items-center min-w-0 px-1">
                        <div className="w-[calc(50%-18px)] min-w-0 flex items-center gap-2.5">
                          {event.home_logo ? (
                            <img src={event.home_logo} alt="" className="w-5 h-5 object-contain shrink-0" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold shrink-0">
                              {event.home_team.slice(0, 1)}
                            </div>
                          )}
                          <span className="font-semibold text-xs truncate">{event.home_team}</span>
                        </div>

                        <span className="w-9 text-center text-[11px] text-muted-foreground shrink-0 px-1"> vs </span>

                        <div className="w-[calc(50%-18px)] min-w-0 flex items-center justify-end gap-2.5">
                          <span className="font-semibold text-xs truncate text-right">{event.away_team}</span>
                          {event.away_logo ? (
                            <img src={event.away_logo} alt="" className="w-5 h-5 object-contain shrink-0" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold shrink-0">
                              {event.away_team.slice(0, 1)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedEvent?.metadata?.predictions?.percent && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 space-y-3">
              <div className="text-xs font-semibold text-blue-300 mb-1">🤖 Análisis</div>
              <div className="flex gap-2">
                <div className="flex-1 rounded-md bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5 truncate">{selectedEvent.home_team}</div>
                  <div className="text-lg font-bold text-blue-300">{selectedEvent.metadata.predictions.percent.home}</div>
                  {selectedEvent.metadata.predictions.home_league_form && (
                    <div className="flex gap-0.5 justify-center mt-1">
                      {selectedEvent.metadata.predictions.home_league_form.slice(-5).split("").map((c, i) => (
                        <span key={i} className={`inline-block w-2 h-2 rounded-full ${c === "W" ? "bg-green-500" : c === "D" ? "bg-gray-400" : "bg-red-500"}`} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1 rounded-md bg-gray-500/10 border border-gray-500/20 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5">Empate</div>
                  <div className="text-lg font-bold text-gray-300">{selectedEvent.metadata.predictions.percent.draw}</div>
                </div>
                <div className="flex-1 rounded-md bg-orange-500/10 border border-orange-500/20 p-2 text-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5 truncate">{selectedEvent.away_team}</div>
                  <div className="text-lg font-bold text-orange-300">{selectedEvent.metadata.predictions.percent.away}</div>
                  {selectedEvent.metadata.predictions.away_league_form && (
                    <div className="flex gap-0.5 justify-center mt-1">
                      {selectedEvent.metadata.predictions.away_league_form.slice(-5).split("").map((c, i) => (
                        <span key={i} className={`inline-block w-2 h-2 rounded-full ${c === "W" ? "bg-green-500" : c === "D" ? "bg-gray-400" : "bg-red-500"}`} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {selectedEvent.metadata.predictions.advice && (
                <p className="text-xs text-center text-amber-300/80 leading-snug">
                  💡 {selectedEvent.metadata.predictions.advice}
                </p>
              )}
              {(selectedEvent.metadata.predictions.home_goals_avg || selectedEvent.metadata.predictions.away_goals_avg) && (
                <div className="flex justify-between text-[10px] text-muted-foreground px-1">
                  <span>Goles/partido: <span className="text-foreground font-semibold">{selectedEvent.metadata.predictions.home_goals_avg}</span></span>
                  <span>Goles/partido: <span className="text-foreground font-semibold">{selectedEvent.metadata.predictions.away_goals_avg}</span></span>
                </div>
              )}
            </div>
          )}

          {selectedEvent && (
            <div className="space-y-2">
              <label className="text-sm font-semibold flex items-center gap-2">
                <span className="w-1 h-4 rounded-full bg-primary inline-block" />
                Tu Selección
              </label>
              {betType === "goals_over_under" && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  ⚽ Predicción al <strong>total de goles del partido</strong> (ambos equipos). Ej: <em>Más de 2.5</em> = el partido debe terminar con 3 o más goles.
                </p>
              )}
              {betType === "both_teams_score" && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  🔁 Predicción sobre si <strong>ambos equipos marcan al menos un gol</strong>. Si alguno de los dos no anota, la opción "No" gana.
                </p>
              )}
              {betType === "cards_over_under" && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  🟨 Predicción al <strong>total de tarjetas amarillas</strong> en el partido (ambos equipos). Las rojas no cuentan. Ej: <em>Más de 3.5</em> = el partido debe tener 4 o más amarillas.
                </p>
              )}
              {betType === "total_runs" && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  📊 Predicción al <strong>total de carreras sumadas entre los dos equipos</strong>. Ej: si el marcador es {selectedEvent?.home_team} 5 – {selectedEvent?.away_team} 3, hay <strong>8 carreras totales</strong> en el partido.
                </p>
              )}
              {betType === "score_margin" && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  📏 Elegí un equipo <strong>y por cuántos puntos gana</strong>. Ej: <em>{selectedEvent?.home_team} +6–10</em> = ese equipo gana por entre 6 y 10 puntos. Si gana por 3 o por 15, tu predicción pierde aunque aciertes el equipo ganador.
                </p>
              )}
              {betType === "run_line" && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  📐 <strong>Run Line</strong> es una predicción de handicap de 1.5 carreras. El equipo con <strong>-1.5</strong> necesita ganar por 2 o más carreras. El equipo con <strong>+1.5</strong> gana si ese equipo gana <em>o</em> pierde por solo 1 carrera.
                </p>
              )}
              {betType === "exact_score" ? (
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    {selectedEvent.home_logo && (
                      <img src={selectedEvent.home_logo} alt="" className="w-10 h-10 mx-auto mb-1 object-contain" />
                    )}
                    <p className="font-semibold mb-2 text-sm">{selectedEvent.home_team}</p>
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={exactScoreHome}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, "")
                        setExactScoreHome(v)
                      }}
                      onBlur={() => {
                        if (exactScoreHome === "") setExactScoreHome("0")
                      }}
                      className="w-20 text-center"
                    />
                  </div>
                  <span className="text-2xl font-bold">-</span>
                  <div className="text-center">
                    {selectedEvent.away_logo && (
                      <img src={selectedEvent.away_logo} alt="" className="w-10 h-10 mx-auto mb-1 object-contain" />
                    )}
                    <p className="font-semibold mb-2 text-sm">{selectedEvent.away_team}</p>
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={exactScoreAway}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, "")
                        setExactScoreAway(v)
                      }}
                      onBlur={() => {
                        if (exactScoreAway === "") setExactScoreAway("0")
                      }}
                      className="w-20 text-center"
                    />
                  </div>
                </div>
              ) : (
                <div className={`grid gap-2 ${["score_margin", "total_runs", "cards_over_under"].includes(betType) ? "grid-cols-2" : "grid-cols-3"}`}>
                  {getBetOptions().map((option) => {
                    const sub = (option as any).sublabel as string | undefined
                    const logo = (option as any).logo as string | null | undefined
                    const hasLogoSlot = "logo" in option
                    const isSelected = betSelection === option.value

                    if (hasLogoSlot) {
                      return (
                        <div
                          key={option.id}
                          onClick={() => setBetSelection(option.value)}
                          className={`relative cursor-pointer rounded-xl border-2 py-4 px-2 text-center transition-all select-none ${
                            isSelected
                              ? "border-primary bg-primary/15 shadow-md shadow-primary/20"
                              : "border-border bg-muted/10 hover:border-primary/40 hover:bg-muted/20"
                          }`}
                        >
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                              <span className="text-[9px] text-primary-foreground font-bold">✓</span>
                            </div>
                          )}
                          {logo ? (
                            <img src={logo} alt="" className="w-10 h-10 mx-auto mb-2 object-contain drop-shadow-sm" />
                          ) : (
                            <div className="text-3xl mb-2">🤝</div>
                          )}
                          <div className={`text-xs font-bold leading-tight truncate px-1 ${isSelected ? "text-primary" : ""}`}>
                            {option.label}
                          </div>
                          {sub && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight px-1">{sub}</div>
                          )}
                        </div>
                      )
                    }

                    return (
                      <Button
                        key={option.id}
                        type="button"
                        variant={isSelected ? "default" : "outline"}
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

          <div className="space-y-2">
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-sm">Monto seleccionado</span>
                </div>
                <span className="text-lg font-semibold">{formatPesos(amount)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={maxAmountInteger}
                step={1}
                value={amount}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setAmount(v)
                  setAmountStr(String(v))
                }}
                className="w-full accent-yellow-500"
                style={{ accentColor: "#eab308" }}
                aria-label="Monto de predicción"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>$1</span>
                <span>{formatPesos(maxAmountInteger)}</span>
              </div>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={amountStr}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, "")
                  setAmountStr(raw)
                  const v = Number(raw)
                  if (raw !== "" && Number.isFinite(v) && v >= 1) {
                    setAmount(Math.min(v, maxAmountInteger))
                  }
                }}
                onBlur={() => {
                  const v = Number(amountStr)
                  const clamped = Math.min(Math.max(Number.isFinite(v) ? v : 1, 1), maxAmountInteger)
                  setAmount(clamped)
                  setAmountStr(String(clamped))
                }}
                className="mt-2 w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Máx. disponible: {formatPesos(maxAmountByBalance)} {mode === "real" ? "iBY" : "Fantasy"}</span>
              {maxBetSetting !== null && (
                <span className="text-yellow-600 dark:text-yellow-400 font-medium">Límite plataforma: {formatPesos(maxBetSetting)}</span>
              )}
            </div>
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

          <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-card/95 backdrop-blur border-t border-border">
            {(mode === "real" ? (Number(balance.iBY) || 0) : (Number(balance.fantasy) || 0)) < totalNeeded && (
              <p className="text-xs text-center text-destructive mb-2">
                {mode === "real" ? "Saldo iBYC insuficiente" : "Balance insuficiente"}
              </p>
            )}
            <div className="flex flex-row gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                Cancelar
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={loading || !selectedEvent || (!betSelection && betType !== "exact_score") || (mode === "real" ? (Number(balance.iBY) || 0) : (Number(balance.fantasy) || 0)) < totalNeeded || maxAllowedAmount < 1}
              >
                {loading ? "Creando..." : `Publicar (${formatPesos(amount)})`}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
