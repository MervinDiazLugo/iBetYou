"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useRouter } from "next/navigation"

interface AuthContextType {
  user: { id: string; email: string; nickname?: string; role?: string } | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<{ id: string; email: string; nickname?: string; role?: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()

    async function applyUserWithNickname(sessionUser: { id: string; email?: string }) {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const headers: HeadersInit = {}

      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`
      }

      const res = await fetch(`/api/wallet?user_id=${sessionUser.id}`, {
        headers
      })

      if (res.ok) {
        const data = await res.json()
        setUser({
          id: sessionUser.id,
          email: sessionUser.email || "",
          nickname: data.user?.nickname,
          role: data.user?.role,
        })
        return
      }

      setUser({
        id: sessionUser.id,
        email: sessionUser.email || "",
      })
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        applyUserWithNickname({ id: session.user.id, email: session.user.email })
      }
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        applyUserWithNickname({ id: session.user.id, email: session.user.email })
      } else {
        setUser(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [router])

  const signOut = async () => {
    const supabase = createBrowserSupabaseClient()
    await supabase.auth.signOut()
    setUser(null)
    router.push("/login")
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
