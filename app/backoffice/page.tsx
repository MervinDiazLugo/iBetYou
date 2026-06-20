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
  AlertTriangle,
  CheckCircle2,
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

        // Fetch events count and user count via metrics (exact count via DB)
        const [eventsRes, metricsRes] = await Promise.all([
          fetch('/api/admin/events?limit=100', { headers: authHeaders }),
          fetch('/api/admin/metrics', { headers: authHeaders }),
        ])
        const eventsData = await eventsRes.json()
        const metricsData = await metricsRes.json()

        setStats({
          totalBets: bets.length,
          openBets,
          takenBets,
          resolvedBets,
          totalUsers: metricsData.users?.total ?? 0,
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

      {/* Scalability reminder — shows at 750+ users */}
      {stats.totalUsers >= 750 && (() => {
        const u = stats.totalUsers
        const pct = Math.min(Math.round((u / 1000) * 100), 100)
        const isUrgent = u >= 900
        const isCritical = u >= 1000

        const barColor = isCritical ? "bg-red-500" : isUrgent ? "bg-orange-500" : "bg-yellow-500"
        const borderColor = isCritical ? "border-red-500/40" : isUrgent ? "border-orange-500/40" : "border-yellow-500/40"
        const bgColor = isCritical ? "bg-red-500/8" : isUrgent ? "bg-orange-500/8" : "bg-yellow-500/8"
        const titleColor = isCritical ? "text-red-400" : isUrgent ? "text-orange-400" : "text-yellow-400"
        const actions = [
          { done: false, label: "Activar Supabase PgBouncer (Transaction mode) — Settings → Database → Connection Pooling" },
          { done: false, label: "Actualizar house_wallet a UPDATE atómico con RPC (elimina race conditions en apuestas vs casa)" },
          { done: false, label: "Confirmar Supabase Pro activo ($25/mes) — necesario para 200+ conexiones DB" },
          { done: false, label: "Revisar Realtime connections (Pro = 500 max) — añadir polling fallback en notificaciones si supera 500 usuarios simultáneos" },
          { done: false, label: "Añadir índices faltantes: idx_wallets_user_id, idx_bets_creator_id, idx_bets_acceptor_id, idx_bets_event_id_status" },
        ]

        return (
          <Card className={`border ${borderColor} ${bgColor}`}>
            <CardContent className="pt-5 pb-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className={`h-5 w-5 mt-0.5 shrink-0 ${titleColor}`} />
                <div className="flex-1 space-y-1">
                  <p className={`text-sm font-bold ${titleColor}`}>
                    {isCritical
                      ? "🚨 Límite de escala alcanzado — acción inmediata requerida"
                      : isUrgent
                        ? "⚠️ Acercándote al límite — prepara la infraestructura ahora"
                        : "💡 Recordatorio de escala — empieza a preparar la transición"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {u.toLocaleString()} usuarios registrados — la plataforma necesita ajustes de infraestructura al llegar a 1.000
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{u.toLocaleString()} usuarios</span>
                  <span className={titleColor}>Umbral de escala: 1.000</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground text-right">{pct}% del umbral</p>
              </div>

              {/* Checklist */}
              <div className="space-y-1.5 pt-1 border-t border-border/40">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-1">Acciones requeridas antes de 1.000 usuarios</p>
                {actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/40" />
                    <p className="text-[11px] text-muted-foreground leading-snug">{a.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      })()}

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
