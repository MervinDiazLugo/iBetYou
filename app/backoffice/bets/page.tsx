"use client"

import { useState, useEffect, useRef } from "react"
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
import { useToast } from "@/components/toast"

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
  selection?: string | null
  acceptor_selection?: string | null
  status: string
  created_at: string
  updated_at?: string
  event: {
    home_team: string
    away_team: string
    start_time: string
    league: string
    sport: string
    status?: string
    home_score?: number | null
    away_score?: number | null
    metadata?: {
      match_details?: {
        halftime_home_score?: number | null
        halftime_away_score?: number | null
        first_scorer?: {
          team?: string | null
          player?: string | null
          minute?: number | null
        } | null
      }
    }
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
  pending_resolution: { label: "Pendiente Aprob.", color: "text-orange-500", bg: "bg-orange-500/10" },
  pending_resolution_creator: { label: "Pende Aprob (Creador)", color: "text-orange-500", bg: "bg-orange-500/10" },
  pending_resolution_acceptor: { label: "Pende Aprob (Aceptante)", color: "text-orange-500", bg: "bg-orange-500/10" },
  resolved: { label: "Resuelta", color: "text-purple-500", bg: "bg-purple-500/10" },
  cancelled: { label: "Cancelada", color: "text-red-500", bg: "bg-red-500/10" },
  disputed: { label: "En disputa", color: "text-yellow-500", bg: "bg-yellow-500/10" },
}

const betTypeLabels: Record<string, string> = {
  direct: "Directa",
  half_time: "Medio Tiempo",
  exact_score: "Resultado Exacto",
  first_scorer: "Primer Anotador",
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
  const { showToast } = useToast()
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
  const [syncingAllEvents, setSyncingAllEvents] = useState(false)
  const [resolveReason, setResolveReason] = useState<string>("Ganador validado manualmente")
  const [reasonModal, setReasonModal] = useState<{
    mode: 'approve' | 'dispute'
    title: string
    required: boolean
    betId?: string
    betIds?: string[]
    defaultReason: string
  } | null>(null)
  const [reasonModalText, setReasonModalText] = useState<string>("")
  const liveRefreshTimeoutRef = useRef<number | null>(null)

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

  async function fetchBets(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true)
    }
    try {
      const statusParam = statusFilter !== 'all' ? `&status=${statusFilter}` : ''
      const res = await authFetch(`/api/admin/bets?limit=100${statusParam}`)
      const data = await res.json()
      setBets(data.bets || [])
    } catch (err) {
      console.error('Error fetching bets:', err)
    } finally {
      if (!options?.silent) {
        setLoading(false)
      }
    }
  }

  async function fetchEventsWithBets(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoadingEventsWithBets(true)
    }
    try {
      const res = await authFetch('/api/admin/events/results')
      const data = await res.json()
      setEventsWithBets(data.events || [])
    } catch (err) {
      console.error('Error fetching events with bets:', err)
    } finally {
      if (!options?.silent) {
        setLoadingEventsWithBets(false)
      }
    }
  }

  async function runOpenBetsCleanup(options?: { silent?: boolean }) {
    try {
      const res = await authFetch('/api/cleanup/open-bets', {
        method: 'POST',
      })

      const data = await res.json()
      if (!res.ok) {
        if (!options?.silent) {
          showToast(data.error || 'No se pudo ejecutar limpieza de apuestas abiertas', 'error')
        }
        return null
      }

      if (!options?.silent && data.cancelled > 0) {
        showToast(`Se cerraron ${data.cancelled} apuesta(s) abierta(s) fuera de tiempo`, 'info')
      }

      return data
    } catch (err) {
      console.error('Error running open bets cleanup:', err)
      if (!options?.silent) {
        showToast('Error al ejecutar limpieza de apuestas abiertas', 'error')
      }
      return null
    }
  }

  async function refreshEventsFromBackoffice() {
    setSyncingAllEvents(true)
    setLoadingEventsWithBets(true)
    try {
      const eventsRes = await authFetch('/api/admin/events/results')
      const eventsData = await eventsRes.json()

      if (!eventsRes.ok) {
        showToast(eventsData.error || 'No se pudieron cargar eventos para sincronizar', 'error')
        return
      }

      const eventsToSync: EventWithBets[] = eventsData.events || []
      setEventsWithBets(eventsToSync)

      let syncedCount = 0
      let failedCount = 0
      let cancelledCount = 0

      for (const eventItem of eventsToSync) {
        const syncRes = await authFetch('/api/admin/events/results', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ event_id: eventItem.id })
        })

        const syncData = await syncRes.json()
        if (syncRes.ok) {
          syncedCount += 1
          cancelledCount += Number(syncData.cleanup?.cancelled || 0)
        } else {
          failedCount += 1
        }
      }

      const cleanup = await runOpenBetsCleanup({ silent: true })
      cancelledCount += Number(cleanup?.cancelled || 0)

      const autoResolveRes = await authFetch('/api/admin/bets/auto-resolve-finished', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dry_run: false })
      })

      const autoResolveData = await autoResolveRes.json()

      if (!autoResolveRes.ok) {
        showToast(autoResolveData.error || 'Error al auto-resolver apuestas exact_score', 'error')
      } else if (autoResolveData.resolved > 0) {
        showToast(`Auto-resueltas ${autoResolveData.resolved} apuesta(s) de resultado exacto`, 'success')
      }

      // Also auto-resolve disputed "direct" bets based on final score
      const disputedResolveRes = await authFetch('/api/admin/bets/auto-resolve-disputed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dry_run: false })
      })

      const disputedResolveData = await disputedResolveRes.json()

      if (!disputedResolveRes.ok) {
        showToast(disputedResolveData.error || 'Error al auto-resolver apuestas en disputa', 'error')
      } else if (disputedResolveData.resolved > 0) {
        showToast(`Auto-resueltas ${disputedResolveData.resolved} apuesta(s) en disputa`, 'success')
      } else if (disputedResolveData.skipped > 0) {
        showToast(`No se pudieron resolver ${disputedResolveData.skipped} apuesta(s) en disputa (selección no coincide)`, 'info')
      }

      await fetchEventsWithBets({ silent: true })
      await fetchBets({ silent: true })

      if (syncedCount > 0) {
        const failedSuffix = failedCount > 0 ? ` · Fallidos: ${failedCount}` : ''
        showToast(`Eventos sincronizados: ${syncedCount}${failedSuffix}`, failedCount > 0 ? 'info' : 'success')
      } else if (eventsToSync.length === 0) {
        showToast('No hay eventos con apuestas para sincronizar', 'info')
      } else {
        showToast('No se pudo sincronizar ningún evento', 'error')
      }

      if (cancelledCount > 0) {
        showToast(`Se cerraron ${cancelledCount} apuesta(s) abierta(s) fuera de tiempo`, 'info')
      }
    } catch (err) {
      console.error('Error refreshing events from backoffice:', err)
      showToast('Error al actualizar eventos', 'error')
    } finally {
      setSyncingAllEvents(false)
      setLoadingEventsWithBets(false)
    }
  }

  function scheduleLiveRefresh(delayMs = 250) {
    if (liveRefreshTimeoutRef.current !== null) {
      window.clearTimeout(liveRefreshTimeoutRef.current)
    }

    liveRefreshTimeoutRef.current = window.setTimeout(() => {
      fetchBets({ silent: true })
      fetchEventsWithBets({ silent: true })
    }, delayMs)
  }

  useEffect(() => {
    fetchBets()
  }, [statusFilter])

  useEffect(() => {
    fetchEventsWithBets()
  }, [])

  useEffect(() => {
    if (selectedBet) {
      setResolveReason("Ganador validado manualmente")
    }
  }, [selectedBet?.id])

  useEffect(() => {
    const channel = supabase
      .channel('backoffice-bets-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, () => {
        scheduleLiveRefresh()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => {
        scheduleLiveRefresh()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arbitration_decisions' }, () => {
        scheduleLiveRefresh()
      })
      .subscribe()

    const handleFocus = () => {
      fetchBets({ silent: true })
      fetchEventsWithBets({ silent: true })
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchBets({ silent: true })
        fetchEventsWithBets({ silent: true })
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)

      if (liveRefreshTimeoutRef.current !== null) {
        window.clearTimeout(liveRefreshTimeoutRef.current)
        liveRefreshTimeoutRef.current = null
      }

      supabase.removeChannel(channel)
    }
  }, [statusFilter])

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
      showToast("Debes escribir un motivo manual", "error")
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
        showToast("Apuesta cancelada", "success")
      } else {
        const data = await res.json()
        showToast(data.error || 'Error al realizar la acción', 'error')
      }
    } catch (err) {
      console.error('Error:', err)
    } finally {
      setActionLoading(false)
    }
  }

  async function autoResolveBet(betId: string, eventId: number, forceResolve: boolean = false) {
    setAutoResolving(betId)
    try {
      const res = await authFetch('/api/admin/bets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bet_id: betId, event_id: eventId, force_resolve: forceResolve })
      })

      const data = await res.json()
      const scoreInfo = (data.homeScore !== undefined && data.awayScore !== undefined)
        ? `Marcador: ${data.homeScore} - ${data.awayScore}`
        : 'Marcador no disponible'
      const sourceInfo = data.score_source === 'external_api'
        ? '(API externa)'
        : '(BD)'
      
      if (res.ok) {
        if (data.result === 'tie') {
          showToast(`✓ EMPATE RESUELTO: ${scoreInfo} ${sourceInfo} - Dinero devuelto`, 'success')
        } else if (data.success && !data.pending_approval) {
          showToast(`✓ APUESTA RESUELTA: ${scoreInfo} ${sourceInfo} - ${data.message}`, 'success')
        } else {
          showToast(`${scoreInfo} ${sourceInfo}. ${data.message || 'Auto-resolución ejecutada'}`, 'success')
        }
        fetchBets()
      } else {
        if (data.error && !data.pending_approval) {
          // Es un conflicto que requiere force_resolve
          showToast(`⚠ CONFLICTO: ${data.error} - ${scoreInfo} ${sourceInfo}. En disputa hasta que lo resuelvas.`, 'error')
        } else {
          showToast(data.error || 'Error al auto-resolver', 'error')
        }
      }
    } catch (err) {
      console.error('Error:', err)
      showToast('Error de conexión al resolver', 'error')
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
        showToast(data.error || 'Error al consultar marcador del evento', 'error')
        return
      }

      showToast(`Marcador guardado: ${data.event.home_score ?? '-'} - ${data.event.away_score ?? '-'} (${data.event.status})`, 'success')
      if (data.cleanup?.cancelled > 0) {
        showToast(`Se cerraron ${data.cleanup.cancelled} apuesta(s) abierta(s) fuera de tiempo`, 'info')
      }
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
      showToast('Selecciona al menos una apuesta', 'error')
      return
    }

    setReasonModal({
      mode: 'approve',
      title: 'Aprobar Apuestas Pendientes',
      required: false,
      betIds: Array.from(selectedPendingBets),
      defaultReason: 'Aprobacion manual de apuestas pendientes',
    })
    setReasonModalText('Aprobacion manual de apuestas pendientes')
  }

  async function approvePendingBets(betIds: string[], reason?: string) {
    if (betIds.length === 0) return

    setActionLoading(true)
    try {
      const res = await authFetch('/api/admin/bets', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'approve_pending',
          bet_ids: betIds,
          reason,
        })
      })

      const data = await res.json()

      if (res.ok) {
        const successCount = data.results?.filter((r: any) => r.success).length || 0
        showToast(`Se aprobaron ${successCount} apuestas`, 'success')
        setSelectedPendingBets(new Set())
        fetchBets()
      } else {
        showToast(data.error || 'Error al aprobar', 'error')
      }
    } catch (err) {
      console.error('Error:', err)
    } finally {
      setActionLoading(false)
    }
  }

  async function approveSinglePending(betId: string) {
    setReasonModal({
      mode: 'approve',
      title: 'Aprobar Apuesta Pendiente',
      required: false,
      betIds: [betId],
      defaultReason: 'Aprobacion manual de apuesta pendiente',
    })
    setReasonModalText('Aprobacion manual de apuesta pendiente')
  }

  function openDisputeReasonModal(betId: string, defaultReason: string) {
    setReasonModal({
      mode: 'dispute',
      title: 'Enviar Apuesta a Disputa',
      required: true,
      betId,
      defaultReason,
    })
    setReasonModalText(defaultReason)
  }

  async function submitReasonModal() {
    if (!reasonModal) return

    const reason = reasonModalText.trim()
    if (reasonModal.required && !reason) {
      showToast('Debes ingresar un motivo', 'error')
      return
    }

    if (reasonModal.mode === 'approve') {
      await approvePendingBets(reasonModal.betIds || [], reason || undefined)
      setReasonModal(null)
      setReasonModalText("")
      return
    }

    if (reasonModal.mode === 'dispute' && reasonModal.betId) {
      await handleAction(reasonModal.betId, 'dispute', undefined, reason)
      setReasonModal(null)
      setReasonModalText("")
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
    pending_resolution: 1,
    pending_resolution_creator: 2,
    pending_resolution_acceptor: 3,
    taken: 4,
    open: 5,
    resolved: 6,
    cancelled: 7,
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
        <Button onClick={() => fetchBets()} variant="outline">
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
              <option value="pending_resolution">Pendientes (General)</option>
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
            <Button
              variant="outline"
              size="sm"
              onClick={refreshEventsFromBackoffice}
              disabled={syncingAllEvents || loadingEventsWithBets}
            >
              {syncingAllEvents ? 'Sincronizando...' : loadingEventsWithBets ? 'Actualizando...' : 'Actualizar eventos'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex gap-2">
          {bets.some(b => b.status === 'disputed') && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="bg-orange-500/10 border-orange-500/30 text-orange-500 hover:bg-orange-500/20"
                onClick={async () => {
                  if (!confirm('¿Resolver automáticamente TODAS las apuestas en disputa basadas en el marcador final?')) return
                  try {
                    const res = await authFetch('/api/admin/bets/auto-resolve-disputed', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ dry_run: false })
                    })
                    const data = await res.json()
                    if (res.ok) {
                      showToast(`✓ Resueltas ${data.resolved} apuesta(s) en disputa. ${data.skipped > 0 ? `Saltadas: ${data.skipped}` : ''}`, 'success')
                      fetchBets()
                    } else {
                      showToast(data.error || 'Error al resolver', 'error')
                    }
                  } catch (err) {
                    showToast('Error de conexión', 'error')
                  }
                }}
              >
                🤖 Auto-resolver disputadas
              </Button>
            </div>
          )}
          {loadingEventsWithBets ? (
            <p className="text-sm text-muted-foreground">Cargando eventos con apuestas...</p>
          ) : eventsWithBets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay eventos con apuestas activas.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {eventsWithBets.map((eventItem) => (
                <div
                  key={eventItem.id}
                  className="rounded-md border border-border/70 p-2 bg-gradient-to-b from-secondary/40 to-background h-[152px] flex flex-col"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge variant="outline" className="text-xs px-2 py-0">
                        {eventItem.league || "Liga"}
                      </Badge>
                      <Badge className={`border text-xs px-2 py-0 ${eventStatusClasses(eventItem.status)}`}>
                        {eventItem.status}
                      </Badge>
                    </div>
                    <Button
                      className="h-7 px-2.5 text-xs shrink-0"
                      size="sm"
                      variant="outline"
                      onClick={() => syncEventResult(eventItem.id)}
                      disabled={syncingEventId === eventItem.id || syncingAllEvents}
                    >
                      {syncingEventId === eventItem.id ? 'Consultando...' : 'Sync'}
                    </Button>
                  </div>

                  <div className="grid grid-cols-3 items-center gap-1.5 flex-1">
                    <div className="flex flex-col items-center justify-center text-center min-w-0">
                      {eventItem.home_logo ? (
                        <img
                          src={eventItem.home_logo}
                          alt={eventItem.home_team}
                          className="h-6 w-6 object-contain mb-0.5"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-secondary border flex items-center justify-center text-[10px] font-semibold mb-0.5">
                          {teamInitials(eventItem.home_team)}
                        </div>
                      )}
                      <div className="text-xs font-medium leading-tight truncate w-full">{eventItem.home_team}</div>
                      <div className="text-sm font-bold leading-none mt-0.5">{eventItem.home_score ?? "-"}</div>
                    </div>

                    <div className="flex flex-col items-center justify-center text-center">
                      <div className="text-xs text-muted-foreground font-semibold">VS</div>
                      <div className="text-sm font-bold leading-none mt-0.5">
                        {eventItem.home_score ?? "-"}<span className="text-muted-foreground px-0.5">:</span>{eventItem.away_score ?? "-"}
                      </div>
                    </div>

                    <div className="flex flex-col items-center justify-center text-center min-w-0">
                      {eventItem.away_logo ? (
                        <img
                          src={eventItem.away_logo}
                          alt={eventItem.away_team}
                          className="h-6 w-6 object-contain mb-0.5"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-secondary border flex items-center justify-center text-[10px] font-semibold mb-0.5">
                          {teamInitials(eventItem.away_team)}
                        </div>
                      )}
                      <div className="text-xs font-medium leading-tight truncate w-full">{eventItem.away_team}</div>
                      <div className="text-sm font-bold leading-none mt-0.5">{eventItem.away_score ?? "-"}</div>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground truncate mt-1">
                    {formatDate(eventItem.start_time)} · Apuestas: {eventItem.total_bets}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Approval Section */}
      {bets.some(b => b.status === 'pending_resolution' || b.status === 'pending_resolution_creator' || b.status === 'pending_resolution_acceptor') && (
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
            const betTypeLabel = betTypeLabels[bet.bet_type] || bet.type || bet.bet_type
            const hasFinalScore = bet.event.home_score !== undefined && bet.event.home_score !== null && bet.event.away_score !== undefined && bet.event.away_score !== null
            const readyForModeration = bet.status === 'taken' && bet.event.status === 'finished' && hasFinalScore
            const isPendingApproval = bet.status === 'pending_resolution' || bet.status === 'pending_resolution_creator' || bet.status === 'pending_resolution_acceptor'
            const halftimeHome = bet.event.metadata?.match_details?.halftime_home_score
            const halftimeAway = bet.event.metadata?.match_details?.halftime_away_score
            const hasHalftime = halftimeHome !== undefined && halftimeHome !== null && halftimeAway !== undefined && halftimeAway !== null
            const firstScorer = bet.event.metadata?.match_details?.first_scorer
            const firstScorerText = firstScorer
              ? `${firstScorer.player || 'Jugador no identificado'}${firstScorer.team ? ` (${firstScorer.team})` : ''}${firstScorer.minute !== undefined && firstScorer.minute !== null ? ` · ${firstScorer.minute}'` : ''}`
              : null
            
            return (
              <Card
                key={bet.id}
                className={`hover:shadow-md transition-shadow ${readyForModeration ? 'border-orange-500/70 bg-orange-500/5 shadow-orange-500/10 shadow-md' : ''}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge className={status.bg}>
                        <span className={status.color}>{status.label}</span>
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Tipo: {betTypeLabel}
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
                          <div className="text-xs font-bold text-green-400 mt-1">
                            {(() => {
                              const sel = bet.creator_selection || (bet.selection ? JSON.parse(bet.selection || '{}').selection : null)
                              return sel || 'No especificada'
                            })()}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
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
                            <div className="text-xs font-bold text-blue-400 mt-1">
                              {(() => {
                                const sel = bet.acceptor_selection || (bet.selection ? JSON.parse(bet.selection || '{}').acceptor_selection : null)
                                return sel || 'Contra la selección del creador'
                              })()}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
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
                      {hasFinalScore && (
                        <div className="text-xs font-medium text-foreground/90 mt-1">
                          Marcador final: {bet.event.home_team} {bet.event.home_score} - {bet.event.away_score} {bet.event.away_team}
                        </div>
                      )}
                      {hasHalftime && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Medio tiempo: {bet.event.home_team} {halftimeHome} - {halftimeAway} {bet.event.away_team}
                        </div>
                      )}
                      {firstScorerText && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Primer anotador: {firstScorerText}
                        </div>
                      )}
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

                      {readyForModeration && (
                        <Badge className="bg-orange-500/15 text-orange-500 border border-orange-500/40 whitespace-nowrap">
                          Lista para moderación
                        </Badge>
                      )}
                      
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
                            onClick={() => openDisputeReasonModal(bet.id, 'Requiere verificacion manual')}
                          >
                            <AlertTriangle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}

                      {bet.status === 'disputed' && (
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
                            onClick={() => openCancelModal(bet)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}

                      {isPendingApproval && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => approveSinglePending(bet.id)}
                            disabled={actionLoading}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Aprobar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedBet(bet)}
                          >
                            <Trophy className="h-4 w-4 mr-1" />
                            Moderar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openDisputeReasonModal(bet.id, 'Pendiente sin confirmacion de contraparte')}
                          >
                            <AlertTriangle className="h-4 w-4" />
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
              <CardTitle>Resolver Apuesta Manualmente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {selectedBet.event.home_team} {selectedBet.event.home_score ?? '-'} - {selectedBet.event.away_score ?? '-'} {selectedBet.event.away_team}
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Motivo de resolución</label>
                <Input
                  value={resolveReason}
                  onChange={(e) => setResolveReason(e.target.value)}
                  placeholder="Ej: Ganador validado manualmente"
                />
              </div>
              <p className="text-sm text-muted-foreground font-medium">Selecciona el ganador:</p>
              <div className="flex flex-col gap-3">
                <Button
                  variant="outline"
                  className="justify-start h-auto py-3 px-4 flex-col items-start"
                  onClick={() => {
                    const reason = resolveReason.trim()
                    if (!reason) {
                      showToast('Debes ingresar un motivo de resolución', 'error')
                      return
                    }
                    handleAction(selectedBet.id, 'resolve', selectedBet.creator_id, reason)
                  }}
                  disabled={actionLoading}
                >
                  <div className="flex items-center gap-2 w-full">
                    <Trophy className="h-4 w-4 text-green-500" />
                    <div className="text-left">
                      <div className="font-medium">{selectedBet.creator?.nickname}</div>
                      <div className="text-xs text-muted-foreground">
                        Selección: {selectedBet.creator_selection || 'No especificada'}
                      </div>
                    </div>
                  </div>
                </Button>
                
                {selectedBet.acceptor && (
                  <Button
                    variant="outline"
                    className="justify-start h-auto py-3 px-4 flex-col items-start"
                    onClick={() => {
                      const reason = resolveReason.trim()
                      if (!reason) {
                        showToast('Debes ingresar un motivo de resolución', 'error')
                        return
                      }
                      if (!selectedBet.acceptor_id) {
                        showToast('Error: ID del aceptante no disponible', 'error')
                        return
                      }
                      handleAction(selectedBet.id, 'resolve', selectedBet.acceptor_id, reason)
                    }}
                    disabled={actionLoading}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Trophy className="h-4 w-4 text-blue-500" />
                      <div className="text-left">
                        <div className="font-medium">{selectedBet.acceptor?.nickname}</div>
                        <div className="text-xs text-muted-foreground">
                          Selección: {selectedBet.acceptor_selection || 'Contra la selección del creador'}
                        </div>
                      </div>
                    </div>
                  </Button>
                )}
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

      {reasonModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>{reasonModal.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Motivo {reasonModal.required ? '(requerido)' : '(opcional)'}</label>
                <Input
                  value={reasonModalText}
                  onChange={(e) => setReasonModalText(e.target.value)}
                  placeholder={reasonModal.defaultReason}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setReasonModal(null)
                    setReasonModalText("")
                  }}
                  disabled={actionLoading}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onClick={submitReasonModal}
                  disabled={actionLoading || (reasonModal.required && !reasonModalText.trim())}
                >
                  {actionLoading ? 'Procesando...' : 'Confirmar'}
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
