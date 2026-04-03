import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"

interface BetWithDetails {
  id: string
  event_id: number
  creator_id: string
  acceptor_id: string | null
  type: string
  bet_type: string
  selection: string
  amount: number
  multiplier: number
  fee_amount: number
  creator_selection: string
  acceptor_selection: string | null
  status: string
  created_at: string
  event: {
    home_team: string
    away_team: string
    start_time: string
    league: string
    sport: string
    metadata?: {
      venue?: {
        name?: string | null
        city?: string | null
      }
    }
  }
  creator: {
    nickname: string
  }
  acceptor?: {
    nickname: string
  }
  decision_history?: {
    id: string
    action: string
    reason?: string | null
    created_at: string
  }[]
}

export function useMyBets() {
  const router = useRouter()
  const { showToast } = useToast()
  
  const [user, setUser] = useState<{ id: string; email: string; nickname: string } | null>(null)
  const [balance, setBalance] = useState<{ fantasy: number; real: number }>({ fantasy: 0, real: 0 })
  const [bets, setBets] = useState<BetWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      try {
        // Check auth
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser()

        if (!authUser) {
          if (isMounted) router.push("/login")
          return
        }

        const {
          data: { session },
        } = await supabase.auth.getSession()

        const authHeaders: HeadersInit = {}

        if (session?.access_token) {
          authHeaders.Authorization = `Bearer ${session.access_token}`
        }

        const walletRes = await fetch(`/api/wallet?user_id=${authUser.id}`, {
          headers: authHeaders
        })

        if (walletRes.ok && isMounted) {
          const walletData = await walletRes.json()
          const nickname = walletData.user?.nickname || authUser.email?.split('@')[0] || 'Usuario'
          setUser({ id: authUser.id, email: authUser.email!, nickname })
          if (walletData.wallet) {
            setBalance({
              fantasy: walletData.wallet.balance_fantasy,
              real: walletData.wallet.balance_real,
            })
          }
        }

        // Load user's bets via API
        const res = await fetch(`/api/my-bets?user_id=${authUser.id}`, {
          headers: authHeaders
        })

        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || 'Error fetching bets')
        }

        const data = await res.json()
        if (isMounted) {
          setBets(data.bets || [])
          setLoading(false)
        }
      } catch (err: any) {
        console.error('Error in useMyBets:', err)
        if (isMounted) {
          setError(err.message || 'Error loading data')
          setLoading(false)
        }
      }
    }

    const supabase = createBrowserSupabaseClient()
    loadData()

    return () => {
      isMounted = false
    }
  }, [router])

  return { user, balance, bets, loading, error }
}