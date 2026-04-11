"use client"

import { useState, useEffect, useCallback } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RefreshCw, DollarSign, TrendingUp, Lock, Wallet, Trophy, BarChart2 } from "lucide-react"

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n)
}

const statusLabels: Record<string, string> = {
  open: "Open",
  taken: "Taken",
  pending_resolution: "Pending Resolution",
  pending_resolution_creator: "Pending (Creator)",
  pending_resolution_acceptor: "Pending (Acceptor)",
  disputed: "Disputed",
  resolved: "Resolved",
  cancelled: "Cancelled",
}

const betTypeLabels: Record<string, string> = {
  direct: "Direct",
  half_time: "Half Time",
  exact_score: "Exact Score",
  first_scorer: "First Scorer",
}

interface Metrics {
  bets: {
    total: number
    byStatus: Record<string, number>
    byType: Record<string, number>
    totalVolume: number
    resolvedVolume: number
    avgBetAmount: number
  }
  fees: {
    collected: number
    pending: number
    total: number
    avgPerResolvedBet: number
  }
  locked: {
    inOpenBets: number
    inActiveBets: number
    total: number
  }
  wallets: {
    totalBalanceFantasy: number
    totalBalanceReal: number
    totalWallets: number
    walletsWithBalance: number
  }
}

export default function FinancieroPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createBrowserSupabaseClient()

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch("/api/admin/metrics", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error("Failed to load metrics")
      const data = await res.json()
      setMetrics(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => { fetchMetrics() }, [fetchMetrics])

  if (loading) return <div className="text-center py-16 text-muted-foreground">Loading metrics...</div>
  if (error) return <div className="text-center py-16 text-red-500">{error}</div>
  if (!metrics) return null

  const totalInSystem = metrics.wallets.totalBalanceFantasy + metrics.locked.total

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Financials</h1>
        <Button variant="outline" size="sm" onClick={fetchMetrics}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Main KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">In wallets</span>
            </div>
            <div className="text-2xl font-bold text-blue-400">{formatCurrency(metrics.wallets.totalBalanceFantasy)}</div>
            <div className="text-xs text-muted-foreground mt-1">{metrics.wallets.walletsWithBalance} users with balance</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="h-4 w-4 text-orange-400" />
              <span className="text-xs text-muted-foreground">Locked in bets</span>
            </div>
            <div className="text-2xl font-bold text-orange-400">{formatCurrency(metrics.locked.total)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Open: {formatCurrency(metrics.locked.inOpenBets)} · Active: {formatCurrency(metrics.locked.inActiveBets)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Fees collected</span>
            </div>
            <div className="text-2xl font-bold text-green-400">{formatCurrency(metrics.fees.collected)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Pending: {formatCurrency(metrics.fees.pending)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">Total volume</span>
            </div>
            <div className="text-2xl font-bold text-purple-400">{formatCurrency(metrics.bets.totalVolume)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Avg per bet: {formatCurrency(metrics.bets.avgBetAmount)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System total */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-5">
          <div className="flex flex-wrap gap-8 items-center">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Total in system</div>
              <div className="text-3xl font-bold">{formatCurrency(totalInSystem)}</div>
              <div className="text-xs text-muted-foreground mt-1">(wallets + locked in bets)</div>
            </div>
            <div className="flex-1 flex flex-wrap gap-6">
              <div>
                <div className="text-xs text-muted-foreground">All-time fees</div>
                <div className="text-xl font-bold text-green-400">{formatCurrency(metrics.fees.total)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Avg fee per resolved bet</div>
                <div className="text-xl font-bold">{formatCurrency(metrics.fees.avgPerResolvedBet)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Resolved volume</div>
                <div className="text-xl font-bold">{formatCurrency(metrics.bets.resolvedVolume)}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Bets by status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              Bets by status
              <Badge variant="outline" className="ml-auto">{metrics.bets.total} total</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(metrics.bets.byStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{statusLabels[status] || status}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${(count / metrics.bets.total) * 100}%` }}
                        />
                      </div>
                      <span className="font-medium w-8 text-right">{count}</span>
                      <span className="text-muted-foreground text-xs w-10 text-right">
                        {((count / metrics.bets.total) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        {/* Bets by type */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart2 className="h-4 w-4" />
              Bets by type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(metrics.bets.byType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{betTypeLabels[type] || type}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-400 rounded-full"
                          style={{ width: `${(count / metrics.bets.total) * 100}%` }}
                        />
                      </div>
                      <span className="font-medium w-8 text-right">{count}</span>
                      <span className="text-muted-foreground text-xs w-10 text-right">
                        {((count / metrics.bets.total) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Wallet breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Wallet breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Total wallets</div>
              <div className="text-xl font-bold">{metrics.wallets.totalWallets}</div>
            </div>
            <div>
              <div className="text-muted-foreground">With balance</div>
              <div className="text-xl font-bold">{metrics.wallets.walletsWithBalance}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Fantasy balance</div>
              <div className="text-xl font-bold">{formatCurrency(metrics.wallets.totalBalanceFantasy)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Real balance</div>
              <div className="text-xl font-bold">{formatCurrency(metrics.wallets.totalBalanceReal)}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
