"use client"

import { useState, useEffect, useCallback } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { formatCurrency } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  RefreshCw, Wallet, Lock, TrendingUp, TrendingDown, DollarSign,
  ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight, Search
} from "lucide-react"

const OPERATION_LABELS: Record<string, string> = {
  bet_created: "Apuesta creada",
  bet_taken: "Apuesta tomada",
  bet_won_creator: "Premio creador",
  bet_won_acceptor: "Premio aceptante",
  bet_cancelled_refund: "Reembolso cancelación",
  bet_refund_creator: "Reembolso creador",
  bet_refund_acceptor: "Reembolso aceptante",
  deposit: "Depósito",
  top_up: "Recarga",
  login_bonus: "Bono de inicio",
  withdrawal: "Retiro",
  adjustment: "Ajuste",
}

interface Summary {
  circulating_fantasy: number
  circulating_real: number
  locked_in_open_bets: number
  locked_in_active_bets: number
  total_in_system: number
  total_ingresos: number
  total_egresos: number
  net: number
  fees_earned_creator: number
  fees_earned_acceptor: number
  fees_earned_total: number
  prizes_paid: number
  refunds_paid: number
  deposits_total: number
}

interface Transaction {
  id: string
  user_id: string
  token_type: string
  amount: number
  operation: string
  reference_id: string | null
  created_at: string
  profile: { nickname: string; email: string } | null
}

interface AuditData {
  summary: Summary
  by_operation: Record<string, { count: number; total: number }>
  transactions: Transaction[]
  total_count: number
  page: { offset: number; limit: number }
}

const LIMIT = 50

export default function AuditPage() {
  const supabase = createBrowserSupabaseClient()
  const [data, setData] = useState<AuditData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    operation: "",
    user_id: "",
  })

  async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  const fetchAudit = useCallback(async (currentOffset: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(currentOffset) })
      // Convert date strings (YYYY-MM-DD) to ISO timestamps for the API
      if (filters.from) params.set("from", `${filters.from}T00:00:00.000Z`)
      if (filters.to) params.set("to", `${filters.to}T23:59:59.999Z`)
      if (filters.operation) params.set("operation", filters.operation)
      if (filters.user_id) params.set("user_id", filters.user_id.trim())

      const res = await authFetch(`/api/admin/audit?${params}`)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Error ${res.status}`)
      }
      const json = await res.json()
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    setOffset(0)
    fetchAudit(0)
  }, [fetchAudit])

  function handlePageChange(newOffset: number) {
    setOffset(newOffset)
    fetchAudit(newOffset)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setOffset(0)
    fetchAudit(0)
  }

  const totalPages = data ? Math.ceil(data.total_count / LIMIT) : 0
  const currentPage = Math.floor(offset / LIMIT) + 1
  const summary = data?.summary

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Auditoría & Caja</h1>
        <Button variant="outline" size="sm" onClick={() => fetchAudit(offset)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Arqueo de caja */}
      {summary && (
        <>
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Arqueo de caja — tokens circulantes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">En wallets (Fantasy)</div>
                  <div className="text-2xl font-bold text-blue-400">{formatCurrency(summary.circulating_fantasy)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">En wallets (Real)</div>
                  <div className="text-2xl font-bold text-cyan-400">{formatCurrency(summary.circulating_real)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    <Lock className="inline h-3 w-3 mr-1" />
                    Bloqueado en apuestas abiertas
                  </div>
                  <div className="text-2xl font-bold text-orange-400">{formatCurrency(summary.locked_in_open_bets)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    <Lock className="inline h-3 w-3 mr-1" />
                    Bloqueado en apuestas activas
                  </div>
                  <div className="text-2xl font-bold text-amber-400">{formatCurrency(summary.locked_in_active_bets)}</div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border/50">
                <div className="text-xs text-muted-foreground mb-1">Total en el sistema</div>
                <div className="text-3xl font-bold">{formatCurrency(summary.total_in_system)}</div>
                <div className="text-xs text-muted-foreground mt-1">wallets + bloqueado en apuestas</div>
              </div>
            </CardContent>
          </Card>

          {/* Ingresos / Egresos / Fees */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpRight className="h-4 w-4 text-green-400" />
                  <span className="text-xs text-muted-foreground">Ingresos</span>
                </div>
                <div className="text-2xl font-bold text-green-400">{formatCurrency(summary.total_ingresos)}</div>
                <div className="text-xs text-muted-foreground mt-1">Depósitos: {formatCurrency(summary.deposits_total)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowDownRight className="h-4 w-4 text-red-400" />
                  <span className="text-xs text-muted-foreground">Egresos</span>
                </div>
                <div className="text-2xl font-bold text-red-400">{formatCurrency(summary.total_egresos)}</div>
                <div className="text-xs text-muted-foreground mt-1">Premios: {formatCurrency(summary.prizes_paid)} · Refs: {formatCurrency(summary.refunds_paid)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-purple-400" />
                  <span className="text-xs text-muted-foreground">Neto del período</span>
                </div>
                <div className={`text-2xl font-bold ${summary.net >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {summary.net >= 0 ? "+" : ""}{formatCurrency(summary.net)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-yellow-400" />
                  <span className="text-xs text-muted-foreground">Fees ganados (total)</span>
                </div>
                <div className="text-2xl font-bold text-yellow-400">{formatCurrency(summary.fees_earned_total)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Creador: {formatCurrency(summary.fees_earned_creator)} · Aceptante: {formatCurrency(summary.fees_earned_acceptor)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* By operation breakdown */}
          {data && Object.keys(data.by_operation).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" />
                  Movimientos por operación
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  {Object.entries(data.by_operation)
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([op, { count, total }]) => (
                      <div key={op} className="flex items-center justify-between text-sm py-1 border-b border-border/30">
                        <span className="text-muted-foreground">{OPERATION_LABELS[op] || op}</span>
                        <div className="flex items-center gap-3 text-right">
                          <span className="text-xs text-muted-foreground">{count}x</span>
                          <span className={`font-medium tabular-nums ${total >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {total >= 0 ? "+" : ""}{formatCurrency(total)}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros de búsqueda</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Desde</label>
              <Input
                type="date"
                value={filters.from}
                onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Hasta</label>
              <Input
                type="date"
                value={filters.to}
                onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Operación</label>
              <select
                value={filters.operation}
                onChange={e => setFilters(f => ({ ...f, operation: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todas</option>
                {Object.entries(OPERATION_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">User ID</label>
              <div className="flex gap-2">
                <Input
                  placeholder="UUID del usuario"
                  value={filters.user_id}
                  onChange={e => setFilters(f => ({ ...f, user_id: e.target.value }))}
                  className="h-9 text-sm"
                />
                <Button type="submit" size="sm" className="h-9 px-3" disabled={loading}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </form>
          {(filters.from || filters.to || filters.operation || filters.user_id) && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 text-xs h-7 text-muted-foreground hover:text-foreground"
              onClick={() => setFilters({ from: "", to: "", operation: "", user_id: "" })}
            >
              Limpiar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Transaction table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Historial de movimientos</span>
            {data && (
              <Badge variant="outline">{data.total_count} registros</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="text-center py-8 text-red-400 text-sm">{error}</div>
          )}
          {loading && !data && (
            <div className="text-center py-8 text-muted-foreground text-sm">Cargando...</div>
          )}
          {data && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-xs text-muted-foreground">
                    <th className="text-left px-4 py-2">Fecha</th>
                    <th className="text-left px-4 py-2">Usuario</th>
                    <th className="text-left px-4 py-2">Operación</th>
                    <th className="text-left px-4 py-2">Token</th>
                    <th className="text-right px-4 py-2">Monto</th>
                    <th className="text-left px-4 py-2">Referencia</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        Sin movimientos en el período seleccionado
                      </td>
                    </tr>
                  )}
                  {data.transactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(tx.created_at).toLocaleString("es-ES", {
                          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          timeZone: "UTC",
                        })}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{tx.profile?.nickname ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{tx.profile?.email ?? tx.user_id.slice(0, 8)}</div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className="text-xs font-normal">
                          {OPERATION_LABELS[tx.operation] || tx.operation}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground capitalize">{tx.token_type}</td>
                      <td className={`px-4 py-2 text-right font-mono font-semibold tabular-nums ${tx.amount >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {tx.amount >= 0 ? "+" : ""}{formatCurrency(tx.amount)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground font-mono">
                        {tx.reference_id ? tx.reference_id.slice(0, 8) + "…" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data && totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                Página {currentPage} de {totalPages} · {data.total_count} registros
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  disabled={offset === 0 || loading}
                  onClick={() => handlePageChange(Math.max(0, offset - LIMIT))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  disabled={offset + LIMIT >= data.total_count || loading}
                  onClick={() => handlePageChange(offset + LIMIT)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
