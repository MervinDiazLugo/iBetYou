"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { formatCurrency } from "@/lib/utils"
import { useToast } from "@/components/toast"
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
}

const betTypes = [
  { id: "direct", label: "Directa", icon: "⚔️", desc: "Ambos arriesgan lo mismo" },
  { id: "exact_score", label: "Resultado Exacto", icon: "🎯", desc: "Apuesta al score exacto" },
  { id: "first_scorer", label: "Primer Anotador", icon: "🥅", desc: "Quién anota primero" },
  { id: "half_time", label: "Medio Tiempo", icon: "⏱️", desc: "Resultado primer tiempo" },
]

const sports = [
  { id: "football", name: "Fútbol", icon: "⚽" },
  { id: "basketball", name: "Basketball", icon: "🏀" },
  { id: "baseball", name: "Béisbol", icon: "⚾" },
]

function getAvailableBetTypes(sport: string) {
  // Tipos complejos habilitados solo para futbol.
  if (sport !== "football") {
    return betTypes.filter((type) => type.id !== "half_time" && type.id !== "first_scorer")
  }

  return betTypes
}

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
  const [balance, setBalance] = useState<{ fantasy: number; real: number }>({ fantasy: 0, real: 0 })
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  
  const [selectedSport, setSelectedSport] = useState("football")
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [betType, setBetType] = useState("direct")
  const [betSelection, setBetSelection] = useState<string>("")
  const [exactScoreHome, setExactScoreHome] = useState(0)
  const [exactScoreAway, setExactScoreAway] = useState(0)
  const [amount, setAmount] = useState(10)
  const [multiplier, setMultiplier] = useState(1)
  const [feeIncluded, setFeeIncluded] = useState(true)
  const [eventFilter, setEventFilter] = useState("")

  const fee = amount * 0.03
  const betAmount = feeIncluded ? amount - fee : amount
  const isAsymmetric = betType === "exact_score"
  const totalNeeded = amount + fee // el creador reserva monto base + fee al publicar
  const maxAmountByBalance = Math.max(
    0,
    Math.floor(((Number(balance.fantasy) || 0) / 1.03) * 100) / 100
  )
  const maxAllowedAmount = maxAmountByBalance
  const openedFromEventCard = Boolean(initialEvent && !cloneBetId)

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
          const message = data.error || "No se pudo clonar la apuesta"
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
              setExactScoreHome(sel.exactScoreHome)
            }
            if (sel.exactScoreAway !== undefined) {
              setExactScoreAway(sel.exactScoreAway)
            }
          } catch {
            if (bet.creator_selection) {
              setBetSelection(bet.creator_selection)
            }
          }
        }
      } catch (err) {
        console.error("Error loading clone bet:", err)
        const message = "No se pudo cargar la apuesta para clonar"
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

  const visibleEvents = openedFromEventCard && selectedEvent
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
    const options: { id: string; label: string; value: string }[] = []
    
    switch (betType) {
      case "direct":
        options.push({ id: "home_win", label: `Gana ${selectedEvent.home_team}`, value: selectedEvent.home_team })
        if (selectedSport !== "baseball") {
          options.push({ id: "draw", label: "Empate", value: "Empate" })
        }
        options.push({ id: "away_win", label: `Gana ${selectedEvent.away_team}`, value: selectedEvent.away_team })
        return options
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
          { id: "home_team", label: selectedEvent.home_team, value: selectedEvent.home_team },
          { id: "away_team", label: selectedEvent.away_team, value: selectedEvent.away_team },
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    const { data: { user: authUser } } = await supabase.auth.getUser()
    const { data: { session } } = await supabase.auth.getSession()

    let finalSelection = betSelection
    if (betType === "exact_score") {
      finalSelection = `${exactScoreHome}-${exactScoreAway}`
      if (exactScoreHome < 0 || exactScoreAway < 0) {
        setError("Ingresa un resultado válido")
        setLoading(false)
        return
      }
    }

    if (!authUser || !selectedEvent || !finalSelection) {
      setError("Selecciona una opción")
      setLoading(false)
      return
    }

    if ((Number(balance.fantasy) || 0) < totalNeeded) {
      setError("Balance insuficiente")
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
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        const message = data.error || "Error al crear la apuesta"
        showToast(message, "error")
        throw new Error(message)
      }

      showToast("Apuesta creada exitosamente!", "success")
      setLoading(false)
      router.push("/my-bets")
    } catch (err: any) {
      setError(err.message || "Error al crear la apuesta")
      setLoading(false)
    }
  }

  if (!user) return null

  return (
    <Card className="max-h-[82vh] sm:max-h-[86vh] flex flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-6 w-6 text-primary" />
          Crear Apuesta
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
            <label className="text-sm font-medium">Tipo de Apuesta</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {getAvailableBetTypes(selectedSport).map((type) => (
                <div
                  key={type.id}
                  className={`p-2 rounded-lg border cursor-pointer ${betType === type.id ? "border-primary bg-primary/10" : "hover:border-primary/50"}`}
                  onClick={() => setBetType(type.id)}
                >
                  <div className="flex items-center gap-2">
                    <span>{type.icon}</span>
                    <span className="font-medium text-sm">{type.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Partido</label>
            {!openedFromEventCard && (
              <Input
                placeholder="Buscar partido..."
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="mb-2"
              />
            )}
            <div className="grid gap-2 max-h-48 overflow-y-auto">
              {visibleEvents.map((event) => (
                <div
                  key={event.id}
                  className={`p-3 rounded-lg border cursor-pointer ${selectedEvent?.id === event.id ? "border-primary bg-primary/10" : "hover:border-primary/50"}`}
                  onClick={() => setSelectedEvent(event)}
                >
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span className="text-sm">
                      {event.sport === 'football' && '⚽'}
                      {event.sport === 'basketball' && '🏀'}
                      {event.sport === 'baseball' && '⚾'}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">{event.league}</Badge>
                    {event.country && <span className="text-[10px] text-muted-foreground">{event.country}</span>}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short" })} - {new Date(event.start_time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex-1 text-center">
                      {event.home_logo && <img src={event.home_logo} alt="" className="w-6 h-6 mx-auto mb-1 object-contain" />}
                      <span className="font-semibold text-xs">{event.home_team}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">vs</span>
                    <div className="flex-1 text-center">
                      {event.away_logo && <img src={event.away_logo} alt="" className="w-6 h-6 mx-auto mb-1 object-contain" />}
                      <span className="font-semibold text-xs">{event.away_team}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedEvent && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Tu Selección</label>
              {betType === "exact_score" ? (
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <p className="font-semibold mb-2">{selectedEvent.home_team}</p>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={exactScoreHome}
                      onChange={(e) => setExactScoreHome(Number(e.target.value))}
                      className="w-20 text-center"
                    />
                  </div>
                  <span className="text-2xl font-bold">-</span>
                  <div className="text-center">
                    <p className="font-semibold mb-2">{selectedEvent.away_team}</p>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={exactScoreAway}
                      onChange={(e) => setExactScoreAway(Number(e.target.value))}
                      className="w-20 text-center"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {getBetOptions().map((option) => (
                    <Button
                      key={option.id}
                      type="button"
                      variant={betSelection === option.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setBetSelection(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Monto (USD)</label>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                min={3}
                max={Math.max(3, maxAllowedAmount)}
                step="0.01"
                value={amount}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  if (!Number.isFinite(next)) {
                    setAmount(0)
                    return
                  }
                  const clamped = Math.min(Math.max(next, 0), Math.max(0, maxAllowedAmount))
                  setAmount(clamped)
                }}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Máximo disponible según tu balance: {formatCurrency(maxAllowedAmount)}
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

          <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-card/95 backdrop-blur border-t border-border">
            {(Number(balance.fantasy) || 0) < totalNeeded && (
              <p className="text-xs text-center text-destructive mb-2">
                Balance insuficiente
              </p>
            )}
            <div className="flex flex-row gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                Cancelar
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={loading || !selectedEvent || (!betSelection && betType !== "exact_score") || (Number(balance.fantasy) || 0) < totalNeeded || maxAllowedAmount < 3}
              >
                {loading ? "Creando..." : `Publicar (${formatCurrency(amount)})`}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
