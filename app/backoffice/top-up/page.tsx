"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle, XCircle, Clock, RefreshCw, Plus, Pencil, Trash2, Coins,
  ArrowDownCircle, ArrowUpCircle, MessageCircle, Check, X, AlertTriangle,
} from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"
import { formatDate } from "@/lib/utils"
import { CURRENCY_MAP } from "@/lib/ibyc/config"

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
  profile: { id: string; nickname: string; email: string } | null
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

type IbyDepositStatus = "pending" | "proof_submitted" | "confirmed" | "failed"
type IbyWithdrawalStatus = "pending" | "processing" | "completed" | "rejected"

interface IbyDeposit {
  id: string
  currency: string
  amount_local: number
  amount_ibyc: number
  rate_to_usd: number
  rate_source: string
  rate_tier: string
  payment_method: string
  proof_reference: string | null
  contact_whatsapp: string | null
  status: IbyDepositStatus
  failed_reason: string | null
  created_at: string
  confirmed_at: string | null
  user: { id: string; nickname: string; email: string; phone_whatsapp: string | null }
}

interface IbyWithdrawal {
  id: string
  currency: string
  amount_ibyc_requested: number
  fee_ibyc: number
  amount_ibyc_net: number
  amount_local: number
  rate_to_usd: number
  rate_source: string
  payment_method: string
  payment_details: string
  contact_whatsapp: string | null
  status: IbyWithdrawalStatus
  rejection_reason: string | null
  admin_notes: string | null
  created_at: string
  processed_at: string | null
  user: { id: string; nickname: string; email: string; phone_whatsapp: string | null }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  binance: "Binance",
  bank: "Cuenta Bancaria",
  cbu_cvu: "CBU / CVU",
}

const LEGACY_STATUS_CONFIG = {
  pending:  { label: "Pendiente",  color: "text-yellow-500", bg: "bg-yellow-500/10" },
  approved: { label: "Aprobada",   color: "text-green-500",  bg: "bg-green-500/10" },
  rejected: { label: "Rechazada",  color: "text-red-500",    bg: "bg-red-500/10" },
}

const DEPOSIT_STATUS_LABELS: Record<IbyDepositStatus, string> = {
  pending: "Pendiente",
  proof_submitted: "Ref. enviada",
  confirmed: "Confirmado",
  failed: "Rechazado",
}
const DEPOSIT_STATUS_COLORS: Record<IbyDepositStatus, string> = {
  pending: "secondary",
  proof_submitted: "default",
  confirmed: "secondary",
  failed: "destructive",
}
const WITHDRAWAL_STATUS_LABELS: Record<IbyWithdrawalStatus, string> = {
  pending: "Pendiente",
  processing: "En proceso",
  completed: "Completado",
  rejected: "Rechazado",
}
const WITHDRAWAL_STATUS_COLORS: Record<IbyWithdrawalStatus, string> = {
  pending: "secondary",
  processing: "default",
  completed: "secondary",
  rejected: "destructive",
}

function waLink(number: string | null | undefined) {
  if (!number) return null
  const clean = number.replace(/\D/g, "")
  return `https://wa.me/${clean}`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  })
}

type Tab = "iby_deposits" | "iby_withdrawals" | "legacy_requests" | "accounts"

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BackofficeRecargas() {
  const supabase = createBrowserSupabaseClient()
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>("iby_deposits")

  async function authFetch(input: RequestInfo, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  // ── iBYC Deposits (new multi-currency system) ────────────────────────────────

  const [ibyDeposits, setIbyDeposits] = useState<IbyDeposit[]>([])
  const [ibyDepositFilter, setIbyDepositFilter] = useState("proof_submitted")
  const [ibyDepositLoading, setIbyDepositLoading] = useState(false)
  const [depositActionLoading, setDepositActionLoading] = useState<string | null>(null)
  const [rejectDepositModal, setRejectDepositModal] = useState<{ id: string } | null>(null)
  const [rejectDepositReason, setRejectDepositReason] = useState("")
  const [rateOverrideModal, setRateOverrideModal] = useState(false)
  const [overrideCurrency, setOverrideCurrency] = useState("VES")
  const [overrideRate, setOverrideRate] = useState("")

  const fetchIbyDeposits = useCallback(async () => {
    setIbyDepositLoading(true)
    try {
      const params = new URLSearchParams({ limit: "100" })
      if (ibyDepositFilter && ibyDepositFilter !== "all") params.set("status", ibyDepositFilter)
      const res = await authFetch(`/api/admin/ibyc/deposits?${params}`)
      const data = await res.json()
      setIbyDeposits(data.deposits ?? [])
    } finally { setIbyDepositLoading(false) }
  }, [ibyDepositFilter])

  useEffect(() => { if (tab === "iby_deposits") fetchIbyDeposits() }, [tab, fetchIbyDeposits])

  async function approveIbyDeposit(id: string) {
    setDepositActionLoading(id)
    try {
      const res = await authFetch(`/api/admin/ibyc/deposits/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? "Error", "error"); return }
      showToast(`Depósito aprobado — ${Number(data.amount_ibyc).toFixed(2)} iBYC acreditados`, "success")
      fetchIbyDeposits()
    } finally { setDepositActionLoading(null) }
  }

  async function rejectIbyDeposit() {
    if (!rejectDepositModal || !rejectDepositReason.trim()) return
    setDepositActionLoading(rejectDepositModal.id)
    try {
      const res = await authFetch(`/api/admin/ibyc/deposits/${rejectDepositModal.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectDepositReason }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? "Error", "error"); return }
      showToast("Depósito rechazado", "success")
      setRejectDepositModal(null)
      setRejectDepositReason("")
      fetchIbyDeposits()
    } finally { setDepositActionLoading(null) }
  }

  async function handleRateOverride() {
    if (!overrideRate || !overrideCurrency) return
    const res = await authFetch("/api/admin/ibyc/rate-override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency: overrideCurrency, rate: parseFloat(overrideRate) }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.error ?? "Error", "error"); return }
    showToast(`Tasa ${overrideCurrency} override activa por 4h`, "success")
    setRateOverrideModal(false)
    setOverrideRate("")
  }

  const DEPOSIT_STATUS_FILTERS = [
    { value: "proof_submitted", label: "Ref. enviada" },
    { value: "pending", label: "Pendiente" },
    { value: "confirmed", label: "Confirmado" },
    { value: "failed", label: "Rechazado" },
    { value: "all", label: "Todos" },
  ]

  // ── iBYC Withdrawals ──────────────────────────────────────────────────────────

  const [ibyWithdrawals, setIbyWithdrawals] = useState<IbyWithdrawal[]>([])
  const [ibyWithdrawalFilter, setIbyWithdrawalFilter] = useState("pending")
  const [ibyWithdrawalLoading, setIbyWithdrawalLoading] = useState(false)
  const [withdrawalActionLoading, setWithdrawalActionLoading] = useState<string | null>(null)
  const [rejectWithdrawalModal, setRejectWithdrawalModal] = useState<{ id: string } | null>(null)
  const [rejectWithdrawalReason, setRejectWithdrawalReason] = useState("")

  const fetchIbyWithdrawals = useCallback(async () => {
    setIbyWithdrawalLoading(true)
    try {
      const params = new URLSearchParams({ limit: "100" })
      if (ibyWithdrawalFilter && ibyWithdrawalFilter !== "all") params.set("status", ibyWithdrawalFilter)
      const res = await authFetch(`/api/admin/ibyc/withdrawals?${params}`)
      const data = await res.json()
      setIbyWithdrawals(data.withdrawals ?? [])
    } finally { setIbyWithdrawalLoading(false) }
  }, [ibyWithdrawalFilter])

  useEffect(() => { if (tab === "iby_withdrawals") fetchIbyWithdrawals() }, [tab, fetchIbyWithdrawals])

  async function completeWithdrawal(id: string) {
    setWithdrawalActionLoading(id)
    try {
      const res = await authFetch(`/api/admin/ibyc/withdrawals/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? "Error", "error"); return }
      showToast("Retiro marcado como completado", "success")
      fetchIbyWithdrawals()
    } finally { setWithdrawalActionLoading(null) }
  }

  async function rejectWithdrawal() {
    if (!rejectWithdrawalModal || !rejectWithdrawalReason.trim()) return
    setWithdrawalActionLoading(rejectWithdrawalModal.id)
    try {
      const res = await authFetch(`/api/admin/ibyc/withdrawals/${rejectWithdrawalModal.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectWithdrawalReason }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? "Error", "error"); return }
      showToast("Retiro rechazado — fondos devueltos al usuario", "success")
      setRejectWithdrawalModal(null)
      setRejectWithdrawalReason("")
      fetchIbyWithdrawals()
    } finally { setWithdrawalActionLoading(null) }
  }

  const WITHDRAWAL_STATUS_FILTERS = [
    { value: "pending", label: "Pendiente" },
    { value: "processing", label: "En proceso" },
    { value: "completed", label: "Completado" },
    { value: "rejected", label: "Rechazado" },
    { value: "all", label: "Todos" },
  ]

  // ── Legacy: Solicitudes (old iby system) ──────────────────────────────────

  const [requests, setRequests] = useState<DepositRequest[]>([])
  const [requestsFilter, setRequestsFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending")
  const [loadingRequests, setLoadingRequests] = useState(false)
  const [legacyActionLoading, setLegacyActionLoading] = useState<string | null>(null)
  const [rejectLegacyModal, setRejectLegacyModal] = useState<{ id: string; amount: number } | null>(null)
  const [rejectLegacyReason, setRejectLegacyReason] = useState("")
  const [editCoins, setEditCoins] = useState<Record<string, string>>({})

  async function fetchRequests() {
    setLoadingRequests(true)
    try {
      const res = await authFetch(`/api/admin/iby/deposit-requests?status=${requestsFilter}`)
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error al cargar solicitudes", "error"); return }
      setRequests(data.requests || [])
      const initial: Record<string, string> = {}
      for (const r of data.requests || []) {
        initial[r.id] = r.iby_coins != null ? String(r.iby_coins) : String(r.amount)
      }
      setEditCoins(initial)
    } catch {
      showToast("Error de conexión", "error")
    } finally {
      setLoadingRequests(false)
    }
  }

  useEffect(() => { if (tab === "legacy_requests") fetchRequests() }, [tab, requestsFilter])

  async function handleLegacyApprove(req: DepositRequest) {
    setLegacyActionLoading(req.id)
    try {
      const coins = Number(editCoins[req.id])
      if (!coins || coins <= 0) { showToast("iBYC inválidos", "error"); return }
      const res = await authFetch(`/api/admin/iby/deposit-requests/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", iby_coins: coins }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error", "error"); return }
      showToast(`Aprobada — ${coins} iBYC acreditados a ${req.profile?.nickname || req.profile?.email}`, "success")
      fetchRequests()
    } finally {
      setLegacyActionLoading(null)
    }
  }

  async function handleLegacyReject() {
    if (!rejectLegacyModal) return
    if (!rejectLegacyReason.trim()) { showToast("Ingresá un motivo", "error"); return }
    setLegacyActionLoading(rejectLegacyModal.id)
    try {
      const res = await authFetch(`/api/admin/iby/deposit-requests/${rejectLegacyModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", rejection_reason: rejectLegacyReason }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error", "error"); return }
      showToast("Solicitud rechazada", "success")
      setRejectLegacyModal(null)
      setRejectLegacyReason("")
      fetchRequests()
    } finally {
      setLegacyActionLoading(null)
    }
  }

  // ── Cuentas ────────────────────────────────────────────────────────────────

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

  // ─── Render ────────────────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string }[] = [
    { id: "iby_deposits",    label: "iBYC Depósitos" },
    { id: "iby_withdrawals", label: "iBYC Retiros" },
    { id: "legacy_requests", label: "Solicitudes" },
    { id: "accounts",        label: "Cuentas" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Coins className="h-7 w-7 text-primary" />
            Recargas iBYC
          </h1>
          <p className="text-muted-foreground">Depósitos, retiros y cuentas de pago</p>
        </div>
        {(tab === "iby_deposits" || tab === "iby_withdrawals") && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRateOverrideModal(true)}>
              Tasa manual
            </Button>
            <Button variant="outline" size="sm"
              onClick={() => tab === "iby_deposits" ? fetchIbyDeposits() : fetchIbyWithdrawals()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: iBYC Depósitos ── */}
      {tab === "iby_deposits" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {DEPOSIT_STATUS_FILTERS.map(f => (
              <button key={f.value} onClick={() => setIbyDepositFilter(f.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${ibyDepositFilter === f.value ? "bg-primary text-primary-foreground" : "bg-muted/20 hover:bg-muted/40"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {ibyDepositLoading ? (
            <p className="text-center py-12 text-muted-foreground text-sm">Cargando...</p>
          ) : ibyDeposits.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">No hay depósitos con este estado.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {ibyDeposits.map(d => {
                const cfg = CURRENCY_MAP[d.currency]
                const wa = waLink(d.contact_whatsapp ?? d.user?.phone_whatsapp)
                const canApprove = d.status === "proof_submitted"
                const canReject = ["pending", "proof_submitted"].includes(d.status)
                return (
                  <Card key={d.id} className={`border ${d.status === "proof_submitted" ? "border-primary/30" : "border-border"}`}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex flex-wrap gap-4 items-start justify-between">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{d.user?.nickname ?? d.user?.email}</span>
                            <Badge variant={DEPOSIT_STATUS_COLORS[d.status] as any}>{DEPOSIT_STATUS_LABELS[d.status]}</Badge>
                            {d.rate_tier === "parallel" && (
                              <span className="text-[10px] font-bold text-yellow-500 bg-yellow-500/10 rounded px-1.5 py-0.5">PARALELA</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{d.user?.email} · {fmtDate(d.created_at)}</p>
                          <div className="flex items-center gap-4 mt-2 flex-wrap">
                            <div>
                              <p className="text-xs text-muted-foreground">Monto</p>
                              <p className="font-bold">{Number(d.amount_local).toLocaleString()} {cfg?.symbol ?? d.currency}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Tasa</p>
                              <p className="text-sm">1 USD = {Number(d.rate_to_usd).toLocaleString()} <span className="text-muted-foreground text-xs">({d.rate_source})</span></p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">iBYC a acreditar</p>
                              <p className="font-bold text-yellow-400">{Number(d.amount_ibyc).toFixed(4)} iBY</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Método</p>
                              <p className="text-sm">{d.payment_method === "binance" ? "Binance P2P" : "Transferencia"}</p>
                            </div>
                            {d.proof_reference && (
                              <div>
                                <p className="text-xs text-muted-foreground">N° Referencia</p>
                                <p className="font-mono text-sm font-semibold">{d.proof_reference}</p>
                              </div>
                            )}
                          </div>
                          {d.failed_reason && (
                            <p className="text-xs text-red-400 mt-1">Motivo de rechazo: {d.failed_reason}</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-all">
                              <MessageCircle className="h-3.5 w-3.5" />
                              WhatsApp
                            </a>
                          )}
                          {canApprove && (
                            <Button size="sm" className="h-8 text-xs" onClick={() => approveIbyDeposit(d.id)} disabled={depositActionLoading === d.id}>
                              <Check className="h-3.5 w-3.5 mr-1" />
                              {depositActionLoading === d.id ? "..." : "Aprobar"}
                            </Button>
                          )}
                          {canReject && (
                            <Button size="sm" variant="outline" className="h-8 text-xs border-red-500/40 hover:bg-red-500/10 text-red-400"
                              onClick={() => { setRejectDepositModal({ id: d.id }); setRejectDepositReason("") }}>
                              <X className="h-3.5 w-3.5 mr-1" />
                              Rechazar
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: iBYC Retiros ── */}
      {tab === "iby_withdrawals" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {WITHDRAWAL_STATUS_FILTERS.map(f => (
              <button key={f.value} onClick={() => setIbyWithdrawalFilter(f.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${ibyWithdrawalFilter === f.value ? "bg-primary text-primary-foreground" : "bg-muted/20 hover:bg-muted/40"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {ibyWithdrawalLoading ? (
            <p className="text-center py-12 text-muted-foreground text-sm">Cargando...</p>
          ) : ibyWithdrawals.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">No hay retiros con este estado.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {ibyWithdrawals.map(w => {
                const cfg = CURRENCY_MAP[w.currency]
                const wa = waLink(w.contact_whatsapp ?? w.user?.phone_whatsapp)
                const canComplete = ["pending", "processing"].includes(w.status)
                const canReject = ["pending", "processing"].includes(w.status)
                return (
                  <Card key={w.id} className={`border ${w.status === "pending" ? "border-orange-500/30" : "border-border"}`}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex flex-wrap gap-4 items-start justify-between">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{w.user?.nickname ?? w.user?.email}</span>
                            <Badge variant={WITHDRAWAL_STATUS_COLORS[w.status] as any}>{WITHDRAWAL_STATUS_LABELS[w.status]}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{w.user?.email} · {fmtDate(w.created_at)}</p>
                          <div className="flex items-center gap-4 mt-2 flex-wrap">
                            <div>
                              <p className="text-xs text-muted-foreground">iBYC solicitado</p>
                              <p className="font-bold">{Number(w.amount_ibyc_requested).toFixed(4)} iBY</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Fee (6%)</p>
                              <p className="text-sm text-red-400">−{Number(w.fee_ibyc).toFixed(4)} iBY</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">A enviar</p>
                              <p className="font-bold text-yellow-400">
                                {Number(w.amount_local).toLocaleString(undefined, { maximumFractionDigits: 2 })} {cfg?.symbol ?? w.currency}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Tasa</p>
                              <p className="text-sm">1 USD = {Number(w.rate_to_usd).toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Método</p>
                              <p className="text-sm">{w.payment_method === "binance" ? "Binance P2P" : "Transferencia"}</p>
                            </div>
                          </div>
                          <div className="mt-2 rounded-lg bg-muted/20 border px-3 py-2 text-sm">
                            <span className="text-xs text-muted-foreground mr-2">Datos de pago:</span>
                            <span className="font-mono">{w.payment_details}</span>
                          </div>
                          {w.rejection_reason && (
                            <p className="text-xs text-red-400 mt-1">Motivo: {w.rejection_reason}</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-all">
                              <MessageCircle className="h-3.5 w-3.5" />
                              WhatsApp
                            </a>
                          )}
                          {canComplete && (
                            <Button size="sm" className="h-8 text-xs" onClick={() => completeWithdrawal(w.id)} disabled={withdrawalActionLoading === w.id}>
                              <Check className="h-3.5 w-3.5 mr-1" />
                              {withdrawalActionLoading === w.id ? "..." : "Marcar pagado"}
                            </Button>
                          )}
                          {canReject && (
                            <Button size="sm" variant="outline" className="h-8 text-xs border-red-500/40 hover:bg-red-500/10 text-red-400"
                              onClick={() => { setRejectWithdrawalModal({ id: w.id }); setRejectWithdrawalReason("") }}>
                              <X className="h-3.5 w-3.5 mr-1" />
                              Rechazar
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Solicitudes (legacy) ── */}
      {tab === "legacy_requests" && (
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
                No hay solicitudes {requestsFilter !== "all" ? LEGACY_STATUS_CONFIG[requestsFilter as keyof typeof LEGACY_STATUS_CONFIG]?.label?.toLowerCase() + "s" : ""}.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {requests.map((req) => {
                const cfg = LEGACY_STATUS_CONFIG[req.status]
                const acc = req.deposit_account
                return (
                  <Card key={req.id} className={req.status === "pending" ? "border-yellow-500/40 bg-yellow-500/5" : ""}>
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-sm">
                            {req.profile?.nickname || req.profile?.email || "Usuario desconocido"}
                            <span className="text-xs text-muted-foreground ml-2">{req.profile?.email}</span>
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

                      <div className="flex flex-wrap items-end gap-4">
                        <div>
                          <div className="text-xs text-muted-foreground">Monto reportado</div>
                          <div className="text-lg font-bold">${Number(req.amount).toFixed(2)}</div>
                        </div>

                        {req.status === "pending" ? (
                          <div className="flex-1 min-w-[140px]">
                            <label className="text-xs text-muted-foreground block mb-1">iBYC a acreditar</label>
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
                            <div className="text-xs text-muted-foreground">iBYC acreditados</div>
                            <div className="text-lg font-bold text-primary">{Number(req.iby_coins).toFixed(2)} iBY</div>
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

                      {req.status === "pending" && (
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" onClick={() => handleLegacyApprove(req)} disabled={legacyActionLoading === req.id}>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Aprobar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-500/40 text-red-500 hover:bg-red-500/10"
                            onClick={() => { setRejectLegacyModal({ id: req.id, amount: req.amount }); setRejectLegacyReason("") }}
                            disabled={legacyActionLoading === req.id}
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

      {/* ── Modal: Rechazar depósito iBYC ── */}
      {rejectDepositModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="h-5 w-5" />
                Rechazar depósito
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">El usuario recibirá una notificación con el motivo.</p>
              <Input value={rejectDepositReason} onChange={e => setRejectDepositReason(e.target.value)} placeholder="Motivo del rechazo..." />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setRejectDepositModal(null)}>Cancelar</Button>
                <Button variant="destructive" className="flex-1" onClick={rejectIbyDeposit}
                  disabled={!rejectDepositReason.trim() || !!depositActionLoading}>
                  Confirmar rechazo
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Modal: Rechazar retiro iBYC ── */}
      {rejectWithdrawalModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="h-5 w-5" />
                Rechazar retiro
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Los fondos serán devueltos al balance iBYC del usuario. Ingresa el motivo:</p>
              <Input value={rejectWithdrawalReason} onChange={e => setRejectWithdrawalReason(e.target.value)} placeholder="Motivo del rechazo..." />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setRejectWithdrawalModal(null)}>Cancelar</Button>
                <Button variant="destructive" className="flex-1" onClick={rejectWithdrawal}
                  disabled={!rejectWithdrawalReason.trim() || !!withdrawalActionLoading}>
                  Confirmar rechazo
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Modal: Rechazar solicitud legacy ── */}
      {rejectLegacyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Rechazar solicitud</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Solicitud por <strong>${Number(rejectLegacyModal.amount).toFixed(2)}</strong>. Indicá el motivo del rechazo.
              </p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Motivo (requerido)</label>
                <Input
                  value={rejectLegacyReason}
                  onChange={(e) => setRejectLegacyReason(e.target.value)}
                  placeholder="Ej: El ID de transacción no coincide con nuestros registros"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setRejectLegacyModal(null); setRejectLegacyReason("") }}>
                  Cancelar
                </Button>
                <Button variant="destructive" className="flex-1" onClick={handleLegacyReject} disabled={legacyActionLoading !== null}>
                  {legacyActionLoading ? "Procesando..." : "Confirmar rechazo"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Modal: Tasa manual ── */}
      {rateOverrideModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <Card className="w-full max-w-sm mx-4">
            <CardHeader><CardTitle>Tasa manual (override 4h)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Moneda</label>
                <select value={overrideCurrency} onChange={e => setOverrideCurrency(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
                  {Object.values(CURRENCY_MAP).filter(c => c.code !== "USD").map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">1 USD = ? {overrideCurrency}</label>
                <Input type="number" step="any" value={overrideRate} onChange={e => setOverrideRate(e.target.value)} placeholder="Ej: 37.50" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setRateOverrideModal(false)}>Cancelar</Button>
                <Button className="flex-1" onClick={handleRateOverride} disabled={!overrideRate}>Aplicar</Button>
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
