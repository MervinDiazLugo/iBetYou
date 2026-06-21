"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { formatCurrency } from "@/lib/utils"
import { useAuth } from "@/components/providers"
import { useToast } from "@/components/toast"
import { LogOut, Globe, TrendingUp, Coins, Shield } from "lucide-react"

const COUNTRIES = [
  "Venezuela","Argentina","Colombia","Chile","México","Perú","Uruguay",
  "Bolivia","Ecuador","Paraguay","Brasil","Costa Rica","Panamá","Honduras",
  "El Salvador","Guatemala","Nicaragua","República Dominicana","Cuba",
  "España","Estados Unidos","Otro",
]

interface ProfilePayload {
  profile: {
    nickname?: string
    avatar_url?: string | null
    kyc_status?: string
    created_at?: string
    country?: string | null
    [key: string]: unknown
  }
  wallet: {
    balance_fantasy?: number
    balance_real?: number
  } | null
  stats: {
    total_bets: number
    won_bets: number
    win_rate: number
    current_streak: number
  }
}

function getLevel(total: number, winRate: number) {
  if (total >= 500 && winRate >= 70) return { label: "Leyenda", icon: "👑" }
  if (total >= 100 && winRate >= 60) return { label: "Experto", icon: "🏆" }
  if (total >= 50) return { label: "Competidor", icon: "🥇" }
  if (total >= 10) return { label: "Apostador", icon: "🥈" }
  return { label: "Novato", icon: "🥉" }
}

export default function ProfilePage() {
  const router = useRouter()
  const { user, loading: authLoading, signOut } = useAuth()
  const supabase = useMemo(() => createBrowserSupabaseClient(), [])
  const { showToast } = useToast()

  const [data, setData] = useState<ProfilePayload | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [country, setCountry] = useState("")
  const [editingCountry, setEditingCountry] = useState(false)
  const [savingCountry, setSavingCountry] = useState(false)

  const fetchProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      router.push("/login")
      return
    }
    try {
      const res = await fetch("/api/user/profile", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.status === 401) { router.push("/login"); return }
      if (!res.ok) { setLoadError(true); return }
      const payload: ProfilePayload = await res.json()
      setData(payload)
      setCountry(payload.profile.country || "")
    } catch {
      setLoadError(true)
    }
  }, [supabase, router])

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }
    fetchProfile()
  }, [authLoading, user, fetchProfile, router])

  const handleSaveCountry = async () => {
    if (!country) return
    setSavingCountry(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ country }),
      })
      if (res.ok) {
        setData(prev => prev ? { ...prev, profile: { ...prev.profile, country } } : prev)
        setEditingCountry(false)
        showToast("País actualizado", "success")
      } else {
        const d = await res.json()
        showToast(d.error || "Error al guardar", "error")
      }
    } finally {
      setSavingCountry(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  // Loading
  if (authLoading || (!data && !loadError)) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center py-32">
          <p className="text-muted-foreground">Cargando perfil...</p>
        </div>
      </div>
    )
  }

  // Error
  if (loadError || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <p className="text-muted-foreground">No se pudo cargar el perfil.</p>
          <button onClick={fetchProfile} className="text-sm text-primary underline">
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  const { profile, wallet, stats } = data
  const level = getLevel(stats.total_bets, stats.win_rate)
  const memberSince = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })
    : null

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto px-4 py-6 max-w-md space-y-4">

        {/* Avatar + identity */}
        <Card>
          <CardContent className="pt-6 pb-5 flex flex-col items-center gap-3 text-center">
            <div className="text-6xl leading-none">{profile.avatar_url || "⭐"}</div>
            <div>
              <p className="text-xl font-bold">{profile.nickname}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              {memberSince && <p className="text-xs text-muted-foreground mt-0.5">Miembro desde {memberSince}</p>}
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              <Badge variant="secondary">{level.icon} {level.label}</Badge>
              <Badge variant={profile.kyc_status === "approved" ? "default" : "outline"}>
                <Shield className="h-3 w-3 mr-1" />
                {profile.kyc_status === "approved" ? "Verificado" : "Sin verificar"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Balance */}
        <Card>
          <CardContent className="pt-5 pb-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5" /> Saldo
            </p>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Fantasy Tokens</span>
              <span className="text-2xl font-bold text-primary">
                {formatCurrency(wallet?.balance_fantasy ?? 0)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card>
          <CardContent className="pt-5 pb-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Estadísticas
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{stats.total_bets}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Predicciones</p>
              </div>
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-500">{stats.win_rate}%</p>
                <p className="text-xs text-muted-foreground mt-0.5">Win rate</p>
              </div>
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{stats.won_bets}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Ganadas</p>
              </div>
              <div className="bg-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{stats.total_bets - stats.won_bets}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Perdidas</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Country */}
        <Card>
          <CardContent className="pt-5 pb-5 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" /> País
            </p>
            {editingCountry ? (
              <div className="space-y-2">
                <select
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                  value={country}
                  onChange={e => setCountry(e.target.value)}
                >
                  <option value="">Seleccioná tu país...</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={handleSaveCountry}
                    disabled={savingCountry || !country}>
                    {savingCountry ? "Guardando..." : "Guardar"}
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1"
                    onClick={() => { setEditingCountry(false); setCountry(profile.country || "") }}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm">{profile.country || <span className="text-muted-foreground">No especificado</span>}</span>
                <Button size="sm" variant="outline" onClick={() => setEditingCountry(true)}>
                  Cambiar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sign out */}
        <Button variant="outline" className="w-full" onClick={handleSignOut}>
          <LogOut className="h-4 w-4 mr-2" />
          Cerrar sesión
        </Button>

      </main>
    </div>
  )
}
