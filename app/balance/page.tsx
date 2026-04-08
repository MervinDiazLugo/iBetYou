"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { formatCurrency, formatDate } from "@/lib/utils"

type BalanceBetRow = {
  bet_id: string
  event_id: number
  event_title: string
  league: string
  sport: string
  selection: string
  result: "won" | "lost" | "pending"
  net_amount: number
  stake: number
  fee: number
  created_at: string
  resolved_at: string | null
}

type BalanceSummary = {
  total_bets: number
  resolved_bets: number
  won_bets: number
  lost_bets: number
  total_net: number
}

export default function BalancePage() {
  const router = useRouter()
  const supabase = createBrowserSupabaseClient()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<BalanceBetRow[]>([])
  const [summary, setSummary] = useState<BalanceSummary>({
    total_bets: 0,
    resolved_bets: 0,
    won_bets: 0,
    lost_bets: 0,
    total_net: 0,
  })

  useEffect(() => {
    async function loadBalance() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!session?.access_token) {
          router.push("/login")
          return
        }

        const res = await fetch("/api/user/balance", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })

        if (res.status === 401) {
          router.push("/login")
          return
        }

        const data = await res.json()
        setRows(data.bets || [])
        setSummary(data.summary || {
          total_bets: 0,
          resolved_bets: 0,
          won_bets: 0,
          lost_bets: 0,
          total_net: 0,
        })
      } catch (error) {
        console.error("Error loading balance:", error)
      } finally {
        setLoading(false)
      }
    }

    loadBalance()
  }, [router, supabase])

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">Balance de Jugadas</h1>
          <p className="text-muted-foreground">Resumen de en qué apostaste y cuánto ganaste o perdiste</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-muted-foreground">Total jugadas</div>
              <div className="text-xl font-bold">{summary.total_bets}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-muted-foreground">Resueltas</div>
              <div className="text-xl font-bold">{summary.resolved_bets}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-muted-foreground">Ganadas</div>
              <div className="text-xl font-bold text-green-500">{summary.won_bets}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-muted-foreground">Perdidas</div>
              <div className="text-xl font-bold text-red-500">{summary.lost_bets}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-xs text-muted-foreground">Balance total</div>
              <div className={`text-xl font-bold ${summary.total_net >= 0 ? "text-green-500" : "text-red-500"}`}>
                {summary.total_net >= 0 ? "+" : ""}{formatCurrency(summary.total_net)}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Detalle por apuesta</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Cargando...</p>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground">Aún no tienes jugadas registradas.</p>
            ) : (
              <div className="space-y-3">
                {rows.map((row) => (
                  <div key={row.bet_id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant="outline">Evento #{row.event_id}</Badge>
                      <Badge variant="secondary">{row.sport || "sport"}</Badge>
                      <Badge
                        className={
                          row.result === "won"
                            ? "bg-green-500/15 text-green-500 border-green-500/30"
                            : row.result === "lost"
                            ? "bg-red-500/15 text-red-500 border-red-500/30"
                            : "bg-yellow-500/15 text-yellow-500 border-yellow-500/30"
                        }
                        variant="outline"
                      >
                        {row.result === "won" ? "Ganada" : row.result === "lost" ? "Perdida" : "Pendiente"}
                      </Badge>
                    </div>

                    <div className="font-semibold">{row.event_title}</div>
                    <div className="text-sm text-muted-foreground">{row.league}</div>

                    <div className="mt-2 text-sm">
                      <span className="text-muted-foreground">Tu selección: </span>
                      <span className="font-medium">{row.selection}</span>
                    </div>

                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div>
                        <div className="text-muted-foreground">Stake</div>
                        <div className="font-medium">{formatCurrency(row.stake)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Fee</div>
                        <div className="font-medium">{formatCurrency(row.fee)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Resultado neto</div>
                        <div className={`font-semibold ${row.net_amount >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {row.net_amount >= 0 ? "+" : ""}{formatCurrency(row.net_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Fecha</div>
                        <div className="font-medium">{formatDate(row.resolved_at || row.created_at)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
