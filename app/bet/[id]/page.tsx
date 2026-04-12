"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter, useParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { supportsPeerResolution as supportsPeerResolutionForType } from "@/lib/bet-resolution"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useToast } from "@/components/toast"
import { ArrowLeft, Trophy, Users, Clock, DollarSign, AlertCircle, CheckCircle } from "lucide-react"
import Link from "next/link"

interface BetDetail {
  id: string
  event_id: number
  creator_id: string
  acceptor_id?: string
  type: string
  bet_type: string
  selection: string
  amount: number
  multiplier: number
  fee_amount: number
  creator_selection: string
  acceptor_selection?: string
  status: string
  winner_id?: string | null
  creator_claimed?: boolean
  acceptor_claimed?: boolean
  created_at: string
  event: {
    id: number
    sport: string
    home_team: string
    away_team: string
    status?: string
    home_score?: number | null
    away_score?: number | null
    start_time: string
    league: string
    country?: string
    metadata?: {
      venue?: {
        name?: string | null
        city?: string | null
      }
    }
  }
  creator: {
    nickname: string
    avatar_url?: string
  }
  acceptor?: {
    nickname: string
    avatar_url?: string
  }
}

const betTypeLabels: Record<string, string> = {
  direct: "Directa",
  exact_score: "Resultado Exacto",
  first_scorer: "Primer Anotador",
  half_time: "Medio Tiempo",
}

export default function BetDetailPage() {
  const router = useRouter()
  const params = useParams()
  const supabase = useMemo(() => createBrowserSupabaseClient(), [])
  const { showToast } = useToast()
  
  const [bet, setBet] = useState<BetDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [takingBet, setTakingBet] = useState(false)
  const [resolvingAction, setResolvingAction] = useState<"claim_win" | "claim_lose" | "confirm" | "reject" | null>(null)
  const [user, setUser] = useState<{ id: string; email: string; nickname: string; role?: string } | null>(null)
  const [balance, setBalance] = useState({ fantasy: 0, real: 0 })
  const [error, setError] = useState("")
  const [nowMs, setNowMs] = useState(Date.now())
  const [adminActionLoading, setAdminActionLoading] = useState(false)
  const [adminAutoResolving, setAdminAutoResolving] = useState(false)
  const [promptDialog, setPromptDialog] = useState<{ title: string; defaultValue: string; onConfirm: (value: string) => void } | null>(null)
  const [promptValue, setPromptValue] = useState("")
  
  const betId = params.id as string

  useEffect(() => {
    async function checkAuth() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (authUser) {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token

        if (token) {
          const infoRes = await fetch('/api/user/info', {
            headers: {
              Authorization: `Bearer ${token}`,
            }
          })

          if (infoRes.ok) {
            const infoData = await infoRes.json()
            const nickname = infoData.user?.nickname || authUser.email?.split('@')[0] || 'Usuario'
            setUser({ id: authUser.id, email: authUser.email!, nickname, role: infoData.user?.role })
            if (infoData.balance) {
              setBalance({
                fantasy: infoData.balance.fantasy,
                real: infoData.balance.real,
              })
            }
          }
        }

        await loadBet()
      } else {
        await loadBet()
      }
    }

    checkAuth()
  }, [betId])

  useEffect(() => {
    if (!betId) return

    const refresh = () => {
      loadBet()
    }

    const interval = setInterval(refresh, 7000)
    const onFocus = () => refresh()
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh()
      }
    }

    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [betId, user?.id])

  useEffect(() => {
    if (!betId) return

    const betChannel = supabase
      .channel(`bet-${betId}-live`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bets", filter: `id=eq.${betId}` },
        () => {
          loadBet()
        }
      )
      .subscribe()

    const eventChannel = bet?.event_id
      ? supabase
          .channel(`event-${bet.event_id}-live`)
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${bet.event_id}` },
            () => {
              loadBet()
            }
          )
          .subscribe()
      : null

    return () => {
      supabase.removeChannel(betChannel)
      if (eventChannel) {
        supabase.removeChannel(eventChannel)
      }
    }
  }, [betId, bet?.event_id, supabase])

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  async function loadBet() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    const headers: HeadersInit = {}
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`
    }

    const res = await fetch(`/api/bets/${betId}`, {
      headers,
      cache: "no-store",
    })

    if (res.ok) {
      const data = await res.json()
      setBet(data.bet)
    }
    setLoading(false)
  }

  const handleTakeBet = async () => {
    if (!user || !bet) return
    
    setTakingBet(true)
    setError("")
    
    // Double check bet is still open
    if (bet.status !== "open") {
      setError("Esta apuesta ya no está disponible")
      setTakingBet(false)
      return
    }
    
    // Check balance - asymmetric bets require different calculation
    const isAsymmetric = bet.bet_type === 'exact_score'
    const acceptorStake = isAsymmetric ? bet.amount * bet.multiplier : bet.amount
    const totalNeeded = acceptorStake + (acceptorStake * 0.03)
    
    if (balance.fantasy < totalNeeded) {
      setError("Balance insuficiente")
      setTakingBet(false)
      return
    }
    
    // Check if user is not the creator
    if (user.id === bet.creator_id) {
      setError("No puedes aceptar tu propia apuesta")
      setTakingBet(false)
      return
    }
    
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }

      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`
      }

      // Call API to take the bet
      const res = await fetch(`/api/bets/${bet.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ user_id: user.id })
      })
      
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Error al tomar la apuesta')
      }
      
      showToast("¡Apuesta aceptada! Mucha suerte.", "success")
      router.push("/my-bets")
    } catch (err: any) {
      const message = err.message || "Error al aceptar la apuesta"
      setError(message)
      showToast(message, "error")
      setTakingBet(false)
    }
  }

  const handleParticipantResolution = async (action: "claim_win" | "claim_lose" | "confirm" | "reject") => {
    if (!user || !bet) return

    setError("")
    setResolvingAction(action)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const res = await fetch(`/api/bets/${bet.id}/resolve`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ user_id: user.id, action }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "No se pudo actualizar la resolución")
      }

      if (data?.bet) {
        setBet(data.bet)
      }

      if (action === "reject") {
        showToast("Resultado rechazado. Pasó a arbitraje manual.", "success")
      } else if (action === "confirm") {
        showToast("Resultado confirmado. Apuesta resuelta.", "success")
      } else {
        showToast("Resultado reportado. Esperando confirmación del rival.", "success")
      }

      await loadBet()
    } catch (err: any) {
      setError(err.message || "Error al actualizar la resolución")
    } finally {
      setResolvingAction(null)
    }
  }
  
  const getSportIcon = (sport: string) => {
    switch (sport) {
      case "football": return "⚽"
      case "basketball": return "🏀"
      case "baseball": return "⚾"
      default: return "🏆"
    }
  }
  
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-4 py-6">
          <Card className="animate-pulse">
            <CardHeader>
              <div className="h-6 bg-muted rounded w-1/3" />
            </CardHeader>
            <CardContent>
              <div className="h-32 bg-muted rounded" />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }
  
  if (!bet || !bet.event) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-4 py-6">
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">Apuesta no encontrada</h2>
              <p className="text-muted-foreground mb-4">Esta apuesta no existe o ya fue tomada.</p>
              <Button asChild>
                <Link href="/">Volver al inicio</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }
  
  const isAsymmetric = bet.bet_type === 'exact_score'
  const supportsPeerResolution = supportsPeerResolutionForType(bet.bet_type)
  const isParticipant = !!user && (user.id === bet.creator_id || user.id === bet.acceptor_id)
  const isPendingPeerResolution = bet.status === "pending_resolution" || bet.status === "pending_resolution_creator" || bet.status === "pending_resolution_acceptor"
  const claimUnlockAtMs = bet.event?.start_time ? new Date(bet.event.start_time).getTime() + (2 * 60 * 60 * 1000) : Infinity
  const canReportByTime = nowMs >= claimUnlockAtMs
  const countdownMs = Math.max(0, claimUnlockAtMs - nowMs)
  const countdownHours = Math.floor(countdownMs / (1000 * 60 * 60))
  const countdownMinutes = Math.floor((countdownMs % (1000 * 60 * 60)) / (1000 * 60))
  const countdownSeconds = Math.floor((countdownMs % (1000 * 60)) / 1000)
  const claimantId = bet.creator_claimed && !bet.acceptor_claimed
    ? bet.creator_id
    : bet.acceptor_claimed && !bet.creator_claimed
      ? bet.acceptor_id
      : null
  const hasPeerClaim = !!claimantId || !!bet.winner_id
  const isEffectivelyPendingPeerResolution = isPendingPeerResolution || (bet.status === "taken" && hasPeerClaim)
  const isClaimant = !!user && claimantId === user.id
  const canClaimNow = supportsPeerResolution && isParticipant && bet.status === "taken" && !hasPeerClaim && canReportByTime
  const canConfirmNow = supportsPeerResolution && isParticipant && isEffectivelyPendingPeerResolution && !isClaimant
  const waitingCounterparty = supportsPeerResolution && isParticipant && isEffectivelyPendingPeerResolution && isClaimant
  const winnerNickname = bet.winner_id === bet.creator_id
    ? (bet.creator?.nickname || "Creador")
    : bet.winner_id === bet.acceptor_id
      ? (bet.acceptor?.nickname || "Aceptante")
      : ""
  const potentialWin = bet.amount * bet.multiplier + bet.amount
  // Net gain = what you earn from the opponent's stake
  const creatorNetGain = bet.amount * bet.multiplier
  // What the acceptor must put up (symmetric: same amount; asymmetric: amount * multiplier)
  const acceptorStake = isAsymmetric ? bet.amount * bet.multiplier : bet.amount
  const acceptorFee = acceptorStake * 0.03
  const acceptorTotalNeeded = acceptorStake + acceptorFee
  // Acceptor gross gain comes from creator's base stake.
  const acceptorGrossGain = bet.amount
  // Acceptor net gain discounts the 3% fee paid on acceptance.
  const acceptorNetGain = bet.amount - acceptorFee
  const isBackofficeAdmin = user?.role === "backoffice_admin"
  const hasEventScore = bet.event?.home_score !== undefined && bet.event?.home_score !== null && bet.event?.away_score !== undefined && bet.event?.away_score !== null

  async function handleAdminAction(action: string, winnerId?: string, reason?: string) {
    if (!bet) return
    setAdminActionLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const res = await fetch('/api/admin/bets', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          bet_id: bet.id,
          action,
          winner_id: winnerId,
          reason,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo ejecutar la acción de arbitraje')
      }

      showToast('Acción de arbitraje aplicada', 'success')
      await loadBet()
    } catch (err: any) {
      showToast(err.message || 'Error en arbitraje', 'error')
    } finally {
      setAdminActionLoading(false)
    }
  }

  async function handleAdminAutoResolve() {
    if (!bet) return
    setAdminAutoResolving(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const res = await fetch('/api/admin/bets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          bet_id: bet.id,
          event_id: bet.event_id,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo auto-resolver')
      }

      const scoreInfo = (data.homeScore !== undefined && data.awayScore !== undefined)
        ? `Marcador: ${data.homeScore}-${data.awayScore}`
        : 'Marcador no disponible'
      showToast(`${scoreInfo}. Auto-resolución ejecutada.`, 'success')
      await loadBet()
    } catch (err: any) {
      showToast(err.message || 'Error al auto-resolver', 'error')
    } finally {
      setAdminAutoResolving(false)
    }
  }
  
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Button variant="ghost" className="mb-4" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Link>
        </Button>
        
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <Badge variant="secondary">
                {getSportIcon(bet.event.sport)} {bet.event.league}
              </Badge>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {formatDate(bet.event.start_time)}
              </div>
            </div>
            <CardTitle className="text-2xl mt-2">
              {bet.event.home_team} vs {bet.event.away_team}
            </CardTitle>
            <CardDescription>
              {new Date(bet.event.start_time).toLocaleDateString("es-ES", {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </CardDescription>
            {(hasEventScore || bet.event.status) && (
              <CardDescription>
                Marcador: {bet.event.home_team} {bet.event.home_score ?? "-"} - {bet.event.away_score ?? "-"} {bet.event.away_team}
                {bet.event.status ? ` · Estado: ${bet.event.status}` : ""}
              </CardDescription>
            )}
            <CardDescription>
              {bet.event.metadata?.venue?.name
                ? `📍 ${bet.event.metadata.venue.name}${bet.event.metadata.venue.city ? `, ${bet.event.metadata.venue.city}` : ""}`
                : "📍 Lugar del evento no disponible"}
            </CardDescription>
          </CardHeader>
        </Card>
        
        <Card className="mb-6 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              Detalles de la Apuesta
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-muted-foreground">Tipo de apuesta</span>
              <Badge>{betTypeLabels[bet.bet_type] || bet.bet_type}</Badge>
            </div>
            
            <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg p-4 border border-primary/20">
              {(() => {
                const exactScoreFavoredTeam = (() => {
                  if (bet.bet_type !== "exact_score") return null
                  const scoreMatch = bet.creator_selection.match(/^(\d+)\s*-\s*(\d+)$/)
                  if (!scoreMatch) return null

                  const homeGoals = Number(scoreMatch[1])
                  const awayGoals = Number(scoreMatch[2])

                  if (homeGoals > awayGoals) return bet.event.home_team
                  if (awayGoals > homeGoals) return bet.event.away_team
                  return "empate"
                })()

                let selectionText = bet.creator_selection
                if (bet.bet_type === "exact_score") {
                  selectionText = `El score será ${bet.creator_selection}${exactScoreFavoredTeam ? ` a favor de ${exactScoreFavoredTeam}` : ""}`
                } else if (bet.bet_type === "direct" || bet.bet_type === "half_time") {
                  selectionText = `Gana ${bet.creator_selection}`
                }

                const isTaker = !!user && user.id === bet.acceptor_id

                const takerWinCondition = bet.bet_type === "exact_score"
                  ? `Tu condición para ganar: que el marcador final NO sea ${bet.creator_selection}${exactScoreFavoredTeam ? ` a favor de ${exactScoreFavoredTeam}` : ""}.`
                  : `Tu condición para ganar: que NO gane ${bet.creator_selection}.`

                return (
                  <>
                    <div className="text-sm text-muted-foreground text-center mb-2">
                      {user && user.id === bet.creator_id
                        ? 'Tu selección:'
                        : `${bet.creator?.nickname || 'Este usuario'} apostó que:`}
                    </div>
                    <div className="text-2xl font-bold text-primary text-center">
                      {selectionText}
                    </div>
                    {isTaker && (
                      <div className="text-xs text-muted-foreground text-center mt-2">
                        {takerWinCondition}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
            
            {bet.status === "taken" && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 text-center">
                <CheckCircle className="h-8 w-8 mx-auto text-green-500 mb-2" />
                <div className="font-medium text-green-500">Apuesta en curso</div>
                <p className="text-sm text-muted-foreground">Esta apuesta ya fue aceptada</p>
              </div>
            )}


            {isBackofficeAdmin && (
              <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-4 space-y-3">
                <div className="font-medium text-orange-700 dark:text-orange-300">Controles de arbitraje (Admin)</div>
                <p className="text-sm text-muted-foreground">
                  Puedes arbitrar esta apuesta directamente desde la vista de detalle.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {bet.status === 'taken' && (
                    <Button
                      variant="outline"
                      onClick={handleAdminAutoResolve}
                      disabled={adminAutoResolving || adminActionLoading}
                    >
                      {adminAutoResolving ? 'Consultando...' : 'Auto-resolver'}
                    </Button>
                  )}

                  {(bet.status === 'open' || bet.status === 'taken' || bet.status === 'disputed') && (
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setPromptValue('Cancelada por administración')
                        setPromptDialog({ title: 'Motivo de cancelación', defaultValue: 'Cancelada por administración', onConfirm: (reason) => handleAdminAction('cancel', undefined, reason) })
                      }}
                      disabled={adminActionLoading || adminAutoResolving}
                    >
                      Cancelar apuesta
                    </Button>
                  )}

                  {bet.status === 'taken' && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPromptValue('Requiere verificación manual')
                        setPromptDialog({ title: 'Motivo de disputa', defaultValue: 'Requiere verificación manual', onConfirm: (reason) => handleAdminAction('dispute', undefined, reason) })
                      }}
                      disabled={adminActionLoading || adminAutoResolving}
                    >
                      Enviar a disputa
                    </Button>
                  )}

                  {(bet.status === 'pending_resolution' || bet.status === 'pending_resolution_creator' || bet.status === 'pending_resolution_acceptor') && (
                    <Button
                      onClick={async () => {
                        setAdminActionLoading(true)
                        try {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession()

                          const res = await fetch('/api/admin/bets', {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                            },
                            body: JSON.stringify({
                              action: 'approve_pending',
                              bet_ids: [bet.id],
                              reason: 'Aprobación manual desde detalle',
                            }),
                          })

                          const data = await res.json()
                          if (!res.ok) throw new Error(data.error || 'No se pudo aprobar')
                          showToast('Resolución pendiente aprobada', 'success')
                          await loadBet()
                        } catch (err: any) {
                          showToast(err.message || 'Error al aprobar', 'error')
                        } finally {
                          setAdminActionLoading(false)
                        }
                      }}
                      disabled={adminActionLoading || adminAutoResolving}
                    >
                      Aprobar resolución pendiente
                    </Button>
                  )}
                </div>

                {(bet.status === 'taken' || bet.status === 'disputed') && bet.acceptor_id && (
                  <div className="space-y-2 pt-2 border-t border-orange-500/20">
                    <div className="text-sm font-medium">Resolver manualmente</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setPromptValue('Ganador validado manualmente')
                          setPromptDialog({ title: `Resolver: gana ${bet.creator?.nickname || 'Creador'}`, defaultValue: 'Ganador validado manualmente', onConfirm: (reason) => handleAdminAction('resolve', bet.creator_id, reason) })
                        }}
                        disabled={adminActionLoading || adminAutoResolving}
                      >
                        Gana {bet.creator?.nickname || 'Creador'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setPromptValue('Ganador validado manualmente')
                          setPromptDialog({ title: `Resolver: gana ${bet.acceptor?.nickname || 'Aceptante'}`, defaultValue: 'Ganador validado manualmente', onConfirm: (reason) => handleAdminAction('resolve', bet.acceptor_id || undefined, reason) })
                        }}
                        disabled={adminActionLoading || adminAutoResolving}
                      >
                        Gana {bet.acceptor?.nickname || 'Aceptante'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {user && user.id !== bet.creator_id && bet.status === "open" && (
              <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
                <div className="text-sm font-medium">¿Qué ganás si aceptás?</div>
                <div className="text-sm">
                  {bet.bet_type === "exact_score" ? (
                    <>Si el resultado <span className="font-bold text-red-400">NO</span> es <span className="font-bold text-primary">{bet.creator_selection}</span>:</>  
                  ) : (
                    <>Si <span className="font-bold text-red-400">NO</span> gana <span className="font-bold text-primary">{bet.creator_selection}</span>:</>  
                  )}
                </div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-muted-foreground text-sm">Retorno total:</span>
                  <span className="font-bold text-green-500 text-lg">{formatCurrency(potentialWin)}</span>
                  <span className="text-xs text-muted-foreground">
                    (recuperás tu {formatCurrency(acceptorStake)} + {formatCurrency(acceptorGrossGain)} del creador)
                  </span>
                </div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-muted-foreground text-sm">Ganancia neta:</span>
                  <span className="font-bold text-green-500">{formatCurrency(acceptorNetGain)}</span>
                  <span className="text-xs text-muted-foreground">(descontando fee de {formatCurrency(acceptorFee)})</span>
                </div>
                {isAsymmetric && (
                  <div className="text-xs text-muted-foreground border-t border-border/40 pt-2 mt-1">
                    Apostás más porque la probabilidad de un resultado exacto es baja. El multiplicador x{bet.multiplier} refleja eso: el creador arriesga menos por una mayor ganancia potencial.
                  </div>
                )}
              </div>
            )}

            {bet.status === "open" && (!user || user.id !== bet.creator_id) && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="text-sm font-semibold">Comparativa rápida: Creador vs Tú</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-border bg-background/80 p-3 space-y-1">
                    <div className="font-medium text-muted-foreground">Creador</div>
                    <div>Stake: <span className="font-semibold">{formatCurrency(bet.amount)}</span></div>
                    <div>Fee: <span className="font-semibold">{formatCurrency(bet.fee_amount)}</span></div>
                    <div>Si acierta: <span className="font-semibold text-green-500">+{formatCurrency(creatorNetGain)}</span></div>
                    <div>Si falla: <span className="font-semibold text-amber-600">-{formatCurrency(bet.amount)}</span></div>
                  </div>
                  <div className="rounded-md border border-border bg-background/80 p-3 space-y-1">
                    <div className="font-medium text-muted-foreground">Tú al aceptar</div>
                    <div>Stake: <span className="font-semibold">{formatCurrency(acceptorStake)}</span></div>
                    <div>Fee: <span className="font-semibold">{formatCurrency(acceptorFee)}</span></div>
                    <div>Si ganás: <span className="font-semibold text-green-500">+{formatCurrency(acceptorNetGain)}</span></div>
                    <div>Si perdés: <span className="font-semibold text-amber-600">-{formatCurrency(acceptorStake)}</span></div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Resultado exacto y multiplicadores altos implican mayor complejidad para ambos lados.
                </p>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-secondary rounded-lg p-4 text-center">
                <div className="text-sm text-muted-foreground">
                  {user?.id === bet.creator_id ? 'Tu apuesta' : 'Tu colateral'}
                </div>
                <div className="text-2xl font-bold text-primary">
                  {formatCurrency(user?.id === bet.creator_id ? bet.amount : acceptorStake)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {user?.id === bet.creator_id
                    ? `+ ${formatCurrency(bet.fee_amount)} fee`
                    : `+ ${formatCurrency(acceptorFee)} fee`}
                </div>
                {user?.id !== bet.creator_id && (
                  <div className="text-[11px] text-blue-400/80 mt-0.5">se devuelve si ganás</div>
                )}
              </div>
              <div className="bg-secondary rounded-lg p-4 text-center">
                <div className="text-sm text-muted-foreground">Ganás (neto)</div>
                <div className="text-2xl font-bold text-green-500">
                  {formatCurrency(user?.id === bet.creator_id ? creatorNetGain : acceptorNetGain)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {user?.id === bet.creator_id
                    ? `Retorno total: ${formatCurrency(potentialWin)}`
                    : `Retorno total: ${formatCurrency(potentialWin)}`}
                </div>
              </div>
            </div>
            
            {bet.bet_type === "exact_score" && bet.multiplier > 1 && (
              <div className="text-center">
                <Badge className="bg-green-500/20 text-green-500">
                  Multiplicador x{bet.multiplier}
                </Badge>
              </div>
            )}
            
            <div className="flex justify-between items-center pt-4 border-t">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Creador de la apuesta</span>
              </div>
              <span className="font-semibold">{bet.creator?.nickname}</span>
            </div>
          </CardContent>
        </Card>
        
        {user && !isBackofficeAdmin && user.id !== bet.creator_id && bet.status === "open" && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              {error && (
                <div className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm mb-4 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}
              
              <Button
                className="w-full"
                size="lg"
                onClick={handleTakeBet}
                disabled={takingBet || balance.fantasy < acceptorTotalNeeded}
              >
                {takingBet ? "Aceptando..." : `Aceptar Apuesta por ${formatCurrency(acceptorStake)}`}
              </Button>
              
              {balance.fantasy < acceptorTotalNeeded && (
                <p className="text-xs text-center text-destructive mt-2">
                  Balance insuficiente
                </p>
              )}
            </CardContent>
          </Card>
        )}
        
        {user && !isBackofficeAdmin && user.id === bet.acceptor_id && ["resolved", "cancelled", "disputed"].includes(bet.status) && (
          <Card className="mb-6">
            <CardContent className="py-6 text-center">
              {bet.status === "resolved" ? (
                <>
                  <Trophy className="h-12 w-12 mx-auto text-green-500 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Apuesta finalizada</h3>
                  <p className="text-muted-foreground">
                    {bet.winner_id === user.id ? "¡Ganaste esta apuesta!" : "Perdiste esta apuesta."}
                    {winnerNickname ? ` Ganador: ${winnerNickname}.` : ""}
                  </p>
                </>
              ) : bet.status === "cancelled" ? (
                <>
                  <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Apuesta cancelada</h3>
                  <p className="text-muted-foreground">Esta apuesta fue cancelada.</p>
                </>
              ) : (
                <>
                  <AlertCircle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">En revisión</h3>
                  <p className="text-muted-foreground">Esta apuesta está siendo revisada por el equipo de la plataforma.</p>
                </>
              )}
              <Button className="mt-4" asChild>
                <Link href="/my-bets">Ver mis apuestas</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {user && !isBackofficeAdmin && user.id !== bet.creator_id && (bet.status === "taken" || isPendingPeerResolution) && (
          <Card className="mb-6">
            <CardContent className="pt-6 space-y-3">
              <div className="font-medium">Resolución entre participantes</div>

              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3">
                <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                  Reporta el resultado real. Marcarte como ganador sin haber ganado puede generar amonestaciones y bloqueo temporal para apostar.
                </p>
                {bet.status === "taken" && !canReportByTime && (
                  <p className="text-sm mt-1 font-medium text-amber-800 dark:text-amber-200">
                    Se habilita en: {countdownHours}h {String(countdownMinutes).padStart(2, "0")}m {String(countdownSeconds).padStart(2, "0")}s
                  </p>
                )}
              </div>

              {canClaimNow && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Marca tu resultado. El otro participante debe aceptar o rechazar.
                  </p>
                  <div className={`grid grid-cols-2 gap-2 ${!canReportByTime ? "opacity-60" : ""}`}>
                    <Button
                      onClick={() => handleParticipantResolution("claim_win")}
                      disabled={!canReportByTime || !!resolvingAction}
                    >
                      {resolvingAction === "claim_win" ? "Enviando..." : "Marcar: Gané"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleParticipantResolution("claim_lose")}
                      disabled={!canReportByTime || !!resolvingAction}
                    >
                      {resolvingAction === "claim_lose" ? "Enviando..." : "Marcar: Perdí"}
                    </Button>
                  </div>
                </>
              )}

              {waitingCounterparty && (
                <p className="text-sm text-muted-foreground">
                  Ya reportaste resultado{winnerNickname ? ` (${winnerNickname} como ganador)` : ""}. Esperando validación del rival.
                </p>
              )}

              {canConfirmNow && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Tu rival reportó resultado{winnerNickname ? ` y marcó ganador a ${winnerNickname}` : ""}. Puedes aceptar o rechazar.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={() => handleParticipantResolution("confirm")}
                      disabled={!!resolvingAction}
                    >
                      {resolvingAction === "confirm" ? "Confirmando..." : "Aceptar resultado"}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => handleParticipantResolution("reject")}
                      disabled={!!resolvingAction}
                    >
                      {resolvingAction === "reject" ? "Enviando..." : "No aceptar (Arbitraje)"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
        
        {user && user.id === bet.creator_id && bet.status === "open" && (
          <Card>
            <CardContent className="py-6 text-center">
              <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Esta es tu apuesta</h3>
              <p className="text-muted-foreground">
                Espera a que alguien la acepte en el marketplace.
              </p>
              <Button className="mt-4" asChild>
                <Link href="/my-bets">Ver mis apuestas</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {user && user.id === bet.creator_id && bet.status !== "open" && (
          <Card>
            <CardContent className="py-6 text-center">
              {bet.status === "resolved" ? (
                <>
                  <Trophy className="h-12 w-12 mx-auto text-green-500 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Apuesta finalizada</h3>
                  <p className="text-muted-foreground">
                    {bet.winner_id === user.id ? "¡Ganaste esta apuesta!" : "Perdiste esta apuesta."}
                    {winnerNickname ? ` Ganador: ${winnerNickname}.` : ""}
                  </p>
                </>
              ) : bet.status === "cancelled" ? (
                <>
                  <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Apuesta cancelada</h3>
                  <p className="text-muted-foreground">Esta apuesta fue cancelada.</p>
                </>
              ) : bet.status === "disputed" ? (
                <>
                  <AlertCircle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">En revisión</h3>
                  <p className="text-muted-foreground">Esta apuesta está siendo revisada por el equipo de la plataforma.</p>
                </>
              ) : (
                <>
                  <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Esta es tu apuesta</h3>

                  {supportsPeerResolution && (
                    <div className="mt-5 space-y-3 text-left">
                      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
                        <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                          Reporta el resultado real. Marcarte como ganador sin haber ganado puede generar amonestaciones y bloqueo temporal para apostar.
                        </p>
                        {bet.status === "taken" && !canReportByTime && (
                          <p className="text-sm mt-1 font-medium text-amber-800 dark:text-amber-200">
                            Se habilita en: {countdownHours}h {String(countdownMinutes).padStart(2, "0")}m {String(countdownSeconds).padStart(2, "0")}s
                          </p>
                        )}
                      </div>

                      {canClaimNow && (
                        <div className={`grid grid-cols-2 gap-2 ${!canReportByTime ? "opacity-60" : ""}`}>
                          <Button
                            onClick={() => handleParticipantResolution("claim_win")}
                            disabled={!canReportByTime || !!resolvingAction}
                          >
                            {resolvingAction === "claim_win" ? "Enviando..." : "Marcar: Gané"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleParticipantResolution("claim_lose")}
                            disabled={!canReportByTime || !!resolvingAction}
                          >
                            {resolvingAction === "claim_lose" ? "Enviando..." : "Marcar: Perdí"}
                          </Button>
                        </div>
                      )}

                      {waitingCounterparty && (
                        <p className="text-sm text-muted-foreground">
                          Ya reportaste resultado{winnerNickname ? ` (${winnerNickname} como ganador)` : ""}. Esperando validación del rival.
                        </p>
                      )}

                      {canConfirmNow && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Button
                            onClick={() => handleParticipantResolution("confirm")}
                            disabled={!!resolvingAction}
                          >
                            {resolvingAction === "confirm" ? "Confirmando..." : "Aceptar resultado"}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => handleParticipantResolution("reject")}
                            disabled={!!resolvingAction}
                          >
                            {resolvingAction === "reject" ? "Enviando..." : "No aceptar (Arbitraje)"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {!supportsPeerResolution && bet.status === "taken" && (
                    <div className="mt-4 rounded-lg border border-muted bg-muted/40 p-3 text-left">
                      <p className="text-sm text-muted-foreground">
                        Para este tipo de apuesta, el resultado se confirmará automáticamente o será revisado por el equipo de la plataforma.
                      </p>
                    </div>
                  )}
                </>
              )}

              <Button className="mt-4" asChild>
                <Link href="/my-bets">Ver mis apuestas</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        
        {!user && (
          <Card>
            <CardContent className="py-6 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Inicia sesión para aceptar</h3>
              <p className="text-muted-foreground mb-4">
                Necesitas una cuenta para participar en apuestas.
              </p>
              <Button asChild>
                <Link href="/login">Iniciar Sesión</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      {/* Admin prompt dialog */}
      {promptDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h2 className="text-lg font-semibold">{promptDialog.title}</h2>
            <input
              className="w-full px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && promptValue.trim()) {
                  const cb = promptDialog.onConfirm
                  setPromptDialog(null)
                  cb(promptValue.trim())
                }
              }}
              autoFocus
            />
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setPromptDialog(null)}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                disabled={!promptValue.trim()}
                onClick={() => {
                  const cb = promptDialog.onConfirm
                  setPromptDialog(null)
                  cb(promptValue.trim())
                }}
              >
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}
      </main>
    </div>
  )
}