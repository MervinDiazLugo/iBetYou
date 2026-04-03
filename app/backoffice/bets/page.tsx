"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { 
  Trophy, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Search,
  RefreshCw
} from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { createBrowserSupabaseClient } from "@/lib/supabase"

interface Bet {
  id: string
  event_id: number
  creator_id: string
  acceptor_id: string | null
  creator_email?: string | null
  acceptor_email?: string | null
  type: string
  bet_type: string
  amount: number
  multiplier: number
  creator_selection: string
  status: string
  created_at: string
  event: {
    home_team: string
    away_team: string
    start_time: string
    league: string
    sport: string
    status?: string
  }
  creator: {
    nickname: string
    email: string
  }
  acceptor?: {
    nickname: string
    email: string
  }
  decision_history?: {
    id: string
    action: string
    previous_status?: string | null
    new_status?: string | null
    reason?: string | null
    source?: string | null
    decided_by?: string | null
    created_at: string
  }[]
}

interface EventWithBets {
  id: number
  external_id: string | null
  sport: string
  home_team: string
  away_team: string
  home_logo?: string | null
  away_logo?: string | null
  start_time: string
  status: string
  home_score: number | null
  away_score: number | null
  league?: string | null
  country?: string | null
  total_bets: number
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "Abierta", color: "text-green-500", bg: "bg-green-500/10" },
  taken: { label: "Tomada", color: "text-blue-500", bg: "bg-blue-500/10" },
  pending_resolution_creator: { label: "Pende Aprob (Creador)", color: "text-orange-500", bg: "bg-orange-500/10" },
  pending_resolution_acceptor: { label: "Pende Aprob (Aceptante)", color: "text-orange-500", bg: "bg-orange-500/10" },
  resolved: { label: "Resuelta", color: "text-purple-500", bg: "bg-purple-500/10" },
  cancelled: { label: "Cancelada", color: "text-red-500", bg: "bg-red-500/10" },
  disputed: { label: "En disputa", color: "text-yellow-500", bg: "bg-yellow-500/10" },
}

const cancellationReasonOptions = [
  { value: "event_cancelled", label: "Evento suspendido o cancelado" },
  { value: "result_unreliable", label: "Resultado del evento no confiable" },
  { value: "invalid_data", label: "Apuesta creada con datos incorrectos" },
  { value: "suspected_fraud", label: "Posible fraude o comportamiento sospechoso" },
  { value: "support_request", label: "Solicitud de soporte validada" },
  { value: "operational_error", label: "Error operativo de la plataforma" },
  { value: "other", label: "Otro (escribir manual)" },
]

export default function BackofficeBets() {
  const supabase = createBrowserSupabaseClient()
  const [bets, setBets] = useState<Bet[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedBet, setSelectedBet] = useState<Bet | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [autoResolving, setAutoResolving] = useState<string | null>(null)
  const [selectedPendingBets, setSelectedPendingBets] = useState<Set<string>>(new Set())
  const [expandedHistoryBets, setExpandedHistoryBets] = useState<Set<string>>(new Set())
  const [cancelTargetBet, setCancelTargetBet] = useState<Bet | null>(null)
  const [cancelReasonOption, setCancelReasonOption] = useState<string>(cancellationReasonOptions[0].value)
  const [cancelReasonManual, setCancelReasonManual] = useState<string>("")
  const [eventsWithBets, setEventsWithBets] = useState<EventWithBets[]>([])
  const [loadingEventsWithBets, setLoadingEventsWithBets] = useState(false)
  const [syncingEventId, setSyncingEventId] = useState<number | null>(null)

  async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) {
      headers.set("Authorization", `Bearer ${session.access_token}`)
    }

    return fetch(input, {
      ...init,
      headers,
    })
  }

  async function fetchBets() {
    setLoading(true)
    try {
      const statusParam = statusFilter !== 'all' ? `&status=${statusFilter}` : ''
      const res = await authFetch(`/api/admin/bets?limit=100${statusParam}`)
      const data = await res.json()
      setBets(data.bets || [])
    } catch (err) {
      console.error('Error fetching bets:', err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchEventsWithBets() {
    setLoadingEventsWithBets(true)
    try {
      const res = await authFetch('/api/admin/events/results')
      const data = await res.json()
      setEventsWithBets(data.events || [])
    } catch (err) {
      console.error('Error fetching events with bets:', err)
    } finally {
      setLoadingEventsWithBets(false)
    }
  }

  useEffect(() => {
    fetchBets()
  }, [statusFilter])

  useEffect(() => {
    fetchEventsWithBets()
  }, [])

  function openCancelModal(bet: Bet) {
    setCancelTargetBet(bet)
    setCancelReasonOption(cancellationReasonOptions[0].value)
    setCancelReasonManual("")
  }

  async function confirmCancelBet() {
    if (!cancelTargetBet) return

    const selectedOption = cancellationReasonOptions.find((item) => item.value === cancelReasonOption)
    const reason = cancelReasonOption === "other"
      ? cancelReasonManual.trim()
      : (selectedOption?.label || "Cancelada por administración")

    if (!reason) {
      alert("Debes escribir un motivo manual")
      return
    }

    await handleAction(cancelTargetBet.id, 'cancel', undefined, reason)
  }

  async function handleAction(betId: string, action: string, winnerId?: string, reason?: string) {
    setActionLoading(true)
    try {
      const res = await authFetch('/api/admin/bets', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bet_id: betId, action, winner_id: winnerId, reason })
      })

      if (res.ok) {
        fetchBets()
        setSelectedBet(null)
        setCancelTargetBet(null)
        setCancelReasonManual("")
      } else {
        const data = await res.json()
        alert(data.error || 'Error al realizar la acción')
      }
    } catch (err) {
      console.error('Error:', err)
    } finally {
      setActionLoading(false)
    }
  }

  async function autoResolveBet(betId: string, eventId: number) {
    setAutoResolving(betId)
    try {
      const res = await authFetch('/api/admin/bets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bet_id: betId, event_id: eventId })
      })

      const data = await res.json()
      const scoreInfo = (data.homeScore !== undefined && data.awayScore !== undefined)
        ? `Marcador usado: ${data.homeScore} - ${data.awayScore}`
        : 'Marcador no disponible'
      const sourceInfo = data.score_source === 'external_api'
        ? 'Fuente: API externa (guardado en BD)'
        : 'Fuente: BD (resultado previamente guardado)'
      
      if (res.ok) {
        if (data.pending_approval) {
          alert(`${scoreInfo}\n${sourceInfo}\n\nPendiente de aprobación. El dinero se transferirá al aprobar.`)
        } else if (data.result === 'tie') {
          alert(`${scoreInfo}\n${sourceInfo}\n\nEmpate. Dinero devuelto a ambos.`)
        } else if (data.success === false && data.error) {
          alert(`${scoreInfo}\n${sourceInfo}\n\nAuto-resolver envió la apuesta a disputa.\nMotivo: ${data.error}`)
        } else {
          alert(`${scoreInfo}\n${sourceInfo}\n\nAuto-resolución ejecutada`)
        }
        fetchBets()
      } else {
        alert(data.error || 'Error al auto-resolver')
      }
    } catch (err) {
      console.error('Error:', err)
    } finally {
      setAutoResolving(null)
    }
  }

  async function syncEventResult(eventId: number) {
    setSyncingEventId(eventId)
    try {
      const res = await authFetch('/api/admin/events/results', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event_id: eventId })
      })

      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Error al consultar marcador del evento')
        return
      }

      alert(`Marcador guardado: ${data.event.home_score ?? '-'} - ${data.event.away_score ?? '-'}\nEstado: ${data.event.status}`)
      fetchEventsWithBets()
      fetchBets()
    } catch (err) {
      console.error('Error syncing event result:', err)
    } finally {
      setSyncingEventId(null)
    }
  }

  async function approveSelectedPending() {
    if (selectedPendingBets.size === 0) {
      alert('Selecciona al menos una apuesta')
      return
    }
    
    setActionLoading(true)
    try {
      const reason = window.prompt('Motivo de aprobación (opcional):', 'Aprobacion manual de apuestas pendientes') || undefined

      const res = await authFetch('/api/admin/bets', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          action: 'approve_pending', 
          bet_ids: Array.from(selectedPendingBets),
          reason,
        })
      })

      const data = await res.json()
      
      if (res.ok) {
        const successCount = data.results?.filter((r: any) => r.success).length || 0
        alert(`Se aprobaron ${successCount} apuestas`)
        setSelectedPendingBets(new Set())
        fetchBets()
      } else {
        alert(data.error || 'Error al aprobar')
      }
    } catch (err) {
      console.error('Error:', err)
    } finally {
      setActionLoading(false)
    }
  }

  function togglePendingBetSelection(betId: string) {
    const newSelected = new Set(selectedPendingBets)
    if (newSelected.has(betId)) {
      newSelected.delete(betId)
    } else {
      newSelected.add(betId)
    }
    setSelectedPendingBets(newSelected)
  }

  function toggleHistory(betId: string) {
    const newSet = new Set(expandedHistoryBets)
    if (newSet.has(betId)) newSet.delete(betId)
    else newSet.add(betId)
    setExpandedHistoryBets(newSet)
  }

  const STATUS_ORDER: Record<string, number> = {
    disputed: 0,
    pending_resolution_creator: 1,
    pending_resolution_acceptor: 2,
    taken: 3,
    open: 4,
    resolved: 5,
    cancelled: 6,
  }

  const filteredBets = bets
    .filter(bet => {
      if (!filter) return true
      const search = filter.toLowerCase()
      return (
        bet.event.home_team.toLowerCase().includes(search) ||
        bet.event.away_team.toLowerCase().includes(search) ||
        bet.creator?.nickname?.toLowerCase().includes(search) ||
        bet.id.includes(search)
      )
    })
    .sort((a, b) => {
      const orderA = STATUS_ORDER[a.status] ?? 99
      const orderB = STATUS_ORDER[b.status] ?? 99
      if (orderA !== orderB) return orderA - orderB
      // Same status: most recent first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  function eventStatusClasses(status: string) {
    if (status === "live") return "bg-red-500/15 text-red-500 border-red-500/30"
    if (status === "finished") return "bg-green-500/15 text-green-500 border-green-500/30"
    return "bg-slate-500/15 text-slate-300 border-slate-500/30"
  }

  function teamInitials(name: string) {
    const words = name.trim().split(" ").filter(Boolean)
    if (words.length === 0) return "?"
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Moderación de Apuestas</h1>
          <p className="text-muted-foreground">Gestiona y resuelve apuestas</p>
        </div>
        <Button onClick={fetchBets} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por equipo, usuario o ID..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-10"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-background"
            >
              <option value="all">Todos los estados</option>
              <option value="open">Abiertas</option>
              <option value="taken">Tomadas</option>
              <option value="pending_resolution_creator">Pendientes (Creador Ganó)</option>
              <option value="pending_resolution_acceptor">Pendientes (Aceptante Ganó)</option>
              <option value="resolved">Resueltas</option>
              <option value="cancelled">Canceladas</option>
              <option value="disputed">En disputa</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg">Eventos con apuestas (consulta independiente)</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Consulta marcador final en API externa y guárdalo localmente, sin arbitrar apuestas.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchEventsWithBets}>
              {loadingEventsWithBets ? 'Actualizando...' : 'Actualizar eventos'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingEventsWithBets ? (
            <p className="text-sm text-muted-foreground">Cargando eventos con apuestas...</p>
          ) : eventsWithBets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay eventos con apuestas activas.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {eventsWithBets.map((eventItem) => (
                <div
                  key={eventItem.id}
                  className="rounded-xl border border-border/70 p-4 bg-gradient-to-b from-secondary/40 to-background"
                >
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <Badge variant="outline" className="text-[11px]">
                      {eventItem.league || "Liga"}
                    </Badge>
                    <Badge className={`border text-[11px] ${eventStatusClasses(eventItem.status)}`}>
                      {eventItem.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {eventItem.home_logo ? (
                        <img
                          src={eventItem.home_logo}
                          alt={eventItem.home_team}
                          className="h-10 w-10 object-contain"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-secondary border flex items-center justify-center text-xs font-semibold">
                          {teamInitials(eventItem.home_team)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium leading-tight truncate">{eventItem.home_team}</div>
                        <div className="text-lg font-bold leading-none mt-1">{eventItem.home_score ?? "-"}</div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-2 text-center">
                      <div className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs font-semibold text-muted-foreground">
                        VS
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        {eventItem.home_score ?? "-"} : {eventItem.away_score ?? "-"}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 min-w-0">
                      <div className="min-w-0 flex-1 text-right">
                        <div className="text-xs font-medium leading-tight truncate">{eventItem.away_team}</div>
                        <div className="text-lg font-bold leading-none mt-1">{eventItem.away_score ?? "-"}</div>
                      </div>
                      {eventItem.away_logo ? (
                        <img
                          src={eventItem.away_logo}
                          alt={eventItem.away_team}
                          className="h-10 w-10 object-contain"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-secondary border flex items-center justify-center text-xs font-semibold">
                          {teamInitials(eventItem.away_team)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatDate(eventItem.start_time)}</span>
                    <span>Apuestas: {eventItem.total_bets}</span>
                  </div>

                  <Button
                    className="w-full mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => syncEventResult(eventItem.id)}
                    disabled={syncingEventId === eventItem.id}
                  >
                    {syncingEventId === eventItem.id ? 'Consultando...' : 'Consultar y guardar marcador'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Approval Section */}
      {bets.some(b => b.status === 'pending_resolution_creator' || b.status === 'pending_resolution_acceptor') && (
        <Card className="border-orange-500 bg-orange-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-orange-500">Pendientes de Aprobación</h2>
              <Button
                size="sm"
                onClick={approveSelectedPending}
                disabled={selectedPendingBets.size === 0 || actionLoading}
              >
                Aprobar Seleccionadas ({selectedPendingBets.size})
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Estas apuestas fueron auto-resueltas. Requieren aprobación para transferir el dinero al ganador.
            </p>
          </CardHeader>
        </Card>
      )}

      {/* Bets List */}
      {loading ? (
        <div className="text-center py-12">Cargando...</div>
      ) : filteredBets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Trophy className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No hay apuestas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredBets.map((bet) => {
            const status = statusConfig[bet.status] || { label: bet.status, color: 'text-gray-500', bg: 'bg-gray-500/10' }
            const potentialWin = bet.amount * bet.multiplier + bet.amount
            
            return (
              <Card key={bet.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge className={status.bg}>
                        <span className={status.color}>{status.label}</span>
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {bet.event.league}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(bet.created_at)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-bold">{bet.event.home_team}</span>
                        <span className="text-muted-foreground">vs</span>
                        <span className="font-bold">{bet.event.away_team}</span>
                        <Badge variant="outline" className="text-[11px]">ID: {bet.id.slice(0, 8)}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Creador: </span>
                          <span className="font-medium">{bet.creator?.nickname}</span>
                          <div className="text-xs text-muted-foreground mt-1">
                            ID: {bet.creator_id}
                          </div>
                          {bet.creator_email && (
                            <div className="text-xs text-muted-foreground">
                              Email: {bet.creator_email}
                            </div>
                          )}
                        </div>
                        {bet.acceptor && (
                          <div>
                            <span className="text-muted-foreground">Tomada por: </span>
                            <span className="font-medium">{bet.acceptor?.nickname}</span>
                            <div className="text-xs text-muted-foreground mt-1">
                              ID: {bet.acceptor_id}
                            </div>
                            {bet.acceptor_email && (
                              <div className="text-xs text-muted-foreground">
                                Email: {bet.acceptor_email}
                              </div>
                            )}
                          </div>
                        )}
                        <div>
                          <Link href={`/bet/${bet.id}`} className="text-primary underline underline-offset-4">
                            Ver detalles
                          </Link>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Estado evento: {bet.event.status || 'unknown'}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">Monto</div>
                        <div className="font-bold text-primary">{formatCurrency(bet.amount)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">Premio</div>
                        <div className="font-bold text-green-500">{formatCurrency(potentialWin)}</div>
                      </div>
                      
                      {bet.status === 'taken' && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => autoResolveBet(bet.id, bet.event_id)}
                            disabled={autoResolving === bet.id}
                          >
                            {autoResolving === bet.id ? 'Consultando...' : '🤖 Auto-resolver'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedBet(bet)}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Resolver
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const reason = window.prompt('Motivo de disputa (requerido):', 'Requiere verificacion manual')
                              if (!reason) return
                              handleAction(bet.id, 'dispute', undefined, reason)
                            }}
                          >
                            <AlertTriangle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}

                      {bet.status === 'disputed' && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedBet(bet)}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Resolver
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openCancelModal(bet)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                      
                      {(bet.status === 'open' || bet.status === 'taken') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            openCancelModal(bet)
                          }}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {bet.decision_history && bet.decision_history.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border/60">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-medium">Historial arbitral</div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleHistory(bet.id)}
                        >
                          {expandedHistoryBets.has(bet.id) ? 'Ocultar' : `Ver (${bet.decision_history.length})`}
                        </Button>
                      </div>

                      {expandedHistoryBets.has(bet.id) ? (
                        <div className="space-y-2">
                          {bet.decision_history.map((d) => (
                            <div key={d.id} className="rounded-md border border-border/60 p-2 text-xs">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-[10px]">{d.action}</Badge>
                                {d.source && <Badge variant="secondary" className="text-[10px]">{d.source}</Badge>}
                                <span className="text-muted-foreground">{formatDate(d.created_at)}</span>
                              </div>
                              {d.reason && <div className="text-muted-foreground">{d.reason}</div>}
                              <div className="text-muted-foreground mt-1">
                                {d.previous_status || '-'} → {d.new_status || '-'}
                                {d.decided_by ? ` · por ${d.decided_by}` : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          Última decisión: {bet.decision_history[0].action} · {formatDate(bet.decision_history[0].created_at)}
                          {bet.decision_history[0].reason ? ` · ${bet.decision_history[0].reason}` : ''}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Resolve Modal */}
      {selectedBet && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Resolver Apuesta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Selecciona el ganador de la apuesta:
              </p>
              <div className="flex flex-col gap-3">
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    const reason = window.prompt('Motivo de resolución (requerido):', 'Ganador validado manualmente')
                    if (!reason) return
                    handleAction(selectedBet.id, 'resolve', selectedBet.creator_id, reason)
                  }}
                  disabled={actionLoading}
                >
                  <Trophy className="h-4 w-4 mr-2 text-green-500" />
                  {selectedBet.event.home_team} - {selectedBet.creator_selection === selectedBet.event.home_team ? '(Selección del creador)' : ''}
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    const reason = window.prompt('Motivo de resolución (requerido):', 'Ganador validado manualmente')
                    if (!reason) return
                    handleAction(selectedBet.id, 'resolve', selectedBet.acceptor_id || 'draw', reason)
                  }}
                  disabled={actionLoading}
                >
                  <Trophy className="h-4 w-4 mr-2 text-blue-500" />
                  {selectedBet.event.away_team}
                </Button>
              </div>
              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setSelectedBet(null)}
                  disabled={actionLoading}
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {cancelTargetBet && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Cancelar Apuesta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Elige el motivo de cancelación para {cancelTargetBet.event.home_team} vs {cancelTargetBet.event.away_team}.
              </p>

              <div className="space-y-2">
                <label className="text-sm font-medium">Motivo</label>
                <select
                  value={cancelReasonOption}
                  onChange={(e) => setCancelReasonOption(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-background"
                >
                  {cancellationReasonOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>

              {cancelReasonOption === "other" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Motivo manual</label>
                  <Input
                    value={cancelReasonManual}
                    onChange={(e) => setCancelReasonManual(e.target.value)}
                    placeholder="Escribe el motivo de cancelación"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setCancelTargetBet(null)
                    setCancelReasonManual("")
                  }}
                  disabled={actionLoading}
                >
                  Volver
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={confirmCancelBet}
                  disabled={actionLoading || (cancelReasonOption === "other" && !cancelReasonManual.trim())}
                >
                  {actionLoading ? 'Cancelando...' : 'Confirmar cancelación'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
