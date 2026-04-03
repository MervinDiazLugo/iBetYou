"use client"

import { useState } from "react"
import { useMyBets } from "@/app/my-bets/hooks"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Trophy, CalendarDays, MapPin, Target, Coins } from "lucide-react"
import Link from "next/link"
import { formatCurrency, formatDate } from "@/lib/utils"

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  open: { label: "Abierta", variant: "secondary" },
  taken: { label: "Tomada", variant: "default" },
  pending_resolution: { label: "Esperando", variant: "outline" },
  pending_resolution_creator: { label: "Esperando", variant: "outline" },
  pending_resolution_acceptor: { label: "Esperando", variant: "outline" },
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

export default function MyBetsPage() {
  const createBetCtaClass = "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold shadow-md transition-all duration-200 hover:scale-105 hover:shadow-[0_0_18px_rgba(34,197,94,0.45)] hover:shadow-lg active:scale-95"
  const createBetCtaStyle = { backgroundColor: "#16a34a", color: "#ffffff" }

  const { user, balance, bets, loading, error } = useMyBets()
  const [activeTab, setActiveTab] = useState<"all" | "created" | "taken">("all")

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

      if (orderA !== orderB) {
        return orderA - orderB
      }

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || { label: status, variant: "outline" as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const isInProgressStatus = (status: string) => {
    return status === "taken" || status === "pending_resolution" || status === "pending_resolution_creator" || status === "pending_resolution_acceptor"
  }

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
          <p className="text-muted-foreground">
            Gestiona tus apuestas creadas y tomadas
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === "all" ? "default" : "outline"}
            onClick={() => setActiveTab("all")}
          >
            Todas
          </Button>
          <Button
            variant={activeTab === "created" ? "default" : "outline"}
            onClick={() => setActiveTab("created")}
          >
            Creadas
          </Button>
          <Button
            variant={activeTab === "taken" ? "default" : "outline"}
            onClick={() => setActiveTab("taken")}
          >
            Tomadas
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12">Cargando...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-500">
            <p>Error: {error}</p>
            <p className="text-sm mt-2">Total bets loaded: {bets.length}</p>
          </div>
        ) : filteredBets.length === 0 ? (
          <div className="text-center py-12">
            <Trophy className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No hay apuestas</h3>
            <Link href="/create" className={createBetCtaClass} style={createBetCtaStyle}>
              Crear Apuesta
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredBets.map((bet) => (
              <Link key={bet.id} href={`/bet/${bet.id}`}>
                <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <Badge variant="secondary" className="shrink-0">
                        {bet.event?.league || "Liga"}
                      </Badge>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[11px]">
                          {betTypeLabels[bet.bet_type] || bet.bet_type}
                        </Badge>
                        {getStatusBadge(bet.status)}
                      </div>
                    </div>
                    <CardTitle className="text-lg leading-snug">
                      {bet.event?.home_team} vs {bet.event?.away_team}
                    </CardTitle>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        <span>{formatDate(bet.created_at)}</span>
                      </div>
                      {bet.event?.metadata?.venue?.name && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>
                            {bet.event.metadata.venue.name}
                            {bet.event.metadata.venue.city ? `, ${bet.event.metadata.venue.city}` : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div className="rounded-lg border border-border bg-secondary/30 p-3">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Target className="h-3.5 w-3.5" />
                          Tu selección
                        </p>
                        <p className="font-medium text-sm leading-snug">
                          {bet.creator_id === user.id
                            ? bet.creator_selection
                            : bet.acceptor_selection || `En contra de: ${bet.creator_selection}`}
                        </p>
                      </div>

                      <div className="rounded-lg border border-border bg-secondary/30 p-3">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Coins className="h-3.5 w-3.5" />
                          Monto en juego
                        </p>
                        <p className="font-semibold text-primary text-sm">
                          {formatCurrency(bet.amount)}
                          {bet.bet_type === "exact_score" && bet.multiplier > 1 && (
                            <span className="text-xs ml-1 text-muted-foreground">x{bet.multiplier}</span>
                          )}
                        </p>
                      </div>

                      <div className="rounded-lg border border-border bg-secondary/30 p-3 sm:col-span-2 lg:col-span-1">
                        <p className="text-xs text-muted-foreground mb-1">Rol</p>
                        <p className="font-medium text-sm">
                          {bet.creator_id === user.id ? "Creador" : "Aceptante"}
                        </p>
                      </div>
                    </div>

                    {isInProgressStatus(bet.status) && (
                      <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                        <p className="text-xs text-primary font-medium">
                          Apuesta en curso: esperando resultado y validación.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}