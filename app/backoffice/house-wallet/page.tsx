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

const TABS = ["balance", "fondos", "configuracion"] as const
type Tab = typeof TABS[number]
const TAB_LABELS: Record<Tab, string> = {
  balance: "Balance",
  fondos: "Gestionar fondos",
  configuracion: "Configuración",
}

export default function HouseWalletPage() {
  const [tab, setTab] = useState<Tab>("balance")

  // Balance data
  const [data, setData] = useState<HouseWalletData | null>(null)
  const [loading, setLoading] = useState(true)

  // Fondos form
  const [amount, setAmount] = useState("")
  const [mode, setMode] = useState<"fantasy" | "real">("fantasy")
  const [operation, setOperation] = useState<"fund" | "withdraw">("fund")
  const [submitting, setSubmitting] = useState(false)

  // Settings
  const [ibcPrice, setIbcPrice] = useState("")
  const [maxBetP2P, setMaxBetP2P] = useState("")
  const [maxBetHouse, setMaxBetHouse] = useState("")
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [savingPrice, setSavingPrice] = useState(false)
  const [savingMaxP2P, setSavingMaxP2P] = useState(false)
  const [savingMaxHouse, setSavingMaxHouse] = useState(false)

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
        const maxP2PSetting = (json.settings || []).find((s: { key: string; value: string }) => s.key === "max_bet_amount")
        const maxHouseSetting = (json.settings || []).find((s: { key: string; value: string }) => s.key === "max_bet_amount_house")
        if (priceSetting) setIbcPrice(priceSetting.value)
        if (maxP2PSetting) setMaxBetP2P(maxP2PSetting.value)
        if (maxHouseSetting) setMaxBetHouse(maxHouseSetting.value)
      }
    } finally {
      setLoadingSettings(false)
    }
  }

  useEffect(() => { loadData(); loadSettings() }, [])

  const handleFondos = async () => {
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
      showToast(`Precio actualizado: 1 iBYC = $${price}`, "success")
    } finally {
      setSavingPrice(false)
    }
  }

  const saveMaxBetP2P = async () => {
    const max = Number(maxBetP2P)
    if (!max || max <= 0) { showToast("Monto máximo inválido", "error"); return }
    setSavingMaxP2P(true)
    try {
      const res = await authFetch("/api/admin/iby/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_bet_amount: max }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || "Error", "error"); return }
      showToast(`Máx. P2P actualizado: ${formatCurrency(max)}`, "success")
    } finally {
      setSavingMaxP2P(false)
    }
  }

  const saveMaxBetHouse = async () => {
    const max = Number(maxBetHouse)
    if (!max || max <= 0) { showToast("Monto máximo inválido", "error"); return }
    setSavingMaxHouse(true)
    try {
      const res = await authFetch("/api/admin/iby/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_bet_amount_house: max }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || "Error", "error"); return }
      showToast(`Máx. Casa actualizado: ${formatCurrency(max)}`, "success")
    } finally {
      setSavingMaxHouse(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Wallet de la Casa</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-0">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* ── Tab: Balance ── */}
      {tab === "balance" && (
        <div className="space-y-6">
          {data?.alerts && data.alerts.length > 0 && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 space-y-1">
              {data.alerts.map((a, i) => (
                <p key={i} className="text-sm text-red-500 font-medium">⚠️ {a}</p>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-muted-foreground text-sm">Cargando...</p>
          ) : data ? (
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wide">Fantasy</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{formatCurrency(data.balance_fantasy)}</p>
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Apuestas activas</span>
                      <span className="font-medium text-foreground">{data.active_fantasy}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Exposición</span>
                      <span className={`font-medium ${data.reserved_liability_fantasy > data.balance_fantasy * 0.8 ? "text-red-500" : "text-foreground"}`}>
                        {formatCurrency(data.reserved_liability_fantasy)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wide">Real (iBY)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{formatCurrency(data.balance_real)}</p>
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Apuestas activas</span>
                      <span className="font-medium text-foreground">{data.active_real}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Exposición</span>
                      <span className={`font-medium ${data.reserved_liability_real > data.balance_real * 0.8 ? "text-red-500" : "text-foreground"}`}>
                        {formatCurrency(data.reserved_liability_real)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {data?.top_exposure && data.top_exposure.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Exposición por outcome</CardTitle>
                <p className="text-xs text-muted-foreground">Apuestas casa activas agrupadas por resultado</p>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-left border-b border-border">
                      <th className="pb-2 font-medium">Partido</th>
                      <th className="pb-2 font-medium">Selección</th>
                      <th className="pb-2 font-medium">Modo</th>
                      <th className="pb-2 font-medium text-center">Bets</th>
                      <th className="pb-2 font-medium text-right">Riesgo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_exposure.map((row, i) => (
                      <tr key={i} className={`border-b border-border/40 ${row.liability > 300_000 ? "text-red-500 font-medium" : ""}`}>
                        <td className="py-2 truncate max-w-[160px] text-xs">{row.match}</td>
                        <td className="py-2 text-xs">{row.outcome}</td>
                        <td className="py-2 text-xs capitalize">{row.mode}</td>
                        <td className="py-2 text-center text-xs">{row.count}</td>
                        <td className="py-2 text-right text-xs">{formatCurrency(row.liability)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-3">
                  Rojo: exposición &gt; 300k · Límite: 500k (direct) / 200k (exact_score)
                </p>
              </CardContent>
            </Card>
          )}

          {data && !loading && data.top_exposure.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Sin apuestas activas contra la casa.</p>
          )}
        </div>
      )}

      {/* ── Tab: Gestionar fondos ── */}
      {tab === "fondos" && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Gestionar fondos</CardTitle>
            <p className="text-sm text-muted-foreground">Añadí o retirá fondos del wallet de la casa.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Modo</label>
              <div className="flex gap-2">
                <Button variant={mode === "fantasy" ? "default" : "outline"} size="sm" onClick={() => setMode("fantasy")}>Fantasy</Button>
                <Button variant={mode === "real" ? "default" : "outline"} size="sm" onClick={() => setMode("real")}>Real (iBY)</Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Operación</label>
              <div className="flex gap-2">
                <Button variant={operation === "fund" ? "default" : "outline"} size="sm" onClick={() => setOperation("fund")}>Añadir fondos</Button>
                <Button variant={operation === "withdraw" ? "destructive" : "outline"} size="sm" onClick={() => setOperation("withdraw")}>Retirar</Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Monto</label>
              <Input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                min={1}
              />
            </div>
            <Button onClick={handleFondos} disabled={submitting || !amount} className="w-full">
              {submitting ? "Procesando..." : operation === "fund" ? "Añadir fondos" : "Retirar fondos"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Tab: Configuración ── */}
      {tab === "configuracion" && (
        <div className="space-y-4 max-w-md">
          {loadingSettings ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Precio del token iBYC</CardTitle>
                  <p className="text-xs text-muted-foreground">Pesos por 1 iBYC Coin. Afecta recargas desde este momento.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={ibcPrice}
                      onChange={e => setIbcPrice(e.target.value)}
                      placeholder="1.00"
                      className="max-w-[160px]"
                    />
                    <Button onClick={savePrice} disabled={savingPrice} size="sm">
                      {savingPrice ? "Guardando..." : "Guardar"}
                    </Button>
                  </div>
                  {ibcPrice && Number(ibcPrice) > 0 && (
                    <p className="text-xs text-muted-foreground">$100 pesos = {(100 / Number(ibcPrice)).toFixed(2)} iBYC</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Apuesta máxima P2P</CardTitle>
                  <p className="text-xs text-muted-foreground">Límite por apuesta en el marketplace entre usuarios.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={maxBetP2P}
                      onChange={e => setMaxBetP2P(e.target.value)}
                      placeholder="50000"
                      className="max-w-[160px]"
                    />
                    <Button onClick={saveMaxBetP2P} disabled={savingMaxP2P} size="sm">
                      {savingMaxP2P ? "Guardando..." : "Guardar"}
                    </Button>
                  </div>
                  {maxBetP2P && Number(maxBetP2P) > 0 && (
                    <p className="text-xs text-muted-foreground">Máximo P2P: {formatCurrency(Number(maxBetP2P))} por apuesta</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Apuesta máxima vs Casa</CardTitle>
                  <p className="text-xs text-muted-foreground">Límite por apuesta en modalidad contra la casa.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={maxBetHouse}
                      onChange={e => setMaxBetHouse(e.target.value)}
                      placeholder="100000"
                      className="max-w-[160px]"
                    />
                    <Button onClick={saveMaxBetHouse} disabled={savingMaxHouse} size="sm">
                      {savingMaxHouse ? "Guardando..." : "Guardar"}
                    </Button>
                  </div>
                  {maxBetHouse && Number(maxBetHouse) > 0 && (
                    <p className="text-xs text-muted-foreground">Máximo Casa: {formatCurrency(Number(maxBetHouse))} por apuesta</p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  )
}
