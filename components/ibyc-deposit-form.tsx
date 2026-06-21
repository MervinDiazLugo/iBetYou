"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/toast"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { SUPPORTED_CURRENCIES, PAYMENT_METHOD_LABELS, type PaymentMethod, getCurrency } from "@/lib/ibyc/config"

type Step = "amount" | "payment" | "proof" | "done"

export function IbycDepositForm({ onSuccess }: { onSuccess?: () => void }) {
  const supabase = createBrowserSupabaseClient()
  const { showToast } = useToast()

  const [step, setStep] = useState<Step>("amount")
  const [currency, setCurrency] = useState("VES")
  const [amountLocal, setAmountLocal] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("binance")
  const [whatsapp, setWhatsapp] = useState("")
  const [rate, setRate] = useState<{ rateToUsd: number; source: string; tier: string; isCached: boolean; fetchedAt: string } | null>(null)
  const [rateLoading, setRateLoading] = useState(false)
  const [rateError, setRateError] = useState<string | null>(null)
  const [depositId, setDepositId] = useState<string | null>(null)
  const [paymentInstructions, setPaymentInstructions] = useState<string>("")
  const [proofReference, setProofReference] = useState("")
  const [loading, setLoading] = useState(false)

  const cfg = getCurrency(currency)
  const amountNum = parseFloat(amountLocal) || 0
  const amountIbyc = rate && currency !== "USD" ? amountNum / rate.rateToUsd : amountNum

  const fetchRate = useCallback(async () => {
    if (!currency || currency === "USD") {
      setRate({ rateToUsd: 1, source: "direct", tier: "official", isCached: false, fetchedAt: new Date().toISOString() })
      return
    }
    setRateLoading(true)
    setRateError(null)
    try {
      const res = await fetch(`/api/ibyc/rate?currency=${currency}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRate(data)
    } catch (err: any) {
      setRateError(err.message ?? "Error obteniendo tasa")
      setRate(null)
    } finally {
      setRateLoading(false)
    }
  }, [currency])

  useEffect(() => { fetchRate() }, [fetchRate])

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" }
  }

  async function handleCreateDeposit() {
    if (!amountNum || amountNum <= 0) { showToast("Ingresa un monto válido", "error"); return }
    if (!rate) { showToast("Tasa no disponible", "error"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/ibyc/deposit", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ currency, amount_local: amountNum, payment_method: paymentMethod, contact_whatsapp: whatsapp || null }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? "Error creando depósito", "error"); return }
      setDepositId(data.deposit.id)
      setPaymentInstructions(data.payment_instructions)
      setStep("payment")
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitProof() {
    if (!proofReference.trim()) { showToast("Ingresa el número de referencia", "error"); return }
    if (!depositId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/ibyc/deposit/${depositId}/submit-proof`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ proof_reference: proofReference }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? "Error enviando referencia", "error"); return }
      setStep("done")
      onSuccess?.()
    } finally {
      setLoading(false)
    }
  }

  const rateAge = rate ? Math.round((Date.now() - new Date(rate.fetchedAt).getTime()) / 60000) : 0

  return (
    <div className="space-y-5">
      {/* STEP: amount */}
      {step === "amount" && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Moneda</label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
            >
              {SUPPORTED_CURRENCIES.map(c => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Monto a depositar ({cfg?.symbol ?? currency})</label>
            <Input
              type="number"
              min={cfg?.minDepositLocal ?? 1}
              step="any"
              value={amountLocal}
              onChange={e => setAmountLocal(e.target.value)}
              placeholder={`Mín. ${cfg?.minDepositLocal} ${cfg?.symbol}`}
            />
          </div>

          {/* Rate preview */}
          <div className="rounded-xl border bg-muted/10 p-4 space-y-2 text-sm">
            {rateLoading && <p className="text-muted-foreground text-xs">Obteniendo tasa...</p>}
            {rateError && <p className="text-red-400 text-xs">{rateError} · <button onClick={fetchRate} className="underline">Reintentar</button></p>}
            {rate && !rateLoading && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tasa</span>
                  <span className="font-semibold">
                    1 USD = {currency !== "USD" ? `${rate.rateToUsd.toLocaleString()} ${cfg?.symbol}` : "1 iBYC"}
                    {rate.tier === "parallel" && <span className="ml-1 text-[10px] text-yellow-500 font-bold uppercase">[PARALELA]</span>}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fuente</span>
                  <span className="text-xs text-muted-foreground">{rate.source} · hace {rateAge} min{rate.isCached ? " (caché)" : ""}</span>
                </div>
                {amountNum > 0 && (
                  <div className="flex justify-between border-t border-border/40 pt-2 mt-2">
                    <span className="font-medium">Recibirás</span>
                    <span className="font-bold text-yellow-400">{amountIbyc > 0 ? amountIbyc.toFixed(4) : "—"} iBYC</span>
                  </div>
                )}
              </>
            )}
          </div>

          {cfg?.legalNote && (
            <p className="text-[11px] text-yellow-600 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
              ⚠️ {cfg.legalNote}
            </p>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Método de pago</label>
            <div className="grid grid-cols-2 gap-2">
              {(["binance", "bank_transfer"] as PaymentMethod[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`rounded-lg border-2 py-2.5 text-sm font-medium transition-all ${
                    paymentMethod === m ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  {PAYMENT_METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">WhatsApp de contacto <span className="text-muted-foreground font-normal">(opcional)</span></label>
            <Input
              type="tel"
              value={whatsapp}
              onChange={e => setWhatsapp(e.target.value)}
              placeholder="+58 4XX XXX XXXX"
            />
            <p className="text-[11px] text-muted-foreground">El equipo puede contactarte si hay algún problema con el depósito.</p>
          </div>

          <Button
            className="w-full"
            onClick={handleCreateDeposit}
            disabled={loading || !rate || !amountNum || amountNum <= 0}
          >
            {loading ? "Procesando..." : "Continuar"}
          </Button>
        </>
      )}

      {/* STEP: payment instructions */}
      {step === "payment" && (
        <>
          <div className="rounded-xl border bg-muted/10 p-4 space-y-3">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide text-xs">Instrucciones de pago</p>
            <p className="text-sm whitespace-pre-wrap">{paymentInstructions}</p>
            <div className="border-t border-border/40 pt-3 space-y-1">
              <p className="text-xs text-muted-foreground">Monto a transferir:</p>
              <p className="font-bold text-lg">{amountNum.toLocaleString()} {cfg?.symbol}</p>
            </div>
            <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 text-xs text-primary">
              En el concepto/referencia de la transferencia indica tu email o usuario de iBetYou.
            </div>
          </div>

          <p className="text-sm text-muted-foreground">Una vez realizado el pago, ingresa el número de referencia o ID de transacción de Binance:</p>

          <div className="space-y-2">
            <label className="text-sm font-medium">N° de referencia / ID transacción</label>
            <Input
              value={proofReference}
              onChange={e => setProofReference(e.target.value)}
              placeholder="Ej: 123456789 o TXN-ABC123"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setStep("amount")}>Atrás</Button>
            <Button className="flex-1" onClick={handleSubmitProof} disabled={loading || !proofReference.trim()}>
              {loading ? "Enviando..." : "Enviar referencia"}
            </Button>
          </div>
        </>
      )}

      {/* STEP: done */}
      {step === "done" && (
        <div className="text-center space-y-4 py-4">
          <div className="text-4xl">✅</div>
          <p className="font-semibold">Referencia enviada</p>
          <p className="text-sm text-muted-foreground">
            Tu depósito está en revisión. Recibirás una notificación cuando sea confirmado por el equipo (generalmente en menos de 1 hora).
          </p>
          <Button variant="outline" className="w-full" onClick={() => { setStep("amount"); setAmountLocal(""); setProofReference(""); setDepositId(null) }}>
            Hacer otro depósito
          </Button>
        </div>
      )}
    </div>
  )
}
