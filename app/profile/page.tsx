"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { formatCurrency } from "@/lib/utils"
import { Wallet, User, Trophy, TrendingUp, Shield, LogOut } from "lucide-react"

interface ProfileData {
  nickname: string
  avatar_url: string | null
  kyc_status: string
  created_at: string
}

interface Stats {
  total_bets: number
  won_bets: number
  win_rate: number
  current_streak: number
}

const avatars = [
  "🦁", "🐺", "🦊", "🐯", "🐻",
  "⚽", "🏀", "🎾", "🏈", "⚾",
  "⭐", "🔥", "💎", "🎯", "🚀",
]

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createBrowserSupabaseClient()
  
  const [user, setUser] = useState<{ email: string; nickname: string } | null>(null)
  const [balance, setBalance] = useState<{ fantasy: number; real: number }>({ fantasy: 0, real: 0 })
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [stats, setStats] = useState<Stats>({
    total_bets: 0,
    won_bets: 0,
    win_rate: 0,
    current_streak: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (!authUser) {
        router.push("/login")
        return
      }

      // Get profile and stats from API
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token

        if (token) {
          const res = await fetch("/api/user/profile", {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })

          if (res.ok) {
            const data = await res.json()
            setProfile(data.profile)
            setUser({
              email: authUser.email!,
              nickname: data.profile.nickname,
            })
            setBalance({
              fantasy: data.wallet?.balance_fantasy || 0,
              real: data.wallet?.balance_real || 0,
            })
            setStats(data.stats)
          }
        }
      } catch (err) {
        console.error("Error loading profile:", err)
      }

      setLoading(false)
    }

    loadData()
  }, [router, supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const getLevel = () => {
    const { total_bets, win_rate } = stats
    if (total_bets >= 500 && win_rate >= 70) return { level: "Leyenda", badge: "👑" }
    if (total_bets >= 100 && win_rate >= 60) return { level: "Experto", badge: "🏆" }
    if (total_bets >= 50) return { level: "Competidor", badge: "🥇" }
    if (total_bets >= 10) return { level: "Apostador", badge: "🥈" }
    return { level: "Novato", badge: "🥉" }
  }

  const { level, badge } = getLevel()

  if (!user || !profile) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto px-4 py-6 max-w-2xl">
        {/* Profile Card */}
        <Card className="mb-6">
          <CardHeader className="text-center">
            <div className="text-6xl mb-4">
              {profile.avatar_url || "⭐"}
            </div>
            <CardTitle className="text-2xl">{profile.nickname}</CardTitle>
            <CardDescription>{user.email}</CardDescription>
            <div className="flex justify-center gap-2 mt-2">
              <Badge variant="secondary">
                {badge} {level}
              </Badge>
              <Badge variant={profile.kyc_status === "approved" ? "default" : "outline"}>
                <Shield className="h-3 w-3 mr-1" />
                {profile.kyc_status === "approved" ? "KYC Verificado" : "Sin verificar"}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Wallet Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Billetera
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-secondary rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Fantasy Tokens</p>
                <p className="text-xs text-muted-foreground">
                  Acumulado: {formatCurrency(profile.kyc_status === "approved" ? balance.fantasy : Math.min(balance.fantasy, 1000))}
                </p>
              </div>
              <p className="text-2xl font-bold text-primary">
                {formatCurrency(balance.fantasy)}
              </p>
            </div>
            <div className="flex justify-between items-center p-3 bg-secondary rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Tokens Reales (USDT)</p>
              </div>
              <p className="text-2xl font-bold">
                {formatCurrency(balance.real)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Stats Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Estadísticas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 bg-secondary rounded-lg">
                <p className="text-3xl font-bold">{stats.total_bets}</p>
                <p className="text-sm text-muted-foreground">Apuestas jugadas</p>
              </div>
              <div className="text-center p-4 bg-secondary rounded-lg">
                <p className="text-3xl font-bold text-green-500">{stats.win_rate}%</p>
                <p className="text-sm text-muted-foreground">Win rate</p>
              </div>
              <div className="text-center p-4 bg-secondary rounded-lg">
                <p className="text-3xl font-bold">{stats.won_bets}</p>
                <p className="text-sm text-muted-foreground">Ganadas</p>
              </div>
              <div className="text-center p-4 bg-secondary rounded-lg">
                <p className="text-3xl font-bold">{stats.current_streak}</p>
                <p className="text-sm text-muted-foreground">Racha actual</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="space-y-2">
          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Cerrar Sesión
          </Button>
        </div>
      </main>
    </div>
  )
}
