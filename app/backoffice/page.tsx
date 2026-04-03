"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { 
  Trophy, 
  Calendar, 
  Wallet, 
  Users, 
  TrendingUp,
  Activity,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react"
import Link from "next/link"
import { createBrowserSupabaseClient } from "@/lib/supabase"

interface Stats {
  totalBets: number
  openBets: number
  takenBets: number
  resolvedBets: number
  totalUsers: number
  totalEvents: number
}

export default function BackofficeDashboard() {
  const supabase = createBrowserSupabaseClient()
  const [stats, setStats] = useState<Stats>({
    totalBets: 0,
    openBets: 0,
    takenBets: 0,
    resolvedBets: 0,
    totalUsers: 0,
    totalEvents: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const authHeaders: HeadersInit = {}
        if (session?.access_token) {
          authHeaders.Authorization = `Bearer ${session.access_token}`
        }

        // Fetch all bets stats
        const betsRes = await fetch('/api/admin/bets?limit=100', {
          headers: authHeaders
        })
        const betsData = await betsRes.json()
        
        const bets = betsData.bets || []
        const openBets = bets.filter((b: any) => b.status === 'open').length
        const takenBets = bets.filter((b: any) => b.status === 'taken').length
        const resolvedBets = bets.filter((b: any) => b.status === 'resolved').length

        // Fetch events count
        const eventsRes = await fetch('/api/admin/events?limit=100', {
          headers: authHeaders
        })
        const eventsData = await eventsRes.json()
        
        // Fetch users count (from profiles)
        const usersRes = await fetch('/api/admin/wallets?limit=100', {
          headers: authHeaders
        })
        const usersData = await usersRes.json()

        setStats({
          totalBets: bets.length,
          openBets,
          takenBets,
          resolvedBets,
          totalUsers: usersData.wallets?.length || 0,
          totalEvents: eventsData.events?.length || 0
        })
      } catch (err) {
        console.error('Error fetching stats:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [supabase])

  const statCards = [
    {
      title: "Apuestas Abiertas",
      value: stats.openBets,
      icon: Trophy,
      color: "text-green-500",
      bg: "bg-green-500/10"
    },
    {
      title: "Apuestas Tomadas",
      value: stats.takenBets,
      icon: Activity,
      color: "text-blue-500",
      bg: "bg-blue-500/10"
    },
    {
      title: "Apuestas Resueltas",
      value: stats.resolvedBets,
      icon: TrendingUp,
      color: "text-purple-500",
      bg: "bg-purple-500/10"
    },
    {
      title: "Eventos Activos",
      value: stats.totalEvents,
      icon: Calendar,
      color: "text-orange-500",
      bg: "bg-orange-500/10"
    },
    {
      title: "Usuarios Registrados",
      value: stats.totalUsers,
      icon: Users,
      color: "text-cyan-500",
      bg: "bg-cyan-500/10"
    }
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p>Cargando estadísticas...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Resumen de la plataforma</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${stat.color}`}>
                {stat.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              Moderación de Apuestas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Revisa, resuelve o cancela apuestas en disputa
            </p>
            <Button asChild className="w-full">
              <Link href="/backoffice/bets">Ir a Moderación</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-orange-500" />
              Gestión de Eventos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Sincroniza eventos desde APIs externas o crea manualmente
            </p>
            <Button asChild className="w-full">
              <Link href="/backoffice/events">Ir a Eventos</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-green-500" />
              Recargas de Usuarios
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Agrega o resta fondos de las billeteras de usuarios
            </p>
            <Button asChild className="w-full">
              <Link href="/backoffice/wallets">Ir a Recargas</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-cyan-500" />
              Administración de Usuarios
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Separa usuarios de backoffice y usuarios del aplicativo, con ban/unban para app.
            </p>
            <Button asChild className="w-full">
              <Link href="/backoffice/users">Ir a Usuarios</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
