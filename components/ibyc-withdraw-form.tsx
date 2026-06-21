"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/toast"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { SUPPORTED_CURRENCIES, PAYMENT_METHOD_LABELS, WITHDRAWAL_FEE_RATE, type PaymentMethod, getCurrency } from "@/lib/ibyc/config"

export function IbycWithdrawForm({ onSuccess }: { onSuccess?: () => void }) {
  const supabase = createBrowserSupabaseClient()
  const { showToast } = useToast()

  const [currency, setCurrency] = useState("VES")
  const [amountIbyc, setAmountIbyc] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("binance")
  const [paymentDetails, setPaymentDetails] = useState("")
  const [whatsapp, setWhatsapp] = useState("")
  const [balance, setBalance] = useState<number | null>(null)
  const [rate, setRate] = useState<{ rateToUsd: number; source: string; tier: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const cfg = getCurrency(currency)
  const amount = parseFloat(amountIbyc) || 0
  const feeIbyc = parseFloat((amount * WITHDRAWAL_FEE_RATE).toFixed(8))
  const netIbyc = Math.max(0, amount - feeIbyc)
  const amountLocal = rate && currency !== "USD" ? netIbyc * rate.rateToUsd : netIbyc

  useEffect(() => {
    async function loadBalance() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      const res = await fetch("/api/ibyc/balance", { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) { const { balance_ibyc } = await res.json(); setBalance(Number(balance_ibyc)) }
    }
    loadBalance()
  }, [supabase])

  const fetchRate = useCallback(async () => {
    if (currency === "USD") { setRate({ rateToUsd: 1, source: "direct", tier: "official" }); return }
    try {
      const res = await fetch(`/api/ibyc/rate?currency=${currency}`)
      if (res.ok) setRate(await res.json())
    } catch {}
  }, [currency])

  useEffect(() => { fetchRate() }, [fetchRate])

  async function handleSubmit() {
    if (!amount || amount <= 0) { showToast("Monto inválido", "error"); return }
    if (balance !== null && amount > balance) { showToast("Saldo iBYC insuficiente", "error"); return }
    if (!paymentDetails.trim()) { showToast("Ingresa tus datos de pago", "error"); return }

    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: HeadersInit = { "Content-Type": "application/json" }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`

      const res = await fetch("/api/ibyc/withdraw", {
        method: "POST",
        headers,
        body: JSON.stringify({ currency, amount_ibyc: amount, payment_method: paymentMethod, payment_details: paymentDetails, contact_whatsapp: whatsapp || null }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? "Error procesando retiro", "error"); return }
      setDone(true)
      if (balance !== null) setBalance(data.new_balance)
      onSuccess?.()
    } finally {
      setLoading(false)
    }
  }

  if (done) return (
    <div className="text-center space-y-4 py-4">
      <div className="text-4xl">✅</div>
      <p className="font-semibold">Retiro solicitado</p>
      <p className="text-sm text-muted-foreground">Tu solicitud está siendo procesada. Recibirás una notificación cuando el pago sea enviado.</p>
      <Button variant="outline" className="w-full" onClick={() => { setDone(false); setAmountIbyc(""); setPaymentDetails("") }}>
        Nuevo retiro
      </Button>
    </div>
  )

  return (
    <div className="space-y-5">
      {balance !== null && (
        <div className="rounded-xl bg-muted/20 border px-4 py-3 flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Saldo disponible</span>
          <span className="font-bold text-yellow-400">{balance.toFixed(2)} iBYC</span>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Moneda de destino</label>
        <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
          {SUPPORTED_CURRENCIES.map(c => (
            <option key={c.code} value={c.code}>{c.flag} {c.name} ({c.code})</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Monto a retirar (iBYC)</label>
        <Input type="number" min={1} step="any" value={amountIbyc} onChange={e => setAmountIbyc(e.target.value)} placeholder="0.00" />
        {balance !== null && amount > 0 && (
          <button type="button" className="text-xs text-primary underline" onClick={() => setAmountIbyc(balance.toString())}>
            Usar todo el saldo
          </button>
        )}
      </div>

      {/* Fee breakdown */}
      {amount > 0 && rate && (
        <div className="rounded-xl border bg-muted/10 p-4 space-y-2 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Monto solicitado</span>
            <span>{amount.toFixed(4)} iBYC</span>
          </div>
          <div className="flex justify-between text-red-400">
            <span>Fee ({(WITHDRAWAL_FEE_RATE * 100).toFixed(0)}%)</span>
            <span>−{feeIbyc.toFixed(4)} iBYC</span>
          </div>
          <div className="flex justify-between font-semibold border-t border-border/40 pt-2">
            <span>Recibirás</span>
            <span className="text-yellow-400">
              {currency !== "USD"
                ? `${amountLocal.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${cfg?.symbol}`
                : `${netIbyc.toFixed(4)} iBYC`}
            </span>
          </div>
          {rate.tier === "parallel" && (
            <p className="text-[10px] text-yellow-500">Tasa paralela · 1 USD = {rate.rateToUsd.toLocaleString()} {cfg?.symbol} · fuente: {rate.source}</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Método de pago</label>
        <div className="grid grid-cols-2 gap-2">
          {(["binance", "bank_transfer"] as PaymentMethod[]).map(m => (
            <button key={m} type="button" onClick={() => setPaymentMethod(m)}
              className={`rounded-lg border-2 py-2.5 text-sm font-medium transition-all ${paymentMethod === m ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
              {PAYMENT_METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">
          {paymentMethod === "binance" ? "ID de Binance o email" : "Datos bancarios"}
        </label>
        <Input value={paymentDetails} onChange={e => setPaymentDetails(e.target.value)}
          placeholder={paymentMethod === "binance" ? "Tu Binance ID o email" : "Banco · N° cuenta · Titular"} />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">WhatsApp <span className="text-muted-foreground font-normal">(opcional)</span></label>
        <Input type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+58 4XX XXX XXXX" />
      </div>

      <Button className="w-full" onClick={handleSubmit} disabled={loading || !amount || !paymentDetails.trim()}>
        {loading ? "Procesando..." : "Solicitar retiro"}
      </Button>
    </div>
  )
}
