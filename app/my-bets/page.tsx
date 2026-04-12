"use client"

import { useState } from "react"
import { useMyBets } from "@/app/my-bets/hooks"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Trophy } from "lucide-react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils"

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

const betTypeLabels: Record<string, string> = {
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

  const filteredBets = bets
    .filter((bet) => {
      if (!user) return false
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

      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Mis Apuestas</h1>
          <p className="text-muted-foreground">Gestiona tus apuestas creadas y tomadas</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(["all", "created", "taken"] as const).map((tab) => (
            <Button
              key={tab}
              variant={activeTab === tab ? "default" : "outline"}
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
            <h3 className="text-lg font-semibold mb-4">No hay apuestas</h3>
            <Link href="/create" className={createBetCtaClass} style={createBetCtaStyle}>
              Crear Apuesta
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
                        <Badge variant="outline" className="text-xs">
                          {betTypeLabels[bet.bet_type] || bet.bet_type}
                        </Badge>
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
                    <div className="flex flex-wrap gap-3 p-2 rounded-md bg-muted/40 border border-border/40">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Apuesta creador:</span>
                        <span className="text-sm font-bold text-green-400">
                          {bet.creator_selection || "—"}
                        </span>
                      </div>
                      {bet.acceptor && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-medium">Apuesta aceptante:</span>
                          <span className="text-sm font-bold text-blue-400">
                            {bet.acceptor_selection || "Contra creador"}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Participants + amount */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="flex flex-wrap gap-4">
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
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-primary">
                          {formatCurrency(bet.amount)}
                          {bet.multiplier > 1 && (
                            <span className="text-xs text-muted-foreground ml-1">x{bet.multiplier}</span>
                          )}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {isCreator ? "Creador" : "Aceptante"}
                        </Badge>
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
                        {winnerNickname && (
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
                              "Tu apuesta se cerró automáticamente porque el evento ya inició."}
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
