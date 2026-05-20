"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/components/providers"
import { createBrowserSupabaseClient } from "@/lib/supabase"

export function useCountryAccess() {
  const { user } = useAuth()
  const [canUseRealMoney, setCanUseRealMoney] = useState<boolean | null>(null)

  useEffect(() => {
    if (!user) { setCanUseRealMoney(false); return }

    const supabase = createBrowserSupabaseClient()
    async function check() {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: HeadersInit = {}
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      const res = await fetch("/api/user/access", { headers }).catch(() => null)
      if (res?.ok) {
        const d = await res.json()
        setCanUseRealMoney(d.canUseRealMoney === true)
      } else {
        setCanUseRealMoney(false)
      }
    }
    check()
  }, [user?.id])

  return { canUseRealMoney }
}
