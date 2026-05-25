"use client"
import { useState, useEffect } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/toast"
import { formatCurrency } from "@/lib/utils"

interface HouseWalletData {
  balance_fantasy: number
  balance_real: number
  active_fantasy: number
  active_real: number
  reserved_liability_fantasy: number
  reserved_liability_real: number
  alerts: string[]
  top_exposure: Array<{
    event_id: number
    match: string
    outcome: string
    bet_type: string
    count: number
    liability: number
    mode: string
  }>
}

async function authFetch(input: RequestInfo, init?: RequestInit) {
  const supabase = createBrowserSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init?.headers)
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}

export default function HouseWalletPage() {
  const [data, setData] = useState<HouseWalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState("")
  const [mode, setMode] = useState<"fantasy" | "real">("fantasy")
  const [operation, setOperation] = useState<"fund" | "withdraw">("fund")
  const [submitting, setSubmitting] = useState(false)
  const { showToast } = useToast()

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await authFetch("/api/admin/house-wallet")
      if (res.ok) {
        const json = await res.json()
        setData({
          balance_fantasy: json.balances?.balance_fantasy ?? 0,
          balance_real: json.balances?.balance_real ?? 0,
          active_fantasy: json.openBetsCount ?? 0,
          active_real: 0,
          reserved_liability_fantasy: json.exposure?.fantasy ?? 0,
          reserved_liability_real: json.exposure?.real ?? 0,
          alerts: json.alerts || [],
          top_exposure: json.top_exposure || [],
        })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleSubmit = async () => {
    const parsed = Number(amount)
    if (!parsed || parsed <= 0) { showToast("Monto inválido", "error"); return }
    setSubmitting(true)
    try {
      const res = await authFetch("/api/admin/house-wallet", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, amount: parsed, action: operation }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || "Error", "error"); return }
      showToast(`${operation === "fund" ? "Fondos añadidos" : "Retiro realizado"} correctamente`, "success")
      setAmount("")
      loadData()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Wallet de la Casa</h1>

      {data?.alerts && data.alerts.length > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 space-y-1">
          {data.alerts.map((a, i) => (
            <p key={i} className="text-sm text-red-500 font-medium">⚠️ {a}</p>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">Cargando...</p>
      ) : data ? (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Fantasy</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatCurrency(data.balance_fantasy)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.active_fantasy} apuestas activas · Riesgo: {formatCurrency(data.reserved_liability_fantasy)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Real (iBY)</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatCurrency(data.balance_real)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.active_real} apuestas activas · Riesgo: {formatCurrency(data.reserved_liability_real)}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {data?.top_exposure && data.top_exposure.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Exposición por outcome (activa)</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="pb-2">Partido</th>
                  <th className="pb-2">Selección</th>
                  <th className="pb-2">Modo</th>
                  <th className="pb-2">Apuestas</th>
                  <th className="pb-2 text-right">Riesgo</th>
                </tr>
              </thead>
              <tbody>
                {data.top_exposure.map((row, i) => (
                  <tr key={i} className={row.liability > 300_000 ? "text-red-600 font-medium" : ""}>
                    <td className="py-1 truncate max-w-[180px]">{row.match}</td>
                    <td className="py-1">{row.outcome}</td>
                    <td className="py-1">{row.mode}</td>
                    <td className="py-1">{row.count}</td>
                    <td className="py-1 text-right">{formatCurrency(row.liability)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">
              Filas en rojo: exposición &gt; 300k tokens. Límite por outcome: 500k (direct) / 200k (exact_score).
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Gestionar fondos</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button variant={mode === "fantasy" ? "default" : "outline"} size="sm" onClick={() => setMode("fantasy")}>Fantasy</Button>
            <Button variant={mode === "real" ? "default" : "outline"} size="sm" onClick={() => setMode("real")}>Real (iBY)</Button>
          </div>
          <div className="flex gap-2">
            <Button variant={operation === "fund" ? "default" : "outline"} size="sm" onClick={() => setOperation("fund")}>Añadir fondos</Button>
            <Button variant={operation === "withdraw" ? "destructive" : "outline"} size="sm" onClick={() => setOperation("withdraw")}>Retirar</Button>
          </div>
          <div>
            <label className="text-sm font-medium">Monto</label>
            <Input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              min={1}
            />
          </div>
          <Button onClick={handleSubmit} disabled={submitting || !amount}>
            {submitting ? "Procesando..." : operation === "fund" ? "Añadir fondos" : "Retirar fondos"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
