"use client"

import { useState, useEffect, useCallback } from "react"
import { Navbar } from "@/components/navbar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Coins, Clock, CheckCircle, XCircle, AlertCircle,
  Copy, Check, ChevronDown, ChevronUp, ArrowUpCircle,
  Plus, Trash2, RefreshCw,
} from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useAuth } from "@/components/providers"
import { useToast } from "@/components/toast"
import { useCountryAccess } from "@/hooks/use-country-access"
import { formatDate } from "@/lib/utils"
import { SUPPORTED_CURRENCIES, getCurrency } from "@/lib/ibyc/config"

interface DepositAccount {
  id: string
  type: string
  label: string
  details: Record<string, string>
  country: string | null
}

interface HistoryItem {
  id: string
  type: "deposit" | "withdrawal"
  currency: string
  amount_local: number
  amount_ibyc: number
  rate_to_usd: number
  status: string
  proof_reference: string | null
  payment_method: string
  created_at: string
  rejection_reason?: string | null
  failed_reason?: string | null
  // withdrawal-specific
  fee_ibyc?: number
  amount_local_out?: number
}

interface WithdrawalMethod {
  id: string
  type: "binance" | "bank" | "cbu_cvu"
  label: string
  details: Record<string, string>
}

interface MethodConfig {
  name: string
  emoji: string
  accentColor: string
  borderColor: string
  bgColor: string
  detailKeys: { key: string; label: string }[]
  instructions: string[]
  note?: string
}

const METHOD_CONFIG: Record<string, MethodConfig> = {
  binance: {
    name: "Binance",
    emoji: "🟡",
    accentColor: "text-yellow-400",
    borderColor: "border-yellow-500/40",
    bgColor: "bg-yellow-500/8",
    detailKeys: [
      { key: "binance_id", label: "Binance ID" },
      { key: "pay_id", label: "Pay ID" },
      { key: "email", label: "Email" },
    ],
    instructions: [
      "Abrí tu app de Binance y andá a la sección Pay o P2P.",
      "Seleccioná 'Enviar' e ingresá el Binance ID / Pay ID que aparece arriba.",
      "Enviá el monto en USDT (red recomendada: TRC-20 o BEP-20).",
      "Copiá el ID de la transacción (TxID o referencia de pago).",
      "Completá el formulario de abajo con el monto y el TxID.",
    ],
    note: "Usá siempre la red TRC-20 o BEP-20 para fees mínimas.",
  },
  pago_movil: {
    name: "Pago Móvil",
    emoji: "📱",
    accentColor: "text-blue-400",
    borderColor: "border-blue-500/40",
    bgColor: "bg-blue-500/8",
    detailKeys: [
      { key: "phone", label: "Teléfono" },
      { key: "bank_name", label: "Banco" },
      { key: "cedula", label: "Cédula" },
      { key: "holder", label: "Titular" },
    ],
    instructions: [
      "Abrí la app de tu banco y buscá la opción Pago Móvil.",
      "Ingresá el banco destino, el teléfono y la cédula que aparecen arriba.",
      "Ingresá el monto y confirmá la transferencia.",
      "Guardá el número de referencia que genera el banco.",
      "Completá el formulario de abajo con el monto y la referencia.",
    ],
    note: "El número de referencia es el comprobante que genera tu banco al confirmar el Pago Móvil.",
  },
  zelle: {
    name: "Zelle",
    emoji: "💜",
    accentColor: "text-purple-400",
    borderColor: "border-purple-500/40",
    bgColor: "bg-purple-500/8",
    detailKeys: [
      { key: "email", label: "Email" },
      { key: "phone", label: "Teléfono" },
      { key: "holder", label: "Titular" },
    ],
    instructions: [
      "Abrí tu app bancaria o Zelle y buscá la opción 'Enviar dinero'.",
      "Buscá el email o teléfono que aparece arriba.",
      "Verificá que el nombre del titular coincida antes de confirmar.",
      "Ingresá el monto en USD y enviá el pago.",
      "Guardá el número de confirmación que Zelle genera.",
      "Completá el formulario de abajo con el monto y el número de confirmación.",
    ],
    note: "Zelle no tiene comisión. El monto que enviás es exactamente lo que acreditamos en iBYC.",
  },
  bank: {
    name: "Banco",
    emoji: "🏦",
    accentColor: "text-green-400",
    borderColor: "border-green-500/40",
    bgColor: "bg-green-500/8",
    detailKeys: [
      { key: "bank_name", label: "Banco" },
      { key: "account_type", label: "Tipo de cuenta" },
      { key: "account_number", label: "Número de cuenta" },
      { key: "holder", label: "Titular" },
    ],
    instructions: [
      "Realizá una transferencia bancaria a los datos que aparecen arriba.",
      "Usá la descripción o concepto: tu nickname en iBetYou.",
      "Guardá el comprobante o número de operación.",
      "Completá el formulario de abajo con el monto y el número de operación.",
    ],
  },
  cbu_cvu: {
    name: "CBU / CVU",
    emoji: "🏦",
    accentColor: "text-green-400",
    borderColor: "border-green-500/40",
    bgColor: "bg-green-500/8",
    detailKeys: [
      { key: "cbu_cvu", label: "CBU / CVU" },
      { key: "alias", label: "Alias" },
      { key: "holder", label: "Titular" },
    ],
    instructions: [
      "Desde tu app bancaria o billetera virtual, buscá 'Transferir'.",
      "Ingresá el alias o CBU/CVU que aparece arriba.",
      "Verificá el titular antes de confirmar.",
      "Ingresá el monto y confirmá.",
      "Guardá el número de comprobante.",
      "Completá el formulario de abajo con el monto y el comprobante.",
    ],
  },
  wallytech: {
    name: "WallyTech",
    emoji: "💳",
    accentColor: "text-cyan-400",
    borderColor: "border-cyan-500/40",
    bgColor: "bg-cyan-500/8",
    detailKeys: [
      { key: "phone", label: "Teléfono" },
      { key: "email", label: "Email" },
      { key: "holder", label: "Titular" },
      { key: "wallet_id", label: "ID de billetera" },
    ],
    instructions: [
      "Abrí tu app de WallyTech e ingresá a 'Enviar dinero'.",
      "Buscá al destinatario por teléfono, email o ID de billetera.",
      "Verificá que el nombre del titular coincida.",
      "Ingresá el monto y confirmá el envío.",
      "Copiá el número de referencia o comprobante que genera WallyTech.",
      "Completá el formulario de abajo con el monto y la referencia.",
    ],
    note: "WallyTech opera en Venezuela.",
  },
}

const STATUS_CONFIG: Record<string, { label: string; Icon: any; color: string; bg: string }> = {
  pending:        { label: "Pendiente",     Icon: Clock,        color: "text-yellow-500", bg: "bg-yellow-500/10" },
  proof_submitted:{ label: "En revisión",   Icon: Clock,        color: "text-blue-400",   bg: "bg-blue-500/10" },
  confirmed:      { label: "Aprobada",      Icon: CheckCircle,  color: "text-green-500",  bg: "bg-green-500/10" },
  failed:         { label: "Rechazada",     Icon: XCircle,      color: "text-red-500",    bg: "bg-red-500/10" },
  approved:       { label: "Aprobada",      Icon: CheckCircle,  color: "text-green-500",  bg: "bg-green-500/10" },
  rejected:       { label: "Rechazada",     Icon: XCircle,      color: "text-red-500",    bg: "bg-red-500/10" },
  completed:      { label: "Completado",    Icon: CheckCircle,  color: "text-green-500",  bg: "bg-green-500/10" },
  processing:     { label: "En proceso",    Icon: Clock,        color: "text-blue-400",   bg: "bg-blue-500/10" },
}

const TYPE_LABEL: Record<string, string> = {
  binance: "Binance", pago_movil: "Pago Móvil", zelle: "Zelle",
  bank: "Banco", cbu_cvu: "CBU / CVU", wallytech: "WallyTech",
}

function toPaymentMethod(accountType: string): "binance" | "bank_transfer" {
  return accountType === "binance" ? "binance" : "bank_transfer"
}

export default function RecargasPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const { canUseRealMoney } = useCountryAccess()
  const supabase = createBrowserSupabaseClient()

  const [ibyBalance, setIbyBalance] = useState(0)
  const [accounts, setAccounts] = useState<DepositAccount[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [selectedId, setSelectedId] = useState<string>("")
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw" | "history">("deposit")

  // Rate state
  const [currency, setCurrency] = useState("VES")
  const [rate, setRate] = useState<{ rateToUsd: number; source: string; tier: string } | null>(null)
  const [rateLoading, setRateLoading] = useState(false)
  const [rateError, setRateError] = useState(false)

  const [form, setForm] = useState({ amount: "", proof_reference: "" })

  // Withdrawal state
  const [withdrawMethods, setWithdrawMethods] = useState<WithdrawalMethod[]>([])
  const [withdrawForm, setWithdrawForm] = useState({ method_id: "", amount: "" })
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [showAddMethod, setShowAddMethod] = useState(false)
  const [newMethod, setNewMethod] = useState<{ type: "binance" | "bank" | "cbu_cvu"; label: string; details: Record<string, string> }>({ type: "binance", label: "", details: {} })

  const cfg = getCurrency(currency)
  const amountNum = parseFloat(form.amount) || 0
  const amountIby = rate ? (currency === "USD" ? amountNum : amountNum / rate.rateToUsd) : 0

  async function authFetch(input: RequestInfo, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  const fetchRate = useCallback(async () => {
    if (!currency || currency === "USD") {
      setRate({ rateToUsd: 1, source: "direct", tier: "official" })
      return
    }
    setRateLoading(true)
    setRateError(false)
    try {
      const res = await fetch(`/api/ibyc/rate?currency=${currency}`)
      if (res.ok) { setRate(await res.json()); setRateError(false) }
      else { setRate(null); setRateError(true) }
    } catch {
      setRate(null)
      setRateError(true)
    } finally {
      setRateLoading(false)
    }
  }, [currency])

  useEffect(() => { fetchRate() }, [fetchRate])

  async function loadData() {
    setLoading(true)
    try {
      const [balanceRes, accountsRes, historyRes, methodsRes] = await Promise.all([
        authFetch("/api/ibyc/balance"),
        authFetch("/api/ibyc/deposit-accounts"),
        authFetch("/api/ibyc/history"),
        authFetch("/api/withdrawals/methods"),
      ])
      if (balanceRes.ok) {
        const d = await balanceRes.json()
        setIbyBalance(Number(d.balance_ibyc ?? 0))
      }
      if (accountsRes.ok) {
        const d = await accountsRes.json()
        const accs: DepositAccount[] = d.accounts || []
        setAccounts(accs)
        if (accs.length > 0 && !selectedId) setSelectedId(accs[0].id)
      }
      if (historyRes.ok) {
        const d = await historyRes.json()
        setHistory([
          ...(d.deposits || []).map((x: any) => ({ ...x, type: "deposit" })),
          ...(d.withdrawals || []).map((x: any) => ({
            ...x,
            type: "withdrawal",
            amount_ibyc: x.amount_ibyc_requested,
          })),
        ])
      }
      if (methodsRes.ok) {
        const d = await methodsRes.json()
        setWithdrawMethods(d.methods || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user) loadData() }, [user?.id])

  function copyToClipboard(value: string, key: string) {
    navigator.clipboard.writeText(value).catch(() => null)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const withdrawAmount = Number(withdrawForm.amount) || 0
  const withdrawFee = withdrawAmount * 0.06
  const withdrawNet = withdrawAmount - withdrawFee

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault()
    if (!withdrawForm.method_id) { showToast("Seleccioná un método de retiro", "error"); return }
    if (!withdrawAmount || withdrawAmount < 100) { showToast("Monto mínimo: 100 iBYC", "error"); return }
    setConfirmWithdraw(true)
  }

  async function doWithdraw() {
    setConfirmWithdraw(false)
    setWithdrawSubmitting(true)
    try {
      const res = await authFetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method_id: withdrawForm.method_id, amount: withdrawAmount }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error al solicitar retiro", "error"); return }
      showToast("Solicitud enviada. El equipo la procesará pronto.", "success")
      setWithdrawForm({ method_id: "", amount: "" })
      loadData()
    } finally {
      setWithdrawSubmitting(false)
    }
  }

  async function handleAddWithdrawMethod(e: React.FormEvent) {
    e.preventDefault()
    if (!newMethod.label.trim()) { showToast("Etiqueta requerida", "error"); return }
    const res = await authFetch("/api/withdrawals/methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newMethod),
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.error || "Error", "error"); return }
    showToast("Método agregado", "success")
    setShowAddMethod(false)
    setNewMethod({ type: "binance", label: "", details: {} })
    loadData()
  }

  async function handleDeleteWithdrawMethod(id: string) {
    const res = await authFetch(`/api/withdrawals/methods?id=${id}`, { method: "DELETE" })
    if (res.ok) { showToast("Método eliminado", "success"); loadData() }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.amount || amountNum <= 0) { showToast("Monto inválido", "error"); return }
    if (!form.proof_reference.trim()) { showToast("Ingresá el número de referencia", "error"); return }
    if (!selectedId) { showToast("Seleccioná un método de pago", "error"); return }
    if (!rate) { showToast("No se pudo obtener la tasa. Recargá la página.", "error"); return }

    const selectedAccount = accounts.find(a => a.id === selectedId)
    if (!selectedAccount) return

    setSubmitting(true)
    try {
      // Step 1: create deposit (locks rate)
      const depositRes = await authFetch("/api/ibyc/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currency,
          amount_local: amountNum,
          payment_method: toPaymentMethod(selectedAccount.type),
        }),
      })
      const depositData = await depositRes.json()
      if (!depositRes.ok) { showToast(depositData.error || "Error al crear el depósito", "error"); return }

      // Step 2: submit proof reference
      const proofRes = await authFetch(`/api/ibyc/deposit/${depositData.deposit.id}/submit-proof`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof_reference: form.proof_reference.trim() }),
      })
      const proofData = await proofRes.json()
      if (!proofRes.ok) { showToast(proofData.error || "Error al enviar la referencia", "error"); return }

      showToast("Solicitud enviada. La revisaremos a la brevedad.", "success")
      setForm({ amount: "", proof_reference: "" })
      loadData()
    } finally {
      setSubmitting(false)
    }
  }

  const selectedAccount = accounts.find(a => a.id === selectedId)
  const methodCfg = selectedAccount ? (METHOD_CONFIG[selectedAccount.type] ?? null) : null

  if (!user) {
    return (
      <>
        <Navbar />
        <div className="container mx-auto px-4 py-20 text-center text-muted-foreground">
          Iniciá sesión para recargar iBYC.
        </div>
      </>
    )
  }

  if (canUseRealMoney === false) {
    return (
      <>
        <Navbar />
        <div className="container mx-auto px-4 py-20 max-w-md text-center space-y-4">
          <div className="text-4xl">🌍</div>
          <h1 className="text-xl font-bold">No disponible en tu país</h1>
          <p className="text-sm text-muted-foreground">
            Las recargas de iBYC aún no están habilitadas en tu región.
            Por ahora podés disfrutar del Modo Fantasy sin límites.
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">

        {/* Balance */}
        <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <div className="h-10 w-10 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
            <Coins className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Tu saldo iBYC</div>
            <div className="text-2xl font-bold text-amber-400 leading-tight">
              {ibyBalance.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">iBYC</span>
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 border-b border-border">
          <button
            onClick={() => setActiveTab("deposit")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === "deposit" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Depositar
          </button>
          <button
            onClick={() => setActiveTab("withdraw")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === "withdraw" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Retirar
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === "history" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Historial
          </button>
        </div>

        {/* ── Deposit tab ── */}
        {activeTab === "deposit" && (
          <div className="rounded-xl border border-border overflow-hidden">

            <div className="px-5 py-4 border-b border-border">
              <h1 className="text-lg font-bold">Depositar iBYC</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Elegí tu moneda y método, enviá los fondos y reportá la referencia.
              </p>
            </div>

            {accounts.length === 0 && !loading ? (
              <div className="flex items-start gap-2 p-5 text-yellow-600 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                No hay métodos de depósito disponibles. Contactá al soporte.
              </div>
            ) : (
              <>
                {/* Currency + amount */}
                <div className="px-5 pt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Moneda</label>
                      <select
                        value={currency}
                        onChange={e => { setCurrency(e.target.value); setForm(f => ({ ...f, amount: "" })) }}
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
                      >
                        {SUPPORTED_CURRENCIES.map(c => (
                          <option key={c.code} value={c.code}>
                            {c.flag} {c.name} ({c.code})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">
                        Monto a depositar {cfg ? `(${cfg.symbol})` : ""}
                      </label>
                      <Input
                        type="number"
                        min={cfg?.minDepositLocal ?? 1}
                        step="any"
                        placeholder={cfg ? `Mín. ${cfg.minDepositLocal}` : "0.00"}
                        value={form.amount}
                        onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Rate preview / error */}
                  {rateError && !rateLoading && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm text-red-400">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        No se pudo obtener la tasa de cambio. El botón estará desactivado hasta que se recupere.
                      </div>
                      <button
                        type="button"
                        onClick={fetchRate}
                        className="shrink-0 flex items-center gap-1 text-xs text-red-400 hover:text-red-300 border border-red-500/40 rounded px-2 py-1"
                      >
                        <RefreshCw className="h-3 w-3" /> Reintentar
                      </button>
                    </div>
                  )}
                  {(rate || rateLoading) && (
                    <div className="rounded-lg border bg-muted/10 px-4 py-3 text-sm space-y-1.5">
                      {rateLoading ? (
                        <p className="text-xs text-muted-foreground">Obteniendo tasa...</p>
                      ) : rate && (
                        <>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Tasa</span>
                            <span className="font-medium text-foreground">
                              1 USD = {currency !== "USD" ? `${rate.rateToUsd.toLocaleString()} ${cfg?.symbol}` : "1 iBYC"}
                              {rate.tier === "parallel" && (
                                <span className="ml-1.5 text-[10px] font-bold text-yellow-500 bg-yellow-500/10 rounded px-1">[PARALELA]</span>
                              )}
                              {rate.tier === "official" && cfg?.tier === "parallel" && (
                                <span className="ml-1.5 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded px-1">[BCV]</span>
                              )}
                            </span>
                          </div>
                          {amountNum > 0 && (
                            <div className="flex justify-between border-t border-border/40 pt-1.5">
                              <span className="font-medium">Recibirás</span>
                              <span className="font-bold text-amber-400">{amountIby > 0 ? amountIby.toFixed(4) : "—"} iBYC</span>
                            </div>
                          )}
                          {cfg?.legalNote && rate.tier === "parallel" && (
                            <p className="text-[11px] text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1 mt-1">
                              ⚠️ {cfg.legalNote}
                            </p>
                          )}
                          {rate.tier === "official" && cfg?.tier === "parallel" && (
                            <p className="text-[11px] text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1 mt-1">
                              ℹ️ Tasa BCV oficial. La tasa paralela no está disponible en este momento.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Payment method tabs */}
                <div className="flex border-y border-border mt-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {accounts.map((acc) => {
                    const acfg = METHOD_CONFIG[acc.type]
                    const active = acc.id === selectedId
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => { setSelectedId(acc.id); setInstructionsOpen(false) }}
                        className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors shrink-0 ${
                          active
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span className="text-base leading-none">{acfg?.emoji ?? "💳"}</span>
                        <span>{acfg?.name ?? TYPE_LABEL[acc.type] ?? acc.type}</span>
                        {acc.label && (
                          <span className="text-xs text-muted-foreground hidden sm:inline">— {acc.label}</span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {selectedAccount && (
                  <div className="p-5 space-y-5">

                    {/* Account details */}
                    {methodCfg && (
                      <div className={`rounded-lg border ${methodCfg.borderColor} ${methodCfg.bgColor} p-4 space-y-3`}>
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Enviá a esta cuenta
                        </div>
                        <div className="space-y-2">
                          {methodCfg.detailKeys.map(({ key, label }) => {
                            const value = selectedAccount.details?.[key]
                            if (!value) return null
                            return (
                              <div key={key} className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
                                  <div className="text-sm font-semibold font-mono">{value}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(value, key)}
                                  className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary"
                                >
                                  {copiedKey === key
                                    ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copiado</>
                                    : <><Copy className="h-3.5 w-3.5" /> Copiar</>
                                  }
                                </button>
                              </div>
                            )
                          })}
                        </div>
                        {methodCfg.note && (
                          <div className="text-xs text-muted-foreground border-t border-border/50 pt-3 mt-1">
                            ⚠️ {methodCfg.note}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Instructions collapsible */}
                    {methodCfg?.instructions && (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setInstructionsOpen(o => !o)}
                          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-secondary/50 transition-colors"
                        >
                          <span>¿Cómo depositar con {methodCfg.name}?</span>
                          {instructionsOpen
                            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          }
                        </button>
                        {instructionsOpen && (
                          <div className="px-4 pb-4 pt-1 border-t border-border">
                            <ol className="space-y-2">
                              {methodCfg.instructions.map((step, i) => (
                                <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                                  <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                                    {i + 1}
                                  </span>
                                  {step}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Report form */}
                    <div className="space-y-1 pt-1">
                      <div className="text-sm font-semibold">Reportar depósito</div>
                      <p className="text-xs text-muted-foreground">
                        Ya enviaste los fondos? Completá los datos para que los acreditemos.
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">ID / Referencia de transacción</label>
                        <Input
                          placeholder="Hash, número de operación, referencia..."
                          value={form.proof_reference}
                          onChange={e => setForm(f => ({ ...f, proof_reference: e.target.value }))}
                        />
                        <p className="text-xs text-muted-foreground">
                          El número o código que genera la plataforma al confirmar el pago.
                        </p>
                      </div>
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={submitting || !rate || !amountNum || !form.proof_reference.trim()}
                      >
                        {submitting ? "Enviando..." : "Reportar depósito"}
                      </Button>
                    </form>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Withdraw tab ── */}
        {activeTab === "withdraw" && (
          <div className="space-y-5">
            {/* Withdraw form */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-lg font-bold">Solicitar retiro</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Mínimo 100 iBYC · Fee 6% · 1 iBYC = $1 USD</p>
              </div>
              <form onSubmit={handleWithdraw} className="px-5 py-4 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Método de retiro</label>
                  {withdrawMethods.length === 0 ? (
                    <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 text-yellow-600 text-sm">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      No tenés métodos guardados. Agregá uno abajo.
                    </div>
                  ) : (
                    <select
                      className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
                      value={withdrawForm.method_id}
                      onChange={e => setWithdrawForm(f => ({ ...f, method_id: e.target.value }))}
                    >
                      <option value="">Seleccioná un método...</option>
                      {withdrawMethods.map(m => (
                        <option key={m.id} value={m.id}>{TYPE_LABEL[m.type] ?? m.type} — {m.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Monto (iBYC)</label>
                  <Input
                    type="number"
                    min="100"
                    step="0.01"
                    placeholder="0.00"
                    value={withdrawForm.amount}
                    onChange={e => setWithdrawForm(f => ({ ...f, amount: e.target.value }))}
                  />
                </div>
                {withdrawAmount >= 100 && (
                  <div className="rounded-lg bg-muted/20 border border-border p-3 text-sm space-y-1">
                    <div className="flex justify-between"><span>Monto bruto</span><span>{withdrawAmount.toFixed(2)} iBYC</span></div>
                    <div className="flex justify-between text-muted-foreground"><span>Fee (6%)</span><span>− {withdrawFee.toFixed(2)} iBYC</span></div>
                    <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1"><span>A recibir</span><span>{withdrawNet.toFixed(2)} iBYC</span></div>
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={withdrawSubmitting || withdrawMethods.length === 0}>
                  {withdrawSubmitting ? "Enviando..." : "Solicitar retiro"}
                </Button>
              </form>
            </div>

            {/* Withdrawal methods */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold">Mis métodos de retiro</span>
                <Button size="sm" variant="outline" onClick={() => setShowAddMethod(v => !v)}>
                  <Plus className="h-4 w-4 mr-1" /> Agregar
                </Button>
              </div>
              <div className="px-5 py-4 space-y-3">
                {showAddMethod && (
                  <form onSubmit={handleAddWithdrawMethod} className="border border-border rounded-lg p-4 space-y-3 bg-muted/20">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Tipo</label>
                      <select
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
                        value={newMethod.type}
                        onChange={e => setNewMethod(m => ({ ...m, type: e.target.value as "binance" | "bank" | "cbu_cvu", details: {} }))}
                      >
                        <option value="binance">Binance</option>
                        <option value="bank">Cuenta Bancaria</option>
                        <option value="cbu_cvu">CBU / CVU</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Etiqueta (ej: &quot;Mi Binance&quot;)</label>
                      <Input
                        placeholder="Nombre del método"
                        value={newMethod.label}
                        onChange={e => setNewMethod(m => ({ ...m, label: e.target.value }))}
                      />
                    </div>
                    {newMethod.type === "binance" && (
                      <div className="space-y-2">
                        <Input placeholder="Binance ID / UID" onChange={e => setNewMethod(m => ({ ...m, details: { ...m.details, binance_id: e.target.value } }))} />
                        <Input placeholder="Email de Binance" onChange={e => setNewMethod(m => ({ ...m, details: { ...m.details, email: e.target.value } }))} />
                        <Input placeholder="Pay ID (opcional)" onChange={e => setNewMethod(m => ({ ...m, details: { ...m.details, pay_id: e.target.value } }))} />
                      </div>
                    )}
                    {newMethod.type === "bank" && (
                      <div className="space-y-2">
                        <Input placeholder="Banco" onChange={e => setNewMethod(m => ({ ...m, details: { ...m.details, bank_name: e.target.value } }))} />
                        <Input placeholder="Número de cuenta" onChange={e => setNewMethod(m => ({ ...m, details: { ...m.details, account_number: e.target.value } }))} />
                        <Input placeholder="Titular" onChange={e => setNewMethod(m => ({ ...m, details: { ...m.details, holder: e.target.value } }))} />
                      </div>
                    )}
                    {newMethod.type === "cbu_cvu" && (
                      <div className="space-y-2">
                        <Input placeholder="CBU / CVU" onChange={e => setNewMethod(m => ({ ...m, details: { ...m.details, cbu_cvu: e.target.value } }))} />
                        <Input placeholder="Alias (opcional)" onChange={e => setNewMethod(m => ({ ...m, details: { ...m.details, alias: e.target.value } }))} />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button type="submit" size="sm">Guardar</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setShowAddMethod(false)}>Cancelar</Button>
                    </div>
                  </form>
                )}
                {withdrawMethods.length === 0 && !showAddMethod && (
                  <p className="text-sm text-muted-foreground text-center py-4">Sin métodos guardados.</p>
                )}
                {withdrawMethods.map(m => (
                  <div key={m.id} className="flex justify-between items-center py-2 border-b border-border last:border-0">
                    <span className="text-sm font-medium">{TYPE_LABEL[m.type] ?? m.type} — {m.label}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteWithdrawMethod(m.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── History tab ── */}
        {activeTab === "history" && (
          <div className="space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            ) : history.length === 0 ? (
              <div className="rounded-xl border border-border py-10 text-center text-sm text-muted-foreground">
                No tenés movimientos aún.
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                {history.map(item => {
                  const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG["pending"]
                  const { Icon } = cfg
                  const isWithdrawal = item.type === "withdrawal"
                  const currencyCfg = getCurrency(item.currency)
                  return (
                    <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`h-8 w-8 rounded-full ${cfg.bg} flex items-center justify-center shrink-0`}>
                          {isWithdrawal
                            ? <ArrowUpCircle className={`h-4 w-4 ${cfg.color}`} />
                            : <Icon className={`h-4 w-4 ${cfg.color}`} />
                          }
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {isWithdrawal ? "Retiro" : "Depósito"} · {item.currency}
                            {item.payment_method === "binance" ? " · Binance" : " · Transferencia"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {Number(item.amount_local).toLocaleString(undefined, { maximumFractionDigits: 2 })} {currencyCfg?.symbol ?? item.currency}
                            {" · "}{formatDate(item.created_at)}
                          </div>
                          {(item.failed_reason || item.rejection_reason) && (
                            <div className="mt-1 text-xs text-red-500">
                              Motivo: {item.failed_reason ?? item.rejection_reason}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`font-bold text-sm ${isWithdrawal ? "text-red-400" : "text-amber-400"}`}>
                          {isWithdrawal ? "−" : "+"}{Number(item.amount_ibyc).toFixed(2)} iBYC
                        </div>
                        <Badge variant="outline" className={`mt-1 text-[10px] border-0 ${cfg.bg}`}>
                          <span className={cfg.color}>{cfg.label}</span>
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Withdrawal confirm modal */}
      {confirmWithdraw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold">Confirmar retiro</h2>
            <div className="rounded-lg bg-muted/20 border border-border p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Monto bruto</span><span>{withdrawAmount.toFixed(2)} iBYC</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Fee (6%)</span><span>− {withdrawFee.toFixed(2)} iBYC</span></div>
              <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1"><span>A recibir</span><span>{withdrawNet.toFixed(2)} iBYC</span></div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmWithdraw(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={doWithdraw}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
