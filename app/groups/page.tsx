// app/groups/page.tsx
"use client"

import { useState, useEffect } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useAuth } from "@/components/providers"
import { useToast } from "@/components/toast"
import Link from "next/link"
import { Users, Plus, LogIn, Coins } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Navbar } from "@/components/navbar"

interface GroupSummary {
  id: string
  name: string
  code: string
  sport: string | null
  league: string | null
  status: string
  my_balance: number
  member_count: number
  my_role: "admin" | "member"
}

const SPORT_LABELS: Record<string, string> = {
  football: "Fútbol",
  basketball: "Basketball",
  baseball: "Béisbol",
}

export default function GroupsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createSport, setCreateSport] = useState("")
  const [createLeague, setCreateLeague] = useState("")
  const [availableLeagues, setAvailableLeagues] = useState<string[]>([])
  const [leaguesLoading, setLeaguesLoading] = useState(false)
  const [joinCode, setJoinCode] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function authFetch(input: RequestInfo, init?: RequestInit) {
    const supabase = createBrowserSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  async function loadGroups() {
    setLoading(true)
    try {
      const res = await authFetch("/api/groups")
      if (res.ok) {
        const data = await res.json()
        setGroups(data.groups || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (user) loadGroups() }, [user])

  useEffect(() => {
    setCreateLeague("")
    if (!createSport) { setAvailableLeagues([]); return }
    setLeaguesLoading(true)
    fetch("/api/events/list")
      .then(r => r.json())
      .then(d => {
        const leagues = [...new Set<string>(
          (d.events || []).filter((e: { sport: string; league: string }) => e.sport === createSport).map((e: { league: string }) => e.league).filter(Boolean)
        )].sort() as string[]
        setAvailableLeagues(leagues)
      })
      .finally(() => setLeaguesLoading(false))
  }, [createSport])

  async function handleCreate() {
    if (!createName.trim()) return
    setSubmitting(true)
    try {
      const res = await authFetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), sport: createSport || null, league: createLeague || null }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error al crear grupo", "error"); return }
      showToast("Grupo creado exitosamente", "success")
      setShowCreate(false)
      setCreateName("")
      setCreateSport("")
      setCreateLeague("")
      loadGroups()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleJoin() {
    if (!joinCode.trim()) return
    setSubmitting(true)
    try {
      const res = await authFetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error al unirse al grupo", "error"); return }
      showToast(`Te uniste a ${data.group_name}`, "success")
      setShowJoin(false)
      setJoinCode("")
      loadGroups()
    } finally {
      setSubmitting(false)
    }
  }

  if (!user) return <><Navbar /><div className="p-8 text-center text-muted-foreground">Inicia sesión para ver tus grupos</div></>

  return (
    <>
    <Navbar />
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6" /> Mis Grupos
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setShowJoin(!showJoin); setShowCreate(false) }}>
            <LogIn className="w-4 h-4 mr-1" /> Unirse
          </Button>
          <Button size="sm" onClick={() => { setShowCreate(!showCreate); setShowJoin(false) }}>
            <Plus className="w-4 h-4 mr-1" /> Crear
          </Button>
        </div>
      </div>

      {showCreate && (
        <div className="mb-4 p-4 border rounded-lg bg-card space-y-3">
          <h3 className="font-semibold">Crear nuevo grupo</h3>
          <input
            className="w-full border rounded px-3 py-2 text-sm bg-background"
            placeholder="Nombre del grupo (máx. 40 caracteres)"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            maxLength={40}
          />
          <select
            className="w-full border rounded px-3 py-2 text-sm bg-background"
            value={createSport}
            onChange={(e) => setCreateSport(e.target.value)}
          >
            <option value="">Todos los deportes</option>
            <option value="football">Fútbol</option>
            <option value="basketball">Basketball</option>
            <option value="baseball">Béisbol</option>
          </select>
          {createSport && (
            <select
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              value={createLeague}
              onChange={(e) => setCreateLeague(e.target.value)}
              disabled={leaguesLoading}
            >
              <option value="">Todos los torneos</option>
              {availableLeagues.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleCreate} disabled={submitting || !createName.trim()}>
              {submitting ? "Creando..." : "Crear grupo"}
            </Button>
          </div>
        </div>
      )}

      {showJoin && (
        <div className="mb-4 p-4 border rounded-lg bg-card space-y-3">
          <h3 className="font-semibold">Unirse a un grupo</h3>
          <input
            className="w-full border rounded px-3 py-2 text-sm bg-background font-mono tracking-widest uppercase"
            placeholder="Código de invitación (ej: AB3XYZ)"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowJoin(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleJoin} disabled={submitting || joinCode.trim().length < 6}>
              {submitting ? "Uniéndose..." : "Unirse"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-muted-foreground py-12">Cargando grupos...</div>
      ) : groups.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No perteneces a ningún grupo aún.</p>
          <p className="text-sm mt-1">Crea uno o pídele el código de invitación a un amigo.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Link key={g.id} href={`/groups/${g.id}`} className="block">
              <div className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{g.name}</span>
                      {g.my_role === "admin" && <Badge variant="secondary">Admin</Badge>}
                      {g.status === "archived" && <Badge variant="outline">Archivado</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      {g.sport ? SPORT_LABELS[g.sport] : "Todos los deportes"}{g.league ? ` · ${g.league}` : ""} · {g.member_count} miembros · Código: <span className="font-mono">{g.code}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-sm font-medium">
                      <Coins className="w-4 h-4 text-yellow-500" />
                      {g.my_balance.toLocaleString()} tokens
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
    </>
  )
}
