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

  // Settings state
  const [ibcPrice, setIbcPrice] = useState("")
  const [maxBet, setMaxBet] = useState("")
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [savingPrice, setSavingPrice] = useState(false)
  const [savingMax, setSavingMax] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await authFetch("/api/admin/house-wallet")
      if (res.ok) {
        const json = await res.json()
        setData({
          balance_fantasy: json.balances?.balance_fantasy ?? 0,
          balance_real: json.balances?.balance_real ?? 0,
          active_fantasy: json.openBetsCountFantasy ?? 0,
          active_real: json.openBetsCountReal ?? 0,
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

  const loadSettings = async () => {
    setLoadingSettings(true)
    try {
      const res = await authFetch("/api/admin/iby/settings")
      if (res.ok) {
        const json = await res.json()
        const priceSetting = (json.settings || []).find((s: { key: string; value: string }) => s.key === "iby_coin_price")
        const maxSetting = (json.settings || []).find((s: { key: string; value: string }) => s.key === "max_bet_amount")
        if (priceSetting) setIbcPrice(priceSetting.value)
        if (maxSetting) setMaxBet(maxSetting.value)
      }
    } finally {
      setLoadingSettings(false)
    }
  }

  useEffect(() => { loadData(); loadSettings() }, [])

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

  const savePrice = async () => {
    const price = Number(ibcPrice)
    if (!price || price <= 0) { showToast("Precio inválido", "error"); return }
    setSavingPrice(true)
    try {
      const res = await authFetch("/api/admin/iby/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iby_coin_price: price }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || "Error", "error"); return }
      showToast(`Precio actualizado: 1 iBY = $${price}`, "success")
    } finally {
      setSavingPrice(false)
    }
  }

  const saveMaxBet = async () => {
    const max = Number(maxBet)
    if (!max || max <= 0) { showToast("Monto máximo inválido", "error"); return }
    setSavingMax(true)
    try {
      const res = await authFetch("/api/admin/iby/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_bet_amount: max }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || "Error", "error"); return }
      showToast(`Apuesta máxima actualizada: ${formatCurrency(max)}`, "success")
    } finally {
      setSavingMax(false)
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

      <Card>
        <CardHeader>
          <CardTitle>Configuración de plataforma</CardTitle>
          <p className="text-sm text-muted-foreground">Precio del token iBY y límites de apuesta.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {loadingSettings ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Precio del iBY Coin (pesos por 1 iBY)</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={ibcPrice}
                    onChange={e => setIbcPrice(e.target.value)}
                    placeholder="1.00"
                    className="max-w-[200px]"
                  />
                  <Button onClick={savePrice} disabled={savingPrice} size="sm">
                    {savingPrice ? "Guardando..." : "Guardar"}
                  </Button>
                </div>
                {ibcPrice && Number(ibcPrice) > 0 && (
                  <p className="text-xs text-muted-foreground">$100 pesos = {(100 / Number(ibcPrice)).toFixed(2)} iBY</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Apuesta máxima por usuario (tokens)</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={maxBet}
                    onChange={e => setMaxBet(e.target.value)}
                    placeholder="50000"
                    className="max-w-[200px]"
                  />
                  <Button onClick={saveMaxBet} disabled={savingMax} size="sm">
                    {savingMax ? "Guardando..." : "Guardar"}
                  </Button>
                </div>
                {maxBet && Number(maxBet) > 0 && (
                  <p className="text-xs text-muted-foreground">Máximo permitido: {formatCurrency(Number(maxBet))} por apuesta</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
