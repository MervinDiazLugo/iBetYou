"use client"

import { useState, useEffect } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { Navbar } from "@/components/navbar"

interface ReferralMetrics {
  total_referral_bonuses: number
  bonuses_locked: number
  bonuses_unlocked: number
  total_locked_tokens: number
  top_referrers: Array<{ id: string; nickname: string; referral_count: number }>
}

export default function BackofficeReferralsPage() {
  const [metrics, setMetrics] = useState<ReferralMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const res = await fetch("/api/admin/referrals", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) setMetrics(await res.json())
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="min-h-screen bg-gray-950 text-gray-400 p-8">Cargando...</div>
  if (!metrics) return <div className="min-h-screen bg-gray-950 text-red-400 p-8">Error al cargar métricas</div>

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8 space-y-6">
      <h1 className="text-2xl font-bold">Referidos — Métricas</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Bonos totales", value: metrics.total_referral_bonuses },
          { label: "Bloqueados", value: metrics.bonuses_locked },
          { label: "Desbloqueados", value: metrics.bonuses_unlocked },
          { label: "Fichas bloqueadas", value: metrics.total_locked_tokens.toFixed(0) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-gray-400 text-xs mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h2 className="text-base font-semibold mb-3">Top Referidores</h2>
        {metrics.top_referrers.length === 0 ? (
          <p className="text-gray-500 text-sm">Sin referidos aún</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs border-b border-gray-700">
                <th className="text-left pb-2">Usuario</th>
                <th className="text-right pb-2">Referidos</th>
              </tr>
            </thead>
            <tbody>
              {metrics.top_referrers.map((r) => (
                <tr key={r.id} className="border-b border-gray-800 last:border-0">
                  <td className="py-2 text-white">{r.nickname ?? r.id}</td>
                  <td className="py-2 text-right text-amber-400 font-semibold">{r.referral_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
