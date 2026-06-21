"use client"

import { useState, useMemo } from "react"
import { useMyBets } from "@/app/my-bets/hooks"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"
import { ReferralBonusBanner } from "@/components/referral-bonus-banner"
import { formatHouseBetTypeLabel, formatHouseSelection } from "@/lib/bet-labels"

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  open: { label: "Abierta", variant: "secondary" },
  taken: { label: "Tomada", variant: "default" },
  pending_resolution: { label: "Esperando aprobación", variant: "outline" },
  pending_resolution_creator: { label: "Esperando aprobación", variant: "outline" },
  pending_resolution_acceptor: { label: "Esperando aprobación", variant: "outline" },
  resolved: { label: "Resuelta", variant: "default" },
  cancelled: { label: "Cancelada", variant: "destructive" },
  disputed: { label: "En disputa", variant: "destructive" },
}

const P2P_BET_TYPE_LABELS: Record<string, string> = {
  direct: "Directa P2P",
  half_time: "Medio Tiempo",
  exact_score: "Resultado Exacto",
  first_scorer: "Primer Anotador",
}

const STATUS_ORDER: Record<string, number> = {
  disputed: 0,
  pending_resolution_creator: 1,
  pending_resolution_acceptor: 2,
  pending_resolution: 3,
  taken: 4,
  open: 5,
  resolved: 6,
  cancelled: 7,
}

export default function MyBetsPage() {
  const createBetCtaClass = "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold shadow-md transition-all duration-200 hover:scale-105 active:scale-95"
  const createBetCtaStyle = { backgroundColor: "#16a34a", color: "#ffffff" }

  const { user, bets, loading, error } = useMyBets()
  const [activeTab, setActiveTab] = useState<"all" | "created" | "taken">("all")
  const [modeTab, setModeTab] = useState<"all" | "fantasy" | "real">("all")

  // Wagered vs Won stats — computed from resolved bets matching modeTab only
  const wagerStats = useMemo(() => {
    if (!user) return null
    const resolved = bets.filter(b => {
      if (b.status !== "resolved") return false
      if (modeTab !== "all" && ((b as any).mode ?? "fantasy") !== modeTab) return false
      const isParticipant = b.creator_id === user.id || b.acceptor_id === user.id
      return isParticipant
    })
    let wagered = 0
    let won = 0
    for (const bet of resolved) {
      const isCreator = bet.creator_id === user.id
      const isAsymmetric = bet.bet_type === "exact_score"
      const mult = Math.max(1, Number(bet.multiplier) || 1)
      const amt = Number(bet.amount) || 0
      const acceptorStake = isAsymmetric ? amt * mult : amt
      if (isCreator) {
        wagered += amt + Number(bet.fee_amount || 0)
      } else {
        wagered += acceptorStake + acceptorStake * 0.03
      }
      if (bet.winner_id === user.id) {
        won += amt + acceptorStake
      }
    }
    return { wagered: Math.round(wagered), won: Math.round(won), net: Math.round(won - wagered), resolved: resolved.length }
  }, [bets, user, modeTab])

  const filteredBets = bets
    .filter((bet) => {
      if (!user) return false
      if (modeTab !== "all") {
        const betMode = (bet as any).mode ?? "fantasy"
        if (betMode !== modeTab) return false
      }
      if (activeTab === "created") return bet.creator_id === user.id
      if (activeTab === "taken") return bet.acceptor_id === user.id
      return true
    })
    .sort((a, b) => {
      const orderA = STATUS_ORDER[a.status] ?? 99
      const orderB = STATUS_ORDER[b.status] ?? 99
      if (orderA !== orderB) return orderA - orderB
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-4 py-6 text-center">
          <p>Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="max-w-2xl mx-auto px-4 pt-4">
        <ReferralBonusBanner />
      </div>

      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Mis Predicciones</h1>
          <p className="text-muted-foreground">Gestiona tus predicciones creadas y tomadas</p>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setModeTab("all")}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${modeTab === "all" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Todas
          </button>
          <button
            type="button"
            onClick={() => setModeTab("fantasy")}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${modeTab === "fantasy" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            Fantasy
          </button>
          <button
            type="button"
            onClick={() => setModeTab("real")}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${modeTab === "real" ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground"}`}
          >
            Real iBYC
          </button>
        </div>

        {/* Wagered vs Won stats */}
        {wagerStats && wagerStats.resolved > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="border rounded-lg p-3 bg-card">
              <div className="text-xs text-muted-foreground mb-1">Apostado</div>
              <div className="font-bold text-sm">{formatCurrency(wagerStats.wagered)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{wagerStats.resolved} predicciones</div>
            </div>
            <div className="border rounded-lg p-3 bg-card">
              <div className="text-xs text-muted-foreground mb-1">Ganado</div>
              <div className="font-bold text-sm text-green-400">{formatCurrency(wagerStats.won)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">bruto retornado</div>
            </div>
            <div className={`border rounded-lg p-3 ${wagerStats.net >= 0 ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
              <div className="text-xs text-muted-foreground mb-1">Neto</div>
              <div className={`font-bold text-sm flex items-center gap-1 ${wagerStats.net >= 0 ? "text-green-400" : "text-red-400"}`}>
                {wagerStats.net > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : wagerStats.net < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                {wagerStats.net >= 0 ? "+" : ""}{formatCurrency(wagerStats.net)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">ganado − apostado</div>
            </div>
          </div>
        )}

        {/* Role tabs */}
        <div className="flex gap-2 mb-6">
          {(["all", "created", "taken"] as const).map((tab) => (
            <Button
              key={tab}
              variant={activeTab === tab ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab(tab)}
            >
              {tab === "all" ? "Todas" : tab === "created" ? "Creadas" : "Tomadas"}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12">Cargando...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-500">{error}</div>
        ) : filteredBets.length === 0 ? (
          <div className="text-center py-12">
            <Trophy className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-4">No hay predicciones</h3>
            <Link href="/create" className={createBetCtaClass} style={createBetCtaStyle}>
              Crear Predicción
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredBets.map((bet) => {
              const isCreator = bet.creator_id === user.id
              const statusCfg = statusConfig[bet.status] || { label: bet.status, variant: "outline" as const }
              const hasFinalScore = bet.event?.home_score != null && bet.event?.away_score != null
              const hasHalftime =
                bet.event?.metadata?.match_details?.halftime_home_score != null &&
                bet.event?.metadata?.match_details?.halftime_away_score != null
              const winnerNickname =
                bet.winner_id === bet.creator_id
                  ? bet.creator?.nickname
                  : bet.winner_id === bet.acceptor_id
                  ? bet.acceptor?.nickname
                  : null

              const eventDate = bet.event?.start_time
                ? new Date(bet.event.start_time).toLocaleDateString("es-ES", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  })
                : null

              return (
                <Card key={bet.id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    {/* Status + type | ID */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                        {(bet as any).house_bet ? (
                          <>
                            <Badge variant="outline" className="text-xs">
                              {formatHouseBetTypeLabel(bet.bet_type)}
                            </Badge>
                            <Badge className="bg-orange-500/15 text-orange-400 border border-orange-500/30 text-xs">
                              Vs Casa
                            </Badge>
                          </>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {P2P_BET_TYPE_LABELS[bet.bet_type] || bet.bet_type}
                          </Badge>
                        )}
                        {((bet as any).mode ?? "fantasy") === "real" ? (
                          <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs">Real iBYC</Badge>
                        ) : (
                          <Badge className="bg-blue-500/15 text-blue-400 border border-blue-500/30 text-xs">Fantasy</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        ID: {bet.id.slice(0, 8)}
                      </span>
                    </div>

                    {/* League + date */}
                    <div className="flex items-center justify-between mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {bet.event?.league || "Liga"}
                      </Badge>
                      {eventDate && (
                        <span className="text-xs text-muted-foreground">{eventDate}</span>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {/* Teams */}
                    <div className="flex items-center justify-between">
                      <div className="text-center flex-1">
                        {bet.event?.home_logo && (
                          <img
                            src={bet.event.home_logo}
                            alt=""
                            className="w-8 h-8 mx-auto mb-1 object-contain"
                          />
                        )}
                        <div className="font-bold text-sm">{bet.event?.home_team}</div>
                      </div>
                      <div className="px-3 text-muted-foreground text-sm">vs</div>
                      <div className="text-center flex-1">
                        {bet.event?.away_logo && (
                          <img
                            src={bet.event.away_logo}
                            alt=""
                            className="w-8 h-8 mx-auto mb-1 object-contain"
                          />
                        )}
                        <div className="font-bold text-sm">{bet.event?.away_team}</div>
                      </div>
                    </div>

                    {/* Selections */}
                    {(bet as any).house_bet ? (
                      <div className="p-3 rounded-md bg-orange-500/5 border border-orange-500/20 space-y-1">
                        <div className="text-xs text-orange-400 font-semibold uppercase tracking-wide mb-2">
                          Predicción contra la Casa
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-medium">Tu selección:</span>
                          <span className="text-sm font-bold text-green-400">
                            {formatHouseSelection(bet.bet_type, bet.creator_selection, bet.event?.home_team, bet.event?.away_team)}
                          </span>
                        </div>
                        {(bet as any).house_odds && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">Cuota:</span>
                            <span className="text-sm font-bold text-orange-400">×{(bet as any).house_odds}</span>
                          </div>
                        )}
                        {(bet as any).potential_payout && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">Ganancia potencial:</span>
                            <span className="text-sm font-bold text-primary">
                              {formatCurrency((bet as any).potential_payout)}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-3 p-2 rounded-md bg-muted/40 border border-border/40">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-medium">Predicción creador:</span>
                          <span className="text-sm font-bold text-green-400">
                            {bet.creator_selection ? formatHouseSelection(bet.bet_type, bet.creator_selection, bet.event?.home_team, bet.event?.away_team) : "—"}
                          </span>
                        </div>
                        {bet.acceptor && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">Predicción aceptante:</span>
                            <span className="text-sm font-bold text-blue-400">
                              {bet.acceptor_selection ? formatHouseSelection(bet.bet_type, bet.acceptor_selection, bet.event?.home_team, bet.event?.away_team) : "Contra creador"}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Participants + amount */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="flex flex-wrap gap-4">
                        {(bet as any).house_bet ? (
                          <div>
                            <span className="text-xs text-muted-foreground">Jugador: </span>
                            <span className="font-medium">{bet.creator?.nickname}</span>
                            <span className="text-xs text-muted-foreground ml-2">vs </span>
                            <span className="font-medium text-orange-400">La Casa</span>
                          </div>
                        ) : (
                          <>
                            <div>
                              <span className="text-xs text-muted-foreground">Creador: </span>
                              <span className="font-medium">{bet.creator?.nickname}</span>
                            </div>
                            {bet.acceptor && (
                              <div>
                                <span className="text-xs text-muted-foreground">Aceptante: </span>
                                <span className="font-medium">{bet.acceptor.nickname}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-primary">
                          {formatCurrency(bet.amount)}
                          {!((bet as any).house_bet) && bet.multiplier > 1 && (
                            <span className="text-xs text-muted-foreground ml-1">x{bet.multiplier}</span>
                          )}
                        </span>
                        {!(bet as any).house_bet && (
                          <Badge variant="outline" className="text-xs">
                            {isCreator ? "Creador" : "Aceptante"}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Event status + scores */}
                    <div className="text-xs text-muted-foreground">
                      Estado evento: {bet.event?.status || "—"}
                    </div>

                    {bet.status === "resolved" && bet.winner_id && (
                      <div className={`rounded-md px-3 py-2 text-sm font-bold border ${
                        bet.winner_id === user.id
                          ? "bg-green-500/10 border-green-500/30 text-green-500"
                          : "bg-red-500/10 border-red-500/30 text-red-500"
                      }`}>
                        {bet.winner_id === user.id ? "🏆 ¡Ganaste!" : "😞 Perdiste"}
                        {winnerNickname && !(bet as any).house_bet && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            Ganador: {winnerNickname}
                          </span>
                        )}
                      </div>
                    )}

                    {hasFinalScore && (
                      <div className="text-xs font-medium">
                        Marcador final: {bet.event.home_team} {bet.event.home_score} - {bet.event.away_score} {bet.event.away_team}
                      </div>
                    )}

                    {hasHalftime && (
                      <div className="text-xs text-muted-foreground">
                        Medio tiempo: {bet.event.home_team} {bet.event.metadata!.match_details!.halftime_home_score} - {bet.event.metadata!.match_details!.halftime_away_score} {bet.event.away_team}
                      </div>
                    )}

                    {/* Auto-cancel notice */}
                    {bet.status === "cancelled" &&
                      bet.decision_history?.[0]?.action === "auto_cancel_open_expired" && (
                        <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2">
                          <p className="text-xs text-green-600 font-medium">
                            {bet.decision_history[0].reason ||
                              "Tu predicción se cerró automáticamente porque el evento ya inició."}
                          </p>
                        </div>
                      )}

                    {/* Footer link */}
                    <div className="pt-1 border-t border-border/40">
                      <Link
                        href={`/bet/${bet.id}`}
                        className="text-xs text-primary underline underline-offset-2 hover:text-primary/80"
                      >
                        Ver detalles
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
