"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/components/providers"
import { createBrowserSupabaseClient } from "@/lib/supabase"

// null = still loading, true/false = resolved
export function useCountryAccess() {
  const { user, loading: authLoading } = useAuth()
  const [canUseRealMoney, setCanUseRealMoney] = useState<boolean | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) { setCanUseRealMoney(false); return }

    const supabase = createBrowserSupabaseClient()
    async function check() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) { setCanUseRealMoney(false); return }
        const res = await fetch("/api/user/access", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) {
          const d = await res.json()
          setCanUseRealMoney(d.canUseRealMoney === true)
        } else {
          setCanUseRealMoney(false)
        }
      } catch {
        setCanUseRealMoney(false)
      }
    }
    check()
  }, [user?.id, authLoading])

  // While auth is still loading, return null (unknown)
  // Once resolved: true (allowed) or false (blocked)
  return { canUseRealMoney }
}
