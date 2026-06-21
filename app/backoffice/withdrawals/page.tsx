"use client"

import { useState, useEffect, useCallback } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/toast"

interface WithdrawalRequest {
  id: string
  amount: number
  fee_amount: number
  net_amount: number
  status: string
  rejection_type: string | null
  rejection_reason: string | null
  created_at: string
  method_snapshot: Record<string, unknown> | null
  user: { id: string; nickname: string; email: string; kyc_status: string } | null
}

const TYPE_LABEL: Record<string, string> = {
  binance: "Binance", bank: "Banco", cbu_cvu: "CBU/CVU",
}

const STATUS_TABS = [
  { key: "pending",    label: "Pendientes" },
  { key: "processing", label: "Procesando" },
  { key: "paid",       label: "Pagados" },
  { key: "rejected",   label: "Rechazados" },
]

export default function BackofficeWithdrawalsPage() {
  const { showToast } = useToast()
  const supabase = createBrowserSupabaseClient()

  const [requests, setRequests] = useState<WithdrawalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("pending")
  const [actionDialog, setActionDialog] = useState<{
    req: WithdrawalRequest
    action: "approve" | "complete" | "reject"
  } | null>(null)
  const [rejectForm, setRejectForm] = useState({ type: "refund", reason: "" })

  const authFetch = useCallback(async (input: RequestInfo, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }, [supabase])

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/admin/withdrawals?status=${statusFilter}`)
      if (res.ok) {
        const d = await res.json()
        setRequests(d.requests || [])
      }
    } finally {
      setLoading(false)
    }
  }, [authFetch, statusFilter])

  useEffect(() => { loadRequests() }, [loadRequests])

  async function handleAction() {
    if (!actionDialog) return
    const { req, action } = actionDialog

    const body: Record<string, unknown> = { id: req.id, action }
    if (action === "reject") {
      if (!rejectForm.reason.trim()) { showToast("Motivo requerido", "error"); return }
      body.rejection_type = rejectForm.type
      body.rejection_reason = rejectForm.reason
    }

    const res = await authFetch("/api/admin/withdrawals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.error || "Error", "error"); return }

    showToast("Acción aplicada", "success")
    setActionDialog(null)
    setRejectForm({ type: "refund", reason: "" })
    loadRequests()
  }

  function getSnapDetails(snap: Record<string, unknown>) {
    const details = snap.details as Record<string, unknown> | undefined
    const parts: string[] = []
    if (details?.binance_id) parts.push(`ID: ${details.binance_id}`)
    if (details?.email) parts.push(`${details.email}`)
    if (details?.cbu_cvu) parts.push(`${details.cbu_cvu}`)
    if (details?.account_number) parts.push(`Cta: ${details.account_number}`)
    return parts.join(" · ")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Retiros iBYC</h1>
        <p className="text-muted-foreground text-sm">Gestión de solicitudes de retiro de iBYC Coins.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStatusFilter(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              statusFilter === t.key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Cargando...</p>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            Sin solicitudes en este estado.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const snap = req.method_snapshot || {}
            const typeKey = snap.type as string | undefined
            const snapLabel = snap.label as string | undefined
            const details = getSnapDetails(snap)
            return (
              <Card key={req.id}>
                <CardContent className="pt-4 pb-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{req.user?.nickname || "—"}</p>
                      <p className="text-sm text-muted-foreground">{req.user?.email}</p>
                      {req.user?.kyc_status !== "approved" && (
                        <Badge variant="destructive" className="text-[10px] mt-1">Sin KYC</Badge>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{Number(req.amount).toFixed(2)} iBYC</p>
                      <p className="text-xs text-muted-foreground">
                        Fee: {Number(req.fee_amount).toFixed(2)} · Neto: {Number(req.net_amount).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    {TYPE_LABEL[typeKey || ""] || typeKey || "—"} — {snapLabel || "—"}
                    {details && ` · ${details}`}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {new Date(req.created_at).toLocaleString("es-ES", { timeZone: "UTC" })}
                  </p>

                  {req.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setActionDialog({ req, action: "approve" })}>
                        Aprobar
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setActionDialog({ req, action: "reject" })}>
                        Rechazar
                      </Button>
                    </div>
                  )}
                  {req.status === "processing" && (
                    <div className="flex gap-2">
                      <Button size="sm" className="bg-green-600 hover:bg-green-500" onClick={() => setActionDialog({ req, action: "complete" })}>
                        Marcar como Pagado
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setActionDialog({ req, action: "reject" })}>
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

      {actionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold">
              {actionDialog.action === "approve" && "Aprobar retiro"}
              {actionDialog.action === "complete" && "Marcar como pagado"}
              {actionDialog.action === "reject" && "Rechazar retiro"}
            </h2>

            <p className="text-sm text-muted-foreground">
              {actionDialog.req.user?.nickname} · {Number(actionDialog.req.amount).toFixed(2)} iBYC → {Number(actionDialog.req.net_amount).toFixed(2)} iBYC neto
            </p>

            {actionDialog.action === "reject" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tipo de rechazo</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio" value="refund"
                        checked={rejectForm.type === "refund"}
                        onChange={() => setRejectForm((f) => ({ ...f, type: "refund" }))}
                      />
                      <span className="text-sm">Devolver fondos</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio" value="forfeit"
                        checked={rejectForm.type === "forfeit"}
                        onChange={() => setRejectForm((f) => ({ ...f, type: "forfeit" }))}
                      />
                      <span className="text-sm text-red-400">Retener fondos</span>
                    </label>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Motivo</label>
                  <input
                    className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                    placeholder="Motivo del rechazo..."
                    value={rejectForm.reason}
                    onChange={(e) => setRejectForm((f) => ({ ...f, reason: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { setActionDialog(null); setRejectForm({ type: "refund", reason: "" }) }}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleAction}
                className={actionDialog.action === "reject" ? "bg-destructive hover:bg-destructive/80" : ""}
              >
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
