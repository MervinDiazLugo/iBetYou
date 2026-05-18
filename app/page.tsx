"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { LandingPage } from "@/components/landing-page"
import { Marketplace } from "@/components/marketplace"
import type { Session } from "@supabase/supabase-js"

function HomeContent() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const searchParams = useSearchParams()
  const refCode = searchParams.get("ref")

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div className="min-h-screen bg-gray-950" />
  }

  if (!session) {
    return <LandingPage refCode={refCode} />
  }

  return <Marketplace />
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <HomeContent />
    </Suspense>
  )
}
