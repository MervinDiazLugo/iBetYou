"use client"

import { useEffect, useState } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"

interface Props {
  className?: string
}

export function IbycBalanceBadge({ className }: Props) {
  const [balance, setBalance] = useState<number | null>(null)
  const supabase = createBrowserSupabaseClient()

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      const res = await fetch("/api/ibyc/balance", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return
      const { balance_ibyc } = await res.json()
      setBalance(Number(balance_ibyc))
    }
    load()
  }, [supabase])

  if (balance === null) return null

  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-yellow-400 ${className ?? ""}`}>
      <span className="text-xs opacity-70">iBYC</span>
      {balance.toFixed(2)}
    </span>
  )
}
