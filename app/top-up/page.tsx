"use client"

import { useState, useEffect } from "react"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Coins, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useAuth } from "@/components/providers"
import { useToast } from "@/components/toast"
import { formatDate } from "@/lib/utils"

interface DepositAccount {
  id: string
  type: "binance" | "bank" | "cbu_cvu"
  label: string
  details: Record<string, string>
}

interface DepositRequest {
  id: string
  transaction_id: string
  amount: number
  iby_coins: number | null
  transaction_date: string
  status: "pending" | "approved" | "rejected"
  rejection_reason: string | null
  created_at: string
  deposit_account: { type: string; label: string } | null
}

const TYPE_LABEL: Record<string, string> = {
  binance: "Binance",
  bank: "Cuenta Bancaria",
  cbu_cvu: "CBU / CVU",
}

const STATUS_CONFIG = {
  pending:  { label: "Pendiente",  icon: Clock,         color: "text-yellow-500", bg: "bg-yellow-500/10" },
  approved: { label: "Aprobada",   icon: CheckCircle,   color: "text-green-500",  bg: "bg-green-500/10" },
  rejected: { label: "Rechazada",  icon: XCircle,       color: "text-red-500",    bg: "bg-red-500/10" },
}

export default function RecargasPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const supabase = createBrowserSupabaseClient()

  const [ibcBalance, setIbcBalance] = useState<number>(0)
  const [accounts, setAccounts] = useState<DepositAccount[]>([])
  const [requests, setRequests] = useState<DepositRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    transaction_id: "",
    deposit_account_id: "",
    amount: "",
    transaction_date: "",
  })

  async function authFetch(input: RequestInfo, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  async function loadData() {
    setLoading(true)
    try {
      const [walletRes, accountsRes, requestsRes] = await Promise.all([
        authFetch("/api/iby/wallet"),
        fetch("/api/iby/deposit-accounts"),
        authFetch("/api/iby/deposit-requests"),
      ])

      if (walletRes.ok) {
        const d = await walletRes.json()
        setIbcBalance(Number(d.wallet?.balance || 0))
      }
      if (accountsRes.ok) {
        const d = await accountsRes.json()
        setAccounts(d.accounts || [])
      }
      if (requestsRes.ok) {
        const d = await requestsRes.json()
        setRequests(d.requests || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) loadData()
  }, [user?.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.transaction_id.trim()) { showToast("ID de transacción requerido", "error"); return }
    if (!form.deposit_account_id) { showToast("Seleccioná una cuenta", "error"); return }
    if (!form.amount || Number(form.amount) <= 0) { showToast("Monto inválido", "error"); return }
    if (!form.transaction_date) { showToast("Fecha requerida", "error"); return }

    setSubmitting(true)
    try {
      const res = await authFetch("/api/iby/deposit-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: form.transaction_id.trim(),
          deposit_account_id: form.deposit_account_id,
          amount: Number(form.amount),
          transaction_date: form.transaction_date,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || "Error al enviar solicitud", "error")
        return
      }

      showToast("Solicitud enviada. El backoffice la revisará a la brevedad.", "success")
      setForm({ transaction_id: "", deposit_account_id: "", amount: "", transaction_date: "" })
      loadData()
    } finally {
      setSubmitting(false)
    }
  }

  function accountDisplayDetails(acc: DepositAccount) {
    const d = acc.details || {}
    if (acc.type === "binance") {
      return [d.binance_id, d.email, d.pay_id].filter(Boolean).join(" · ")
    }
    if (acc.type === "bank") {
      return [d.bank_name, d.account_type, d.account_number, d.holder].filter(Boolean).join(" · ")
    }
    if (acc.type === "cbu_cvu") {
      return [d.cbu_cvu, d.alias].filter(Boolean).join(" · ")
    }
    return ""
  }

  if (!user) {
    return (
      <>
        <Navbar />
        <div className="container mx-auto px-4 py-20 text-center">
          <p className="text-muted-foreground">Iniciá sesión para recargar iBY Coins.</p>
        </div>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-8">

        {/* Balance */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center">
              <Coins className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Tu saldo de iBY Coins</div>
              <div className="text-3xl font-bold text-primary">
                {ibcBalance.toFixed(2)} <span className="text-base font-medium">IBC</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Formulario de recarga */}
        <Card>
          <CardHeader>
            <CardTitle>Reportar depósito</CardTitle>
            <p className="text-sm text-muted-foreground">
              Completá los datos de tu transferencia para que la validemos y acreditemos tus iBY Coins.
            </p>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 && !loading ? (
              <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 text-yellow-600 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                No hay cuentas de depósito disponibles. Contactá al soporte.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Cuenta destino</label>
                  <select
                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
                    value={form.deposit_account_id}
                    onChange={(e) => setForm((f) => ({ ...f, deposit_account_id: e.target.value }))}
                  >
                    <option value="">Seleccioná una cuenta...</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {TYPE_LABEL[acc.type]} — {acc.label}
                        {accountDisplayDetails(acc) ? ` (${accountDisplayDetails(acc)})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">ID de transacción</label>
                  <Input
                    placeholder="Hash, número de operación, etc."
                    value={form.transaction_id}
                    onChange={(e) => setForm((f) => ({ ...f, transaction_id: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Monto (pesos)</label>
                    <Input
                      type="number"
                      min="1"
                      step="0.01"
                      placeholder="0.00"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Fecha de la transferencia</label>
                    <Input
                      type="date"
                      value={form.transaction_date}
                      max={new Date().toISOString().split("T")[0]}
                      onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))}
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Enviando..." : "Enviar solicitud"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Historial */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold">Historial de recargas</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : requests.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground text-sm">
                No tenés solicitudes de recarga aún.
              </CardContent>
            </Card>
          ) : (
            requests.map((req) => {
              const cfg = STATUS_CONFIG[req.status]
              const Icon = cfg.icon
              return (
                <Card key={req.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className={`h-8 w-8 rounded-full ${cfg.bg} flex items-center justify-center`}>
                          <Icon className={`h-4 w-4 ${cfg.color}`} />
                        </div>
                        <div>
                          <div className="text-sm font-medium">
                            {req.deposit_account
                              ? `${TYPE_LABEL[req.deposit_account.type] || req.deposit_account.type} — ${req.deposit_account.label}`
                              : "Cuenta desconocida"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            TX: {req.transaction_id} · {formatDate(req.created_at)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold">${Number(req.amount).toFixed(2)}</div>
                        {req.iby_coins != null && (
                          <div className="text-xs text-primary font-medium">{Number(req.iby_coins).toFixed(2)} IBC</div>
                        )}
                        <Badge className={`mt-1 text-[10px] ${cfg.bg} border-0`}>
                          <span className={cfg.color}>{cfg.label}</span>
                        </Badge>
                      </div>
                    </div>
                    {req.status === "rejected" && req.rejection_reason && (
                      <div className="mt-2 text-xs text-red-500 bg-red-500/10 rounded px-2 py-1">
                        Motivo: {req.rejection_reason}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
