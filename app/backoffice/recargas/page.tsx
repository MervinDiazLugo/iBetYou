"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle, XCircle, Clock, RefreshCw, Plus, Pencil, Trash2, Coins
} from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"
import { formatDate } from "@/lib/utils"

// ─── Types ──────────────────────────────────────────────────────────────────

interface DepositRequest {
  id: string
  transaction_id: string
  amount: number
  iby_coins: number | null
  transaction_date: string
  status: "pending" | "approved" | "rejected"
  rejection_reason: string | null
  created_at: string
  user: { id: string; nickname: string; email: string } | null
  deposit_account: { type: string; label: string; details: Record<string, string> } | null
}

interface DepositAccount {
  id: string
  type: "binance" | "bank" | "cbu_cvu"
  label: string
  details: Record<string, string>
  is_active: boolean
  created_at: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  binance: "Binance",
  bank: "Cuenta Bancaria",
  cbu_cvu: "CBU / CVU",
}

const STATUS_CONFIG = {
  pending:  { label: "Pendiente",  color: "text-yellow-500", bg: "bg-yellow-500/10" },
  approved: { label: "Aprobada",   color: "text-green-500",  bg: "bg-green-500/10" },
  rejected: { label: "Rechazada",  color: "text-red-500",    bg: "bg-red-500/10" },
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BackofficeRecargas() {
  const supabase = createBrowserSupabaseClient()
  const { showToast } = useToast()
  const [tab, setTab] = useState<"requests" | "accounts" | "settings">("requests")

  async function authFetch(input: RequestInfo, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  // ── Tab: Solicitudes ────────────────────────────────────────────────────────

  const [requests, setRequests] = useState<DepositRequest[]>([])
  const [requestsFilter, setRequestsFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending")
  const [loadingRequests, setLoadingRequests] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [rejectModal, setRejectModal] = useState<{ id: string; amount: number } | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [editCoins, setEditCoins] = useState<Record<string, string>>({})

  async function fetchRequests() {
    setLoadingRequests(true)
    try {
      const res = await authFetch(`/api/admin/iby/deposit-requests?status=${requestsFilter}`)
      const data = await res.json()
      setRequests(data.requests || [])
      const initial: Record<string, string> = {}
      for (const r of data.requests || []) {
        initial[r.id] = r.iby_coins != null ? String(r.iby_coins) : String(r.amount)
      }
      setEditCoins(initial)
    } finally {
      setLoadingRequests(false)
    }
  }

  useEffect(() => { if (tab === "requests") fetchRequests() }, [tab, requestsFilter])

  async function handleApprove(req: DepositRequest) {
    setActionLoading(req.id)
    try {
      const coins = Number(editCoins[req.id])
      if (!coins || coins <= 0) { showToast("iBY coins inválidos", "error"); return }
      const res = await authFetch(`/api/admin/iby/deposit-requests/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", iby_coins: coins }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error", "error"); return }
      showToast(`Aprobada — ${coins} IBC acreditados a ${req.user?.nickname || req.user?.email}`, "success")
      fetchRequests()
    } finally {
      setActionLoading(null)
    }
  }

  async function handleReject() {
    if (!rejectModal) return
    if (!rejectReason.trim()) { showToast("Ingresá un motivo", "error"); return }
    setActionLoading(rejectModal.id)
    try {
      const res = await authFetch(`/api/admin/iby/deposit-requests/${rejectModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", rejection_reason: rejectReason }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error", "error"); return }
      showToast("Solicitud rechazada", "success")
      setRejectModal(null)
      setRejectReason("")
      fetchRequests()
    } finally {
      setActionLoading(null)
    }
  }

  // ── Tab: Cuentas ────────────────────────────────────────────────────────────

  const [accounts, setAccounts] = useState<DepositAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [accountModal, setAccountModal] = useState<Partial<DepositAccount> | null>(null)
  const [accountSaving, setAccountSaving] = useState(false)

  async function fetchAccounts() {
    setLoadingAccounts(true)
    try {
      const res = await authFetch("/api/admin/iby/accounts")
      const data = await res.json()
      setAccounts(data.accounts || [])
    } finally {
      setLoadingAccounts(false)
    }
  }

  useEffect(() => { if (tab === "accounts") fetchAccounts() }, [tab])

  async function saveAccount() {
    if (!accountModal) return
    const { type, label, details, id } = accountModal
    if (!type || !label?.trim()) { showToast("Tipo y etiqueta requeridos", "error"); return }
    setAccountSaving(true)
    try {
      const isEdit = Boolean(id)
      const res = await authFetch(isEdit ? `/api/admin/iby/accounts/${id}` : "/api/admin/iby/accounts", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, label: label.trim(), details: details || {} }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error", "error"); return }
      showToast(isEdit ? "Cuenta actualizada" : "Cuenta creada", "success")
      setAccountModal(null)
      fetchAccounts()
    } finally {
      setAccountSaving(false)
    }
  }

  async function toggleAccount(acc: DepositAccount) {
    const res = await authFetch(`/api/admin/iby/accounts/${acc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !acc.is_active }),
    })
    if (res.ok) {
      showToast(acc.is_active ? "Cuenta desactivada" : "Cuenta activada", "success")
      fetchAccounts()
    }
  }

  // ── Tab: Configuración ──────────────────────────────────────────────────────

  const [ibcPrice, setIbcPrice] = useState("")
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [savingPrice, setSavingPrice] = useState(false)

  async function fetchSettings() {
    setLoadingSettings(true)
    try {
      const res = await authFetch("/api/admin/iby/settings")
      const data = await res.json()
      const priceSetting = (data.settings || []).find((s: { key: string; value: string }) => s.key === "iby_coin_price")
      if (priceSetting) setIbcPrice(priceSetting.value)
    } finally {
      setLoadingSettings(false)
    }
  }

  useEffect(() => { if (tab === "settings") fetchSettings() }, [tab])

  async function savePrice() {
    const price = Number(ibcPrice)
    if (!price || price <= 0) { showToast("Precio inválido", "error"); return }
    setSavingPrice(true)
    try {
      const res = await authFetch("/api/admin/iby/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iby_coin_price: price }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error", "error"); return }
      showToast(`Precio actualizado: 1 IBC = $${price}`, "success")
    } finally {
      setSavingPrice(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Coins className="h-7 w-7 text-primary" />
            Recargas iBY Coin
          </h1>
          <p className="text-muted-foreground">Gestión de recargas, cuentas y precio del token</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-0">
        {(["requests", "accounts", "settings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {{ requests: "Solicitudes", accounts: "Cuentas", settings: "Configuración" }[t]}
          </button>
        ))}
      </div>

      {/* ── Tab: Solicitudes ── */}
      {tab === "requests" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <select
              value={requestsFilter}
              onChange={(e) => setRequestsFilter(e.target.value as typeof requestsFilter)}
              className="px-3 py-2 rounded-lg border bg-background text-sm"
            >
              <option value="pending">Pendientes</option>
              <option value="approved">Aprobadas</option>
              <option value="rejected">Rechazadas</option>
              <option value="all">Todas</option>
            </select>
            <Button variant="outline" size="sm" onClick={fetchRequests} disabled={loadingRequests}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loadingRequests ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
          </div>

          {loadingRequests ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : requests.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No hay solicitudes {requestsFilter !== "all" ? STATUS_CONFIG[requestsFilter as keyof typeof STATUS_CONFIG]?.label?.toLowerCase() + "s" : ""}.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {requests.map((req) => {
                const cfg = STATUS_CONFIG[req.status]
                const acc = req.deposit_account
                return (
                  <Card key={req.id} className={req.status === "pending" ? "border-yellow-500/40 bg-yellow-500/5" : ""}>
                    <CardContent className="pt-4 pb-4 space-y-3">
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-sm">
                            {req.user?.nickname || req.user?.email || "Usuario desconocido"}
                            <span className="text-xs text-muted-foreground ml-2">{req.user?.email}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {acc ? `${TYPE_LABEL[acc.type] || acc.type} — ${acc.label}` : "Cuenta desconocida"}
                            {" · "}TX: <span className="font-mono">{req.transaction_id}</span>
                            {" · "}Fecha: {req.transaction_date}
                          </div>
                        </div>
                        <Badge className={`${cfg.bg} border-0 shrink-0`}>
                          <span className={cfg.color}>{cfg.label}</span>
                        </Badge>
                      </div>

                      {/* Amount + coins */}
                      <div className="flex flex-wrap items-end gap-4">
                        <div>
                          <div className="text-xs text-muted-foreground">Monto reportado</div>
                          <div className="text-lg font-bold">${Number(req.amount).toFixed(2)}</div>
                        </div>

                        {req.status === "pending" ? (
                          <div className="flex-1 min-w-[140px]">
                            <label className="text-xs text-muted-foreground block mb-1">iBY Coins a acreditar</label>
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={editCoins[req.id] ?? ""}
                              onChange={(e) => setEditCoins((prev) => ({ ...prev, [req.id]: e.target.value }))}
                              className="h-8 text-sm"
                            />
                          </div>
                        ) : req.iby_coins != null ? (
                          <div>
                            <div className="text-xs text-muted-foreground">iBY Coins acreditados</div>
                            <div className="text-lg font-bold text-primary">{Number(req.iby_coins).toFixed(2)} IBC</div>
                          </div>
                        ) : null}

                        <div className="text-xs text-muted-foreground self-end">
                          Recibida: {formatDate(req.created_at)}
                        </div>
                      </div>

                      {req.status === "rejected" && req.rejection_reason && (
                        <div className="text-xs text-red-500 bg-red-500/10 rounded px-2 py-1">
                          Motivo de rechazo: {req.rejection_reason}
                        </div>
                      )}

                      {/* Actions */}
                      {req.status === "pending" && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => handleApprove(req)}
                            disabled={actionLoading === req.id}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Aprobar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-500/40 text-red-500 hover:bg-red-500/10"
                            onClick={() => { setRejectModal({ id: req.id, amount: req.amount }); setRejectReason("") }}
                            disabled={actionLoading === req.id}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Rechazar
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Cuentas ── */}
      {tab === "accounts" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setAccountModal({ type: "binance", label: "", details: {} })}>
              <Plus className="h-4 w-4 mr-1" /> Nueva cuenta
            </Button>
          </div>

          {loadingAccounts ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : accounts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No hay cuentas configuradas.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {accounts.map((acc) => (
                <Card key={acc.id} className={!acc.is_active ? "opacity-60" : ""}>
                  <CardContent className="pt-4 pb-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{TYPE_LABEL[acc.type] || acc.type}</Badge>
                        <span className="font-medium text-sm">{acc.label}</span>
                        {!acc.is_active && <Badge variant="secondary" className="text-xs">Inactiva</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {Object.entries(acc.details || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => setAccountModal(acc)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className={acc.is_active ? "border-red-500/40 text-red-500 hover:bg-red-500/10" : ""}
                        onClick={() => toggleAccount(acc)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Configuración ── */}
      {tab === "settings" && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Precio del iBY Coin</CardTitle>
            <p className="text-sm text-muted-foreground">
              Define cuántos pesos cuesta 1 iBY Coin. Afecta las recargas aprobadas a partir de este momento.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingSettings ? (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Precio (pesos por 1 IBC)</label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={ibcPrice}
                    onChange={(e) => setIbcPrice(e.target.value)}
                    placeholder="1.00"
                  />
                  {ibcPrice && Number(ibcPrice) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Con este precio: $100 pesos = {(100 / Number(ibcPrice)).toFixed(2)} IBC
                    </p>
                  )}
                </div>
                <Button onClick={savePrice} disabled={savingPrice}>
                  {savingPrice ? "Guardando..." : "Guardar precio"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Modal: Rechazar ── */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Rechazar solicitud</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Solicitud por <strong>${Number(rejectModal.amount).toFixed(2)}</strong>. Indicá el motivo del rechazo — se notificará al usuario por email.
              </p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Motivo (requerido)</label>
                <Input
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Ej: El ID de transacción no coincide con nuestros registros"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setRejectModal(null); setRejectReason("") }}>
                  Cancelar
                </Button>
                <Button variant="destructive" className="flex-1" onClick={handleReject} disabled={actionLoading !== null}>
                  {actionLoading ? "Procesando..." : "Confirmar rechazo"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Modal: Crear / Editar cuenta ── */}
      {accountModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>{accountModal.id ? "Editar cuenta" : "Nueva cuenta de depósito"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tipo</label>
                  <select
                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
                    value={accountModal.type || "binance"}
                    onChange={(e) => setAccountModal((p) => ({ ...p, type: e.target.value as DepositAccount["type"], details: {} }))}
                  >
                    <option value="binance">Binance</option>
                    <option value="bank">Cuenta Bancaria</option>
                    <option value="cbu_cvu">CBU / CVU</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Etiqueta</label>
                  <Input
                    placeholder="Nombre amigable"
                    value={accountModal.label || ""}
                    onChange={(e) => setAccountModal((p) => ({ ...p, label: e.target.value }))}
                  />
                </div>
              </div>

              {/* Binance fields */}
              {accountModal.type === "binance" && (
                <div className="grid grid-cols-2 gap-3">
                  {["binance_id", "email", "pay_id"].map((field) => (
                    <div key={field} className="space-y-1.5">
                      <label className="text-sm font-medium capitalize">{field.replace("_", " ")}</label>
                      <Input
                        value={(accountModal.details as Record<string, string>)?.[field] || ""}
                        onChange={(e) => setAccountModal((p) => ({ ...p, details: { ...(p?.details || {}), [field]: e.target.value } }))}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Bank fields */}
              {accountModal.type === "bank" && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "bank_name", label: "Banco" },
                    { key: "account_number", label: "Número de cuenta" },
                    { key: "account_type", label: "Tipo (caja/corriente)" },
                    { key: "holder", label: "Titular" },
                  ].map(({ key, label }) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-sm font-medium">{label}</label>
                      <Input
                        value={(accountModal.details as Record<string, string>)?.[key] || ""}
                        onChange={(e) => setAccountModal((p) => ({ ...p, details: { ...(p?.details || {}), [key]: e.target.value } }))}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* CBU/CVU fields */}
              {accountModal.type === "cbu_cvu" && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "cbu_cvu", label: "CBU / CVU" },
                    { key: "alias", label: "Alias" },
                  ].map(({ key, label }) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-sm font-medium">{label}</label>
                      <Input
                        value={(accountModal.details as Record<string, string>)?.[key] || ""}
                        onChange={(e) => setAccountModal((p) => ({ ...p, details: { ...(p?.details || {}), [key]: e.target.value } }))}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setAccountModal(null)}>
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={saveAccount} disabled={accountSaving}>
                  {accountSaving ? "Guardando..." : accountModal.id ? "Guardar cambios" : "Crear cuenta"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
