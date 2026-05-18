"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ReferralShare } from "@/components/referral-share"
import type { ReferralStats } from "@/types"

export default function MyReferralsPage() {
  const router = useRouter()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.push("/login")
        return
      }

      const res = await fetch("/api/referrals/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
      setLoading(false)
    }

    load()
  }, [router])

  const bonusStatusLabel: Record<string, string> = {
    locked: "Apostando",
    unlocked: "Desbloqueado",
    claimed: "Reclamado",
  }

  const bonusStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    locked: "secondary",
    unlocked: "default",
    claimed: "outline",
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center text-gray-400">
          Cargando...
        </div>
      </div>
    )
  }

  if (!stats) return null

  const totalUnlocked = stats.referrals.filter((r) => r.bonus_status === "unlocked").length

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold">Mis Referidos</h1>

        {/* Share section */}
        <Card className="bg-gray-900 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white text-base">Comparte tu enlace</CardTitle>
          </CardHeader>
          <CardContent>
            <ReferralShare shareUrl={stats.share_url} whatsappUrl={stats.whatsapp_url} />
          </CardContent>
        </Card>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-gray-900 border-gray-700 text-center p-4">
            <div className="text-3xl font-bold text-white">{stats.referral_count}</div>
            <div className="text-gray-400 text-xs mt-1">Registrados</div>
          </Card>
          <Card className="bg-gray-900 border-gray-700 text-center p-4">
            <div className="text-3xl font-bold text-amber-400">
              {stats.referrals.filter((r) => r.bonus_status === "locked").length}
            </div>
            <div className="text-gray-400 text-xs mt-1">Bonos activos</div>
          </Card>
          <Card className="bg-gray-900 border-gray-700 text-center p-4">
            <div className="text-3xl font-bold text-green-400">{totalUnlocked * 50}</div>
            <div className="text-gray-400 text-xs mt-1">Fichas desbloqueadas</div>
          </Card>
        </div>

        {/* My own referral bonus (if I was referred) */}
        {stats.my_bonus && (
          <Card className="bg-gray-900 border-amber-500/30">
            <CardHeader>
              <CardTitle className="text-white text-base">Tu bono de registro</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-300 text-sm">50 fichas bloqueadas</span>
                <Badge variant={bonusStatusVariant[stats.my_bonus.status]}>
                  {bonusStatusLabel[stats.my_bonus.status]}
                </Badge>
              </div>
              {stats.my_bonus.status === "locked" && (
                <>
                  <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                    <div
                      className="bg-amber-500 h-2 rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (stats.my_bonus.wagering_progress / stats.my_bonus.wagering_required) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-gray-400 text-xs">
                    {stats.my_bonus.wagering_progress.toFixed(0)} /{" "}
                    {stats.my_bonus.wagering_required.toFixed(0)} fichas apostadas
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Referrals table */}
        <Card className="bg-gray-900 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white text-base">
              Referidos ({stats.referrals.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.referrals.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">
                Aún no tienes referidos. ¡Comparte tu enlace!
              </p>
            ) : (
              <div className="space-y-3">
                {stats.referrals.map((r) => (
                  <div
                    key={r.referee_id}
                    className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
                  >
                    <div>
                      <p className="text-white text-sm font-medium">{r.nickname}</p>
                      <p className="text-gray-500 text-xs">
                        {new Date(r.created_at).toLocaleDateString("es-ES", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant={bonusStatusVariant[r.bonus_status]}>
                        {bonusStatusLabel[r.bonus_status]}
                      </Badge>
                      {r.bonus_status === "locked" && (
                        <p className="text-gray-500 text-xs mt-1">
                          {r.wagering_progress.toFixed(0)}/{r.wagering_required.toFixed(0)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
