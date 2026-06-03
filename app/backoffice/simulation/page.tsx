"use client"

import { useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, ReferenceLine,
} from "recharts"

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

function fmtShort(n: number) {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toFixed(0)
}

function PnlBadge({ value }: { value: number }) {
  const positive = value >= 0
  return (
    <span className={`font-bold ${positive ? "text-green-400" : "text-red-400"}`}>
      {positive ? "+" : ""}{fmt(value)}
    </span>
  )
}

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-1">
      <div className="text-xs font-semibold text-blue-300 mb-2">ℹ️ {title}</div>
      <div className="text-sm text-muted-foreground space-y-1">{children}</div>
    </div>
  )
}

const CHART_COLORS = {
  expected: "#6366f1",
  worst: "#ef4444",
  best: "#22c55e",
  revenue: "#22c55e",
  payout: "#ef4444",
  pnl: "#6366f1",
  win: "#22c55e",
  loss: "#ef4444",
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-xl">
      <p className="font-semibold mb-1 truncate max-w-[200px]">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function SimulationPage() {
  const [tab, setTab] = useState<"estimate" | "empirical">("estimate")

  // ── Estimate state
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

  // ── Empirical state
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

  // ── Derived chart data
  const estimateChartData = estimateData?.events?.map((ev: any) => ({
    name: ev.match.split(" vs ")[0].slice(0, 12),
    fullName: ev.match,
    "P&L Esperado": ev.expected_pnl,
    "Peor caso": ev.worst_case,
    "Mejor caso": ev.best_case,
  })) ?? []

  const scenarioChartData = estimateData?.events?.map((ev: any) => ({
    name: ev.match.split(" vs ")[0].slice(0, 12),
    fullName: ev.match,
    "Local gana": ev.scenarios.home_wins,
    "Visita gana": ev.scenarios.away_wins,
    ...(ev.scenarios.draw !== null ? { "Empate": ev.scenarios.draw } : {}),
  })) ?? []

  const empiricalChartData = reportData?.by_event?.map((ev: any) => ({
    name: ev.match.split(" vs ")[0].slice(0, 12),
    fullName: ev.match,
    "Ingreso": ev.revenue,
    "Pago": -ev.payout,
    "P&L": ev.pnl,
  })) ?? []

  const pieData = reportData?.summary ? [
    { name: "Casa ganó", value: reportData.summary.house_wins },
    { name: "Casa perdió", value: reportData.summary.house_losses },
  ] : []

  const marginComparision = reportData?.summary ? [
    { name: "Margen real", value: reportData.summary.actual_margin_pct },
    { name: "Esperado", value: 9.09 },
  ] : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Simulación de Casa</h1>
        <p className="text-muted-foreground">Analiza la rentabilidad esperada y real de las apuestas contra la casa</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-1">
        {[
          { id: "estimate", label: "📐 Estimación Matemática" },
          { id: "empirical", label: "🧪 Simulación Real" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab A: Estimate ────────────────────────────────────────────────────── */}
      {tab === "estimate" && (
        <div className="space-y-5">
          <InfoBox title="¿Qué es la estimación matemática?">
            <p>Simula cuánto ganaría o perdería la casa si <strong className="text-foreground">{betsPerEvent} usuarios</strong> apostaran
              en cada evento, distribuyendo sus selecciones proporcionalmente a las predicciones.</p>
            <p className="mt-1">La casa tiene un <strong className="text-foreground">margen del 9.09%</strong> incorporado en las cuotas
              (cuota = 1 / probabilidad × 1.10). En teoría, por cada 100 tokens apostados la casa retiene ~9 tokens
              independientemente del resultado.</p>
            <p className="mt-1">Los escenarios muestran el rango de resultados reales según qué equipo gane en cada partido.</p>
          </InfoBox>

          <Card>
            <CardHeader><CardTitle className="text-base">Parámetros de simulación</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium flex justify-between">
                    <span>Usuarios por evento</span>
                    <span className="text-primary font-bold">{betsPerEvent}</span>
                  </label>
                  <input type="range" min={10} max={500} step={10} value={betsPerEvent}
                    onChange={e => setBetsPerEvent(Number(e.target.value))}
                    className="w-full" style={{ accentColor: "#6366f1" }} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>10 — alta varianza</span><span>500 — baja varianza</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Con más usuarios el resultado real converge al esperado (ley de grandes números)</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex justify-between">
                    <span>Monto promedio por apuesta</span>
                    <span className="text-primary font-bold">{avgAmount} tokens</span>
                  </label>
                  <input type="range" min={1} max={200} step={1} value={avgAmount}
                    onChange={e => setAvgAmount(Number(e.target.value))}
                    className="w-full" style={{ accentColor: "#6366f1" }} />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>1</span><span>200</span></div>
                  <p className="text-[11px] text-muted-foreground">Solo afecta el volumen absoluto; el margen % es independiente del monto</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={runEstimate} disabled={estimateLoading}>
                  {estimateLoading ? "Calculando..." : "📐 Calcular estimación"}
                </Button>
              </div>
              {estimateError && <p className="text-sm text-red-400">{estimateError}</p>}
            </CardContent>
          </Card>

          {estimateData?.summary && (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Volumen total", value: fmt(estimateData.summary.total_volume), sub: "tokens apostados", color: "" },
                  { label: "P&L esperado", value: <PnlBadge value={estimateData.summary.expected_pnl} />, sub: `Margen teórico: ${estimateData.summary.expected_margin_pct}%`, color: "" },
                  { label: "Peor escenario", value: <PnlBadge value={estimateData.summary.worst_case} />, sub: "Si todos aciertan", color: "" },
                  { label: "Mejor escenario", value: <PnlBadge value={estimateData.summary.best_case} />, sub: "Si todos fallan", color: "" },
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

              {/* P&L range chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Rango de P&L por evento</CardTitle>
                  <p className="text-xs text-muted-foreground">Compara el P&L esperado con el peor y mejor caso real por partido</p>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={estimateChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#888" }} />
                      <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={fmtShort} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={0} stroke="#ffffff30" />
                      <Bar dataKey="Peor caso" fill={CHART_COLORS.worst} radius={[2,2,0,0]} />
                      <Bar dataKey="P&L Esperado" fill={CHART_COLORS.expected} radius={[2,2,0,0]} />
                      <Bar dataKey="Mejor caso" fill={CHART_COLORS.best} radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Scenario chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">P&L por resultado de partido</CardTitle>
                  <p className="text-xs text-muted-foreground">Cuánto ganaría la casa según quién gane cada partido</p>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={scenarioChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#888" }} />
                      <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={fmtShort} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={0} stroke="#ffffff30" />
                      <Bar dataKey="Local gana" fill="#3b82f6" radius={[2,2,0,0]} />
                      <Bar dataKey="Visita gana" fill="#f97316" radius={[2,2,0,0]} />
                      <Bar dataKey="Empate" fill="#8b5cf6" radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-muted-foreground mt-2 text-center">
                    Si todos los valores son positivos, la casa gana sin importar el resultado — eso es el efecto del margen del 9.09%.
                  </p>
                </CardContent>
              </Card>

              {/* Detail table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Detalle por evento ({estimateData.summary.events_count})</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="pb-2 pr-3">Partido</th>
                        <th className="pb-2 pr-3">Predicción</th>
                        <th className="pb-2 pr-3">Cuotas</th>
                        <th className="pb-2 pr-3 text-right">Volumen</th>
                        <th className="pb-2 pr-3 text-right">P&L esp.</th>
                        <th className="pb-2 pr-3 text-right">Peor</th>
                        <th className="pb-2 text-right">Mejor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimateData.events.map((ev: any) => (
                        <tr key={ev.event_id} className="border-b border-border/30 hover:bg-muted/20">
                          <td className="py-2 pr-3">
                            <div className="font-medium truncate max-w-[160px]">{ev.match}</div>
                            <div className="text-[10px] text-muted-foreground">{ev.league}</div>
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <span className="text-blue-300">{ev.predictions.home}</span>
                            {ev.predictions.draw && <span className="text-gray-400"> · {ev.predictions.draw}</span>}
                            <span className="text-orange-300"> · {ev.predictions.away}</span>
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap text-yellow-400 text-[10px]">
                            {ev.odds.home}x / {ev.odds.away}x{ev.odds.draw ? ` / ${ev.odds.draw}x` : ""}
                          </td>
                          <td className="py-2 pr-3 text-right">{fmt(ev.volume)}</td>
                          <td className="py-2 pr-3 text-right"><PnlBadge value={ev.expected_pnl} /></td>
                          <td className="py-2 pr-3 text-right"><PnlBadge value={ev.worst_case} /></td>
                          <td className="py-2 text-right"><PnlBadge value={ev.best_case} /></td>
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

      {/* ── Tab B: Empirical ──────────────────────────────────────────────────── */}
      {tab === "empirical" && (
        <div className="space-y-5">
          <InfoBox title="¿Cómo funciona la simulación real?">
            <p>Genera apuestas reales en la base de datos marcadas como <code className="bg-muted px-1 rounded text-[10px]">is_simulation=true</code>.
              Distribúye las selecciones proporcionalmente a las predicciones de cada evento (si hay 60% de prob. para local,
              el 60% de las apuestas simuladas eligen local).</p>
            <p className="mt-1"><strong className="text-foreground">No afectan wallets reales ni envían notificaciones.</strong> Cuando
              <code className="bg-muted px-1 rounded text-[10px] mx-1">sync-scores</code> resuelva los eventos mañana,
              podrás ver aquí si el margen teórico del 9.09% se cumplió con resultados reales.</p>
          </InfoBox>

          <Card>
            <CardHeader><CardTitle className="text-base">Configurar y generar</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                {[
                  { label: "Apuestas por evento", value: genBetsPerEvent, min: 5, max: 200, step: 5, set: setGenBetsPerEvent, hint: "Más bets = menos varianza" },
                  { label: "Monto mínimo", value: genMinAmount, min: 1, max: 100, step: 1, set: setGenMinAmount, hint: "Monto mínimo por apuesta" },
                  { label: "Monto máximo", value: genMaxAmount, min: genMinAmount, max: 500, step: 5, set: setGenMaxAmount, hint: "Monto máximo por apuesta" },
                ].map(({ label, value, min, max, step, set, hint }) => (
                  <div key={label} className="space-y-1">
                    <label className="text-sm font-medium flex justify-between">
                      <span>{label}</span>
                      <span className="text-primary font-bold">{value}</span>
                    </label>
                    <input type="range" min={min} max={max} step={step} value={value}
                      onChange={e => set(Number(e.target.value))}
                      className="w-full" style={{ accentColor: "#6366f1" }} />
                    <p className="text-[10px] text-muted-foreground">{hint}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={generateSimulation} disabled={genLoading}>
                  {genLoading ? "Generando..." : "🧪 Generar simulación"}
                </Button>
                <Button variant="outline" onClick={loadReport} disabled={reportLoading}>
                  {reportLoading ? "Cargando..." : "📊 Ver resultados"}
                </Button>
                <Button variant="destructive" size="sm" onClick={deleteSimulation} disabled={deleteLoading}>
                  {deleteLoading ? "..." : "🗑 Limpiar"}
                </Button>
              </div>
              {empiricalError && <p className="text-sm text-red-400">{empiricalError}</p>}
              {genResult && (
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 text-sm">
                  ✅ <strong>{genResult.created}</strong> apuestas simuladas generadas en <strong>{genResult.events}</strong> eventos.
                  Los resultados aparecerán aquí mañana tras <code>sync-scores</code>.
                  {genResult.errors?.length > 0 && <span className="text-amber-400 ml-2">· {genResult.errors.length} errores</span>}
                </div>
              )}
            </CardContent>
          </Card>

          {reportData && (
            <>
              {/* Status */}
              <div className="flex gap-2 flex-wrap items-center">
                <span className="text-sm font-medium">Estado:</span>
                <Badge variant="outline">{reportData.status.total} totales</Badge>
                <Badge variant="outline" className="text-amber-400 border-amber-400/40">{reportData.status.pending} pendientes</Badge>
                <Badge variant="outline" className="text-green-400 border-green-400/40">{reportData.status.resolved} resueltas</Badge>
                {reportData.status.cancelled > 0 && <Badge variant="outline" className="text-red-400 border-red-400/40">{reportData.status.cancelled} canceladas</Badge>}
              </div>

              {reportData.summary ? (
                <>
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Win rate casa", value: `${reportData.summary.win_rate_pct}%`, sub: `${reportData.summary.house_wins}W · ${reportData.summary.house_losses}L` },
                      { label: "P&L neto", value: <PnlBadge value={reportData.summary.net_pnl} />, sub: "tokens" },
                      { label: "Margen real", value: `${reportData.summary.actual_margin_pct}%`, sub: "vs 9.09% esperado" },
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

                  {/* Charts row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Pie: wins vs losses */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">Distribución de resultados</CardTitle>
                        <p className="text-xs text-muted-foreground">Casa ganó vs perdió por apuesta individual</p>
                      </CardHeader>
                      <CardContent className="flex items-center justify-center">
                        <ResponsiveContainer width="100%" height={220}>
                          <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }: { name: string; percent?: number }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                              <Cell fill={CHART_COLORS.win} />
                              <Cell fill={CHART_COLORS.loss} />
                            </Pie>
                            <Tooltip formatter={(v: any) => [v, "apuestas"]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Bar: real vs expected margin */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">Margen real vs esperado</CardTitle>
                        <p className="text-xs text-muted-foreground">Comparación del margen obtenido con el teórico del 9.09%</p>
                      </CardHeader>
                      <CardContent className="flex items-center justify-center">
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={marginComparision} margin={{ top: 20, right: 20, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#888" }} />
                            <YAxis tick={{ fontSize: 10, fill: "#888" }} unit="%" domain={[0, Math.max(12, (reportData.summary.actual_margin_pct || 0) + 2)]} />
                            <Tooltip formatter={(v: any) => [`${v}%`, "Margen"]} />
                            <ReferenceLine y={9.09} stroke="#6366f1" strokeDasharray="4 2" label={{ value: "Teórico", fill: "#6366f1", fontSize: 10 }} />
                            <Bar dataKey="value" name="Margen %" radius={[4,4,0,0]}>
                              <Cell fill={CHART_COLORS.expected} />
                              <Cell fill={CHART_COLORS.pnl} />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Revenue/payout chart per event */}
                  {empiricalChartData.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">Ingreso, pago y P&L por evento</CardTitle>
                        <p className="text-xs text-muted-foreground">Verde = lo que la casa cobró de apostadores perdedores · Rojo = lo que pagó a ganadores</p>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={empiricalChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#888" }} />
                            <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={fmtShort} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <ReferenceLine y={0} stroke="#ffffff30" />
                            <Bar dataKey="Ingreso" fill={CHART_COLORS.revenue} radius={[2,2,0,0]} />
                            <Bar dataKey="Pago" fill={CHART_COLORS.loss} radius={[2,2,0,0]} />
                            <Bar dataKey="P&L" fill={CHART_COLORS.pnl} radius={[2,2,0,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* Detail table */}
                  {reportData.by_event?.length > 0 && (
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Resultados por evento</CardTitle></CardHeader>
                      <CardContent className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                              <th className="pb-2 pr-3">Partido</th>
                              <th className="pb-2 pr-3">Score</th>
                              <th className="pb-2 pr-3 text-right">Bets</th>
                              <th className="pb-2 pr-3 text-right">Casa ganó</th>
                              <th className="pb-2 pr-3 text-right">Win %</th>
                              <th className="pb-2 pr-3 text-right">Ingreso</th>
                              <th className="pb-2 pr-3 text-right">Pago</th>
                              <th className="pb-2 text-right">P&L</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.by_event.map((ev: any) => (
                              <tr key={ev.event_id} className="border-b border-border/30 hover:bg-muted/20">
                                <td className="py-2 pr-3">
                                  <div className="font-medium truncate max-w-[140px]">{ev.match}</div>
                                  <div className="text-[10px] text-muted-foreground">{ev.sport}</div>
                                </td>
                                <td className="py-2 pr-3 font-mono text-xs">{ev.result ?? <span className="text-muted-foreground italic">pendiente</span>}</td>
                                <td className="py-2 pr-3 text-right">{ev.bets}</td>
                                <td className="py-2 pr-3 text-right">{ev.house_won}</td>
                                <td className="py-2 pr-3 text-right">
                                  <span className={ev.win_rate >= 50 ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>{ev.win_rate}%</span>
                                </td>
                                <td className="py-2 pr-3 text-right text-green-400">+{fmt(ev.revenue)}</td>
                                <td className="py-2 pr-3 text-right text-red-400">-{fmt(ev.payout)}</td>
                                <td className="py-2 text-right"><PnlBadge value={ev.pnl} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  )}

                  {/* Interpretation */}
                  <InfoBox title="¿Cómo interpretar estos resultados?">
                    <p><strong className="text-foreground">Win rate:</strong> Con distribución proporcional a predicciones, esperas ganar ~{Math.round(reportData.summary.win_rate_pct)}% de las apuestas individuales. La casa no necesita ganar más del 50% — gana por el margen en cada cuota.</p>
                    <p><strong className="text-foreground">Margen real vs 9.09%:</strong> Si el margen real está cerca del 9.09% teórico, el modelo de cuotas funciona bien. Una desviación alta indica varianza por bajo volumen — necesitas más usuarios para convergencia.</p>
                    <p><strong className="text-foreground">P&L negativo:</strong> Puede ocurrir con pocos usuarios. El margen del 9% es una expectativa estadística que requiere volumen suficiente para manifestarse.</p>
                  </InfoBox>
                </>
              ) : (
                <Card>
                  <CardContent className="py-10 text-center space-y-2">
                    <p className="text-muted-foreground">No hay apuestas resueltas aún.</p>
                    <p className="text-xs text-muted-foreground">Los resultados aparecen cuando <code>sync-scores</code> procese los eventos (automático cada 2h o mañana a las 3AM).</p>
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
