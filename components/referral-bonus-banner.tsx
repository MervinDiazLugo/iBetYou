"use client"

import { useState, useEffect } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import Link from "next/link"

export function ReferralBonusBanner() {
  const [lockedAmount, setLockedAmount] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ current: number; required: number } | null>(null)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch("/api/referrals/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return
      const data = await res.json()

      const { data: wallet } = await supabase
        .from("wallets")
        .select("referral_bonus_locked")
        .eq("user_id", session.user.id)
        .single()

      if (wallet && wallet.referral_bonus_locked > 0) {
        setLockedAmount(wallet.referral_bonus_locked)
      }

      if (data.my_bonus && data.my_bonus.status === "locked") {
        setProgress({
          current: data.my_bonus.wagering_progress,
          required: data.my_bonus.wagering_required,
        })
      }
    }

    load()
  }, [])

  if (!lockedAmount || lockedAmount <= 0) return null

  const progressPct = progress
    ? Math.min(100, (progress.current / progress.required) * 100)
    : 0
  const remaining = progress ? Math.max(0, progress.required - progress.current) : null

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="text-amber-400 font-semibold text-sm">
            {lockedAmount} fichas de referido bloqueadas
          </p>
          {remaining !== null && (
            <p className="text-gray-400 text-xs mt-0.5">
              Predice {remaining.toFixed(0)} fichas más para desbloquearlas
            </p>
          )}
        </div>
        <Link
          href="/my-referrals"
          className="text-amber-400 text-xs underline hover:text-amber-300"
        >
          Ver detalles
        </Link>
      </div>
      {progress && (
        <div className="w-full bg-gray-700 rounded-full h-1.5">
          <div
            className="bg-amber-500 h-1.5 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  )
}
