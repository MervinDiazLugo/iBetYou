"use client"

import { useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createBrowserSupabaseClient } from "@/lib/supabase"

async function authFetch(input: RequestInfo, init?: RequestInit) {
  const supabase = createBrowserSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init?.headers)
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}

function fmt(n: number) {
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function PnlBadge({ value }: { value: number }) {
  const positive = value >= 0
  return (
    <span className={`font-bold ${positive ? "text-green-400" : "text-red-400"}`}>
      {positive ? "+" : ""}{fmt(value)}
    </span>
  )
}

export default function SimulationPage() {
  const [tab, setTab] = useState<"estimate" | "empirical">("estimate")

  // ── Estimate state ──────────────────────────────────────────────────────────
  const [betsPerEvent, setBetsPerEvent] = useState(50)
  const [avgAmount, setAvgAmount] = useState(10)
  const [estimateData, setEstimateData] = useState<any>(null)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [estimateError, setEstimateError] = useState("")

  const runEstimate = useCallback(async () => {
    setEstimateLoading(true)
    setEstimateError("")
    try {
      const res = await authFetch(`/api/admin/simulation/estimate?bets_per_event=${betsPerEvent}&avg_amount=${avgAmount}`)
      const data = await res.json()
      if (!res.ok) { setEstimateError(data.error || "Error"); return }
      setEstimateData(data)
    } catch (e: any) {
      setEstimateError(e.message)
    } finally {
      setEstimateLoading(false)
    }
  }, [betsPerEvent, avgAmount])

  // ── Empirical state ─────────────────────────────────────────────────────────
  const [genBetsPerEvent, setGenBetsPerEvent] = useState(30)
  const [genMinAmount, setGenMinAmount] = useState(5)
  const [genMaxAmount, setGenMaxAmount] = useState(50)
  const [genLoading, setGenLoading] = useState(false)
  const [genResult, setGenResult] = useState<any>(null)
  const [reportData, setReportData] = useState<any>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [empiricalError, setEmpiricalError] = useState("")

  const generateSimulation = useCallback(async () => {
    setGenLoading(true)
    setEmpiricalError("")
    try {
      const res = await authFetch("/api/admin/simulation/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bets_per_event: genBetsPerEvent, min_amount: genMinAmount, max_amount: genMaxAmount }),
      })
      const data = await res.json()
      if (!res.ok) { setEmpiricalError(data.error || "Error"); return }
      setGenResult(data)
    } catch (e: any) {
      setEmpiricalError(e.message)
    } finally {
      setGenLoading(false)
    }
  }, [genBetsPerEvent, genMinAmount, genMaxAmount])

  const loadReport = useCallback(async () => {
    setReportLoading(true)
    setEmpiricalError("")
    try {
      const res = await authFetch("/api/admin/simulation/report")
      const data = await res.json()
      if (!res.ok) { setEmpiricalError(data.error || "Error"); return }
      setReportData(data)
    } catch (e: any) {
      setEmpiricalError(e.message)
    } finally {
      setReportLoading(false)
    }
  }, [])

  const deleteSimulation = useCallback(async () => {
    setDeleteLoading(true)
    try {
      await authFetch("/api/admin/simulation/report", { method: "DELETE" })
      setGenResult(null)
      setReportData(null)
    } finally {
      setDeleteLoading(false)
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Simulación de Casa</h1>
        <p className="text-muted-foreground">Estima y mide la rentabilidad de las apuestas contra la casa</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-1">
        <button
          onClick={() => setTab("estimate")}
          className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${tab === "estimate" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          📐 Estimación Matemática
        </button>
        <button
          onClick={() => setTab("empirical")}
          className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${tab === "empirical" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          🧪 Simulación Real
        </button>
      </div>

      {/* ── Tab A: Estimate ──────────────────────────────────────────────────── */}
      {tab === "estimate" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Parámetros</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Usuarios por evento: <span className="text-primary font-bold">{betsPerEvent}</span></label>
                  <input type="range" min={10} max={500} step={10} value={betsPerEvent}
                    onChange={e => setBetsPerEvent(Number(e.target.value))}
                    className="w-full" style={{ accentColor: "#6366f1" }} />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>10</span><span>500</span></div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Monto promedio: <span className="text-primary font-bold">{avgAmount} tokens</span></label>
                  <input type="range" min={1} max={200} step={1} value={avgAmount}
                    onChange={e => setAvgAmount(Number(e.target.value))}
                    className="w-full" style={{ accentColor: "#6366f1" }} />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>1</span><span>200</span></div>
                </div>
              </div>
              <Button onClick={runEstimate} disabled={estimateLoading}>
                {estimateLoading ? "Calculando..." : "📐 Calcular estimación"}
              </Button>
              {estimateError && <p className="text-sm text-red-400">{estimateError}</p>}
            </CardContent>
          </Card>

          {estimateData?.summary && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Volumen total", value: fmt(estimateData.summary.total_volume), sub: "tokens" },
                  { label: "P&L esperado", value: <PnlBadge value={estimateData.summary.expected_pnl} />, sub: `Margen ${estimateData.summary.expected_margin_pct}%` },
                  { label: "Peor escenario", value: <PnlBadge value={estimateData.summary.worst_case} />, sub: "todos ganan" },
                  { label: "Mejor escenario", value: <PnlBadge value={estimateData.summary.best_case} />, sub: "todos pierden" },
                ].map(({ label, value, sub }) => (
                  <Card key={label}>
                    <CardContent className="pt-4 pb-3 text-center">
                      <div className="text-xs text-muted-foreground mb-1">{label}</div>
                      <div className="text-lg font-bold">{value}</div>
                      <div className="text-[10px] text-muted-foreground">{sub}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Per-event table */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Por evento ({estimateData.summary.events_count})</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="pb-2 pr-4">Partido</th>
                        <th className="pb-2 pr-4">Pred.</th>
                        <th className="pb-2 pr-4">Cuotas</th>
                        <th className="pb-2 pr-4">Bets</th>
                        <th className="pb-2 pr-4">Volumen</th>
                        <th className="pb-2 pr-4">P&L Esp.</th>
                        <th className="pb-2 pr-4">Peor</th>
                        <th className="pb-2">Mejor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimateData.events.map((ev: any) => (
                        <tr key={ev.event_id} className="border-b border-border/40 hover:bg-muted/20">
                          <td className="py-2 pr-4">
                            <div className="font-medium truncate max-w-[180px]">{ev.match}</div>
                            <div className="text-[10px] text-muted-foreground">{ev.league}</div>
                          </td>
                          <td className="py-2 pr-4 whitespace-nowrap">
                            <span className="text-blue-300">{ev.predictions.home}</span>
                            {ev.predictions.draw && <span className="text-gray-400"> · {ev.predictions.draw}</span>}
                            <span className="text-orange-300"> · {ev.predictions.away}</span>
                          </td>
                          <td className="py-2 pr-4 whitespace-nowrap text-yellow-400">
                            {ev.odds.home}x · {ev.odds.away}x{ev.odds.draw ? ` · ${ev.odds.draw}x` : ""}
                          </td>
                          <td className="py-2 pr-4">{ev.bets.total}</td>
                          <td className="py-2 pr-4">{fmt(ev.volume)}</td>
                          <td className="py-2 pr-4"><PnlBadge value={ev.expected_pnl} /></td>
                          <td className="py-2 pr-4"><PnlBadge value={ev.worst_case} /></td>
                          <td className="py-2"><PnlBadge value={ev.best_case} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── Tab B: Empirical ─────────────────────────────────────────────────── */}
      {tab === "empirical" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Generar simulación</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Crea apuestas reales marcadas como simulación sobre los eventos featured actuales.
                No afectan wallets ni envían notificaciones. Mañana cuando <code>sync-scores</code> resuelva los eventos, aparecerá el resultado aquí.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Apuestas por evento: <span className="text-primary font-bold">{genBetsPerEvent}</span></label>
                  <input type="range" min={5} max={200} step={5} value={genBetsPerEvent}
                    onChange={e => setGenBetsPerEvent(Number(e.target.value))}
                    className="w-full" style={{ accentColor: "#6366f1" }} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Monto mínimo: <span className="text-primary font-bold">{genMinAmount}</span></label>
                  <input type="range" min={1} max={100} step={1} value={genMinAmount}
                    onChange={e => setGenMinAmount(Number(e.target.value))}
                    className="w-full" style={{ accentColor: "#6366f1" }} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Monto máximo: <span className="text-primary font-bold">{genMaxAmount}</span></label>
                  <input type="range" min={genMinAmount} max={500} step={5} value={genMaxAmount}
                    onChange={e => setGenMaxAmount(Number(e.target.value))}
                    className="w-full" style={{ accentColor: "#6366f1" }} />
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={generateSimulation} disabled={genLoading}>
                  {genLoading ? "Generando..." : "🧪 Generar simulación"}
                </Button>
                <Button variant="outline" onClick={loadReport} disabled={reportLoading}>
                  {reportLoading ? "Cargando..." : "📊 Ver resultados"}
                </Button>
                <Button variant="destructive" onClick={deleteSimulation} disabled={deleteLoading} size="sm">
                  {deleteLoading ? "..." : "🗑 Limpiar"}
                </Button>
              </div>
              {empiricalError && <p className="text-sm text-red-400">{empiricalError}</p>}
              {genResult && (
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 text-sm">
                  ✅ {genResult.created} apuestas generadas en {genResult.events} eventos
                  {genResult.errors?.length > 0 && <span className="text-amber-400 ml-2">· {genResult.errors.length} errores</span>}
                </div>
              )}
            </CardContent>
          </Card>

          {reportData && (
            <>
              {/* Status badges */}
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline">{reportData.status.total} apuestas totales</Badge>
                <Badge variant="outline" className="text-amber-400 border-amber-400/40">{reportData.status.pending} pendientes</Badge>
                <Badge variant="outline" className="text-green-400 border-green-400/40">{reportData.status.resolved} resueltas</Badge>
                {reportData.status.cancelled > 0 && <Badge variant="outline" className="text-red-400 border-red-400/40">{reportData.status.cancelled} canceladas</Badge>}
              </div>

              {reportData.summary ? (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Win rate casa", value: `${reportData.summary.win_rate_pct}%`, sub: `${reportData.summary.house_wins}W / ${reportData.summary.house_losses}L` },
                      { label: "P&L neto", value: <PnlBadge value={reportData.summary.net_pnl} />, sub: "tokens" },
                      { label: "Margen real", value: `${reportData.summary.actual_margin_pct}%`, sub: `vs 9.09% esperado` },
                      { label: "Volumen", value: fmt(reportData.summary.total_volume), sub: "tokens apostados" },
                    ].map(({ label, value, sub }) => (
                      <Card key={label}>
                        <CardContent className="pt-4 pb-3 text-center">
                          <div className="text-xs text-muted-foreground mb-1">{label}</div>
                          <div className="text-lg font-bold">{value}</div>
                          <div className="text-[10px] text-muted-foreground">{sub}</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Per-event results */}
                  {reportData.by_event?.length > 0 && (
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Resultados por evento</CardTitle></CardHeader>
                      <CardContent className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                              <th className="pb-2 pr-4">Partido</th>
                              <th className="pb-2 pr-4">Resultado</th>
                              <th className="pb-2 pr-4">Bets</th>
                              <th className="pb-2 pr-4">Casa ganó</th>
                              <th className="pb-2 pr-4">Win rate</th>
                              <th className="pb-2 pr-4">Ingreso</th>
                              <th className="pb-2 pr-4">Pago</th>
                              <th className="pb-2">P&L</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.by_event.map((ev: any) => (
                              <tr key={ev.event_id} className="border-b border-border/40 hover:bg-muted/20">
                                <td className="py-2 pr-4">
                                  <div className="font-medium truncate max-w-[160px]">{ev.match}</div>
                                  <div className="text-[10px] text-muted-foreground">{ev.sport}</div>
                                </td>
                                <td className="py-2 pr-4 font-mono">
                                  {ev.result ?? <span className="text-muted-foreground">pendiente</span>}
                                </td>
                                <td className="py-2 pr-4">{ev.bets}</td>
                                <td className="py-2 pr-4">{ev.house_won}</td>
                                <td className="py-2 pr-4">
                                  <span className={ev.win_rate >= 50 ? "text-green-400" : "text-red-400"}>{ev.win_rate}%</span>
                                </td>
                                <td className="py-2 pr-4 text-green-400">+{fmt(ev.revenue)}</td>
                                <td className="py-2 pr-4 text-red-400">-{fmt(ev.payout)}</td>
                                <td className="py-2"><PnlBadge value={ev.pnl} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No hay apuestas resueltas aún. Los resultados aparecen mañana cuando <code>sync-scores</code> procese los eventos.
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
