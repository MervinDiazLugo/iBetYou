"use client"

import { useState, useEffect } from "react"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Coins, Clock, CheckCircle, XCircle, Plus, Trash2, AlertCircle } from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useAuth } from "@/components/providers"
import { useToast } from "@/components/toast"

interface WithdrawalMethod {
  id: string
  type: "binance" | "bank" | "cbu_cvu"
  label: string
  details: Record<string, string>
}

interface WithdrawalRequest {
  id: string
  amount: number
  fee_amount: number
  net_amount: number
  status: "pending" | "processing" | "paid" | "rejected"
  rejection_type: string | null
  rejection_reason: string | null
  created_at: string
  method: { type: string; label: string } | null
}

const TYPE_LABEL: Record<string, string> = {
  binance: "Binance",
  bank: "Cuenta Bancaria",
  cbu_cvu: "CBU / CVU",
}

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: any }> = {
  pending:    { label: "Pendiente",  color: "text-yellow-500", Icon: Clock },
  processing: { label: "Procesando", color: "text-blue-400",  Icon: Clock },
  paid:       { label: "Pagado",     color: "text-green-500", Icon: CheckCircle },
  rejected:   { label: "Rechazado",  color: "text-red-500",   Icon: XCircle },
}

export default function WithdrawalsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const supabase = createBrowserSupabaseClient()

  const [ibcBalance, setIbcBalance] = useState(0)
  const [methods, setMethods] = useState<WithdrawalMethod[]>([])
  const [requests, setRequests] = useState<WithdrawalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showAddMethod, setShowAddMethod] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)

  const [form, setForm] = useState({ method_id: "", amount: "" })
  const [newMethod, setNewMethod] = useState({
    type: "binance" as "binance" | "bank" | "cbu_cvu",
    label: "",
    details: {} as Record<string, string>,
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
      const [walletRes, methodsRes, requestsRes] = await Promise.all([
        authFetch("/api/iby/wallet"),
        authFetch("/api/withdrawals/methods"),
        authFetch("/api/withdrawals"),
      ])
      if (walletRes.ok) {
        const d = await walletRes.json()
        setIbcBalance(Number(d.wallet?.balance || 0) - Number(d.wallet?.balance_blocked || 0))
      }
      if (methodsRes.ok) {
        const d = await methodsRes.json()
        setMethods(d.methods || [])
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

  const amount = Number(form.amount) || 0
  const fee = amount * 0.06
  const net = amount - fee

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault()
    if (!form.method_id) { showToast("Seleccioná un método de retiro", "error"); return }
    if (!amount || amount < 100) { showToast("Monto mínimo: 100 iBY", "error"); return }
    setConfirmWithdraw(true)
  }

  async function doWithdraw() {
    setConfirmWithdraw(false)
    setSubmitting(true)
    try {
      const res = await authFetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method_id: form.method_id, amount }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || "Error al solicitar retiro", "error")
        return
      }
      showToast("Solicitud enviada. El equipo la procesará pronto.", "success")
      setForm({ method_id: "", amount: "" })
      loadData()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAddMethod(e: React.FormEvent) {
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

  async function handleDeleteMethod(id: string) {
    const res = await authFetch(`/api/withdrawals/methods?id=${id}`, { method: "DELETE" })
    if (res.ok) { showToast("Método eliminado", "success"); loadData() }
  }

  if (!user) return (
    <>
      <Navbar />
      <div className="container mx-auto px-4 py-20 text-center text-muted-foreground">
        Iniciá sesión para gestionar retiros.
      </div>
    </>
  )

  return (
    <>
      <Navbar />
      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-8">

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-amber-500/15 flex items-center justify-center">
              <Coins className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Saldo iBY disponible</div>
              <div className="text-3xl font-bold text-amber-400">
                {ibcBalance.toFixed(2)} <span className="text-base font-medium">iBY</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Solicitar retiro</CardTitle>
            <p className="text-sm text-muted-foreground">Mínimo 100 iBY · Fee 6% · 1 iBY = $1 USD</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleWithdraw} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Método de retiro</label>
                {methods.length === 0 ? (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 text-yellow-600 text-sm">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    No tenés métodos guardados. Agregá uno abajo.
                  </div>
                ) : (
                  <select
                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
                    value={form.method_id}
                    onChange={(e) => setForm((f) => ({ ...f, method_id: e.target.value }))}
                  >
                    <option value="">Seleccioná un método...</option>
                    {methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {TYPE_LABEL[m.type]} — {m.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Monto (iBY)</label>
                <Input
                  type="number"
                  min="100"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>

              {amount >= 100 && (
                <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Monto bruto</span><span>{amount.toFixed(2)} iBY</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Fee (6%)</span><span>- {fee.toFixed(2)} iBY</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                    <span>A recibir</span><span>{net.toFixed(2)} iBY</span>
                  </div>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={submitting || methods.length === 0}>
                {submitting ? "Enviando..." : "Solicitar retiro"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Mis métodos de retiro</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowAddMethod(!showAddMethod)}>
              <Plus className="h-4 w-4 mr-1" /> Agregar
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {showAddMethod && (
              <form onSubmit={handleAddMethod} className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tipo</label>
                  <select
                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
                    value={newMethod.type}
                    onChange={(e) => setNewMethod((m) => ({ ...m, type: e.target.value as "binance" | "bank" | "cbu_cvu" }))}
                  >
                    <option value="binance">Binance</option>
                    <option value="bank">Cuenta Bancaria</option>
                    <option value="cbu_cvu">CBU / CVU</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Etiqueta (ej: "Mi Binance")</label>
                  <Input
                    placeholder="Nombre del método"
                    value={newMethod.label}
                    onChange={(e) => setNewMethod((m) => ({ ...m, label: e.target.value }))}
                  />
                </div>
                {newMethod.type === "binance" && (
                  <div className="space-y-2">
                    <Input placeholder="Binance ID / UID" onChange={(e) => setNewMethod((m) => ({ ...m, details: { ...m.details, binance_id: e.target.value } }))} />
                    <Input placeholder="Email de Binance" onChange={(e) => setNewMethod((m) => ({ ...m, details: { ...m.details, email: e.target.value } }))} />
                    <Input placeholder="Pay ID (opcional)" onChange={(e) => setNewMethod((m) => ({ ...m, details: { ...m.details, pay_id: e.target.value } }))} />
                  </div>
                )}
                {newMethod.type === "bank" && (
                  <div className="space-y-2">
                    <Input placeholder="Banco" onChange={(e) => setNewMethod((m) => ({ ...m, details: { ...m.details, bank_name: e.target.value } }))} />
                    <Input placeholder="Número de cuenta" onChange={(e) => setNewMethod((m) => ({ ...m, details: { ...m.details, account_number: e.target.value } }))} />
                    <Input placeholder="Titular" onChange={(e) => setNewMethod((m) => ({ ...m, details: { ...m.details, holder: e.target.value } }))} />
                  </div>
                )}
                {newMethod.type === "cbu_cvu" && (
                  <div className="space-y-2">
                    <Input placeholder="CBU / CVU" onChange={(e) => setNewMethod((m) => ({ ...m, details: { ...m.details, cbu_cvu: e.target.value } }))} />
                    <Input placeholder="Alias (opcional)" onChange={(e) => setNewMethod((m) => ({ ...m, details: { ...m.details, alias: e.target.value } }))} />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button type="submit" size="sm">Guardar</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowAddMethod(false)}>Cancelar</Button>
                </div>
              </form>
            )}

            {methods.length === 0 && !showAddMethod && (
              <p className="text-sm text-muted-foreground text-center py-4">Sin métodos guardados.</p>
            )}
            {methods.map((m) => (
              <div key={m.id} className="flex justify-between items-center py-2 border-b border-border last:border-0">
                <p className="text-sm font-medium">{TYPE_LABEL[m.type]} — {m.label}</p>
                <button
                  type="button"
                  onClick={() => handleDeleteMethod(m.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-bold">Historial de retiros</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : requests.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground text-sm">
                No tenés solicitudes de retiro aún.
              </CardContent>
            </Card>
          ) : (
            requests.map((req) => {
              const cfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending
              const Icon = cfg.Icon
              return (
                <Card key={req.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                        <div>
                          <p className="text-sm font-medium">
                            {req.method ? `${TYPE_LABEL[req.method.type] || req.method.type} — ${req.method.label}` : "Método eliminado"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(req.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{Number(req.amount).toFixed(2)} iBY</p>
                        <p className="text-xs text-muted-foreground">Neto: {Number(req.net_amount).toFixed(2)} iBY</p>
                        <Badge className="mt-1 text-[10px]">
                          <span className={cfg.color}>{cfg.label}</span>
                        </Badge>
                      </div>
                    </div>
                    {req.status === "rejected" && req.rejection_reason && (
                      <p className="mt-2 text-xs text-red-500 bg-red-500/10 rounded px-2 py-1">
                        {req.rejection_type === "forfeit" ? "Retenido: " : "Rechazado: "}{req.rejection_reason}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      </div>

      {confirmWithdraw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold">Confirmar retiro</h2>
            <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Monto bruto</span><span>{amount.toFixed(2)} iBY</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Fee (6%)</span><span>- {fee.toFixed(2)} iBY</span></div>
              <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>A recibir</span><span>{net.toFixed(2)} iBY</span></div>
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
