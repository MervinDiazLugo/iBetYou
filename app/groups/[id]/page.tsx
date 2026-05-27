// app/groups/[id]/page.tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useAuth } from "@/components/providers"
import { useToast } from "@/components/toast"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Users, Trophy, Coins, ChevronLeft, Calendar
} from "lucide-react"
import Link from "next/link"
import { Navbar } from "@/components/navbar"

interface GroupDetail {
  id: string; name: string; code: string; sport: string | null; league: string | null; status: string
}
interface GroupMember {
  user_id: string; role: string; profile: { nickname: string; avatar_url: string | null } | null
}
interface LeaderboardEntry {
  user_id: string; nickname: string; avatar_url: string | null
  balance: number; total_won: number; total_wins: number
}
interface GroupBet {
  id: string; event_id: number; creator_id: string; bet_type: string
  creator_selection: string; amount: number; created_at: string
  event: { home_team: string; away_team: string; start_time: string; sport: string } | null
  creator: { nickname: string } | null
}

const SPORT_LABELS: Record<string, string> = {
  football: "Fútbol", basketball: "Basketball", baseball: "Béisbol"
}

export default function GroupPage() {
  const { id: groupId } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()

  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [myWallet, setMyWallet] = useState<{ balance: number; last_daily_grant: string | null }>({ balance: 0, last_daily_grant: null })
  const [bets, setBets] = useState<GroupBet[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [tab, setTab] = useState<"bets" | "leaderboard" | "members">("bets")
  const [loading, setLoading] = useState(true)
  const [grantLoading, setGrantLoading] = useState(false)
  const [takingBetId, setTakingBetId] = useState<string | null>(null)

  async function authFetch(input: RequestInfo, init?: RequestInit) {
    const supabase = createBrowserSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  const loadDetail = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/groups/${groupId}`)
      if (res.status === 403 || res.status === 404) { router.push("/groups"); return }
      if (!res.ok) return
      const data = await res.json()
      setGroup(data.group)
      setMembers(data.members || [])
      setMyWallet(data.my_wallet || { balance: 0, last_daily_grant: null })
    } finally {
      setLoading(false)
    }
  }, [groupId])

  const loadBets = useCallback(async () => {
    const res = await authFetch(`/api/groups/${groupId}/bets`)
    if (res.ok) {
      const data = await res.json()
      setBets(data.bets || [])
    }
  }, [groupId])

  const loadLeaderboard = useCallback(async () => {
    const res = await authFetch(`/api/groups/${groupId}/leaderboard`)
    if (res.ok) {
      const data = await res.json()
      setLeaderboard(data.leaderboard || [])
    }
  }, [groupId])

  useEffect(() => {
    if (user && groupId) {
      Promise.all([loadDetail(), loadBets(), loadLeaderboard()])
    }
  }, [user, groupId])

  async function handleDailyGrant() {
    setGrantLoading(true)
    try {
      const res = await authFetch(`/api/groups/${groupId}/daily-grant`, { method: "POST" })
      const data = await res.json()
      showToast(data.message || (data.granted ? "+500 tokens acreditados" : "Ya recibiste tus tokens de hoy"), data.granted ? "success" : "error")
      if (data.granted) setMyWallet((w) => ({ ...w, balance: Number(data.balance) }))
    } finally {
      setGrantLoading(false)
    }
  }

  async function handleTakeBet(bet: GroupBet) {
    if (!user) return
    setTakingBetId(bet.id)
    try {
      const supabase = createBrowserSupabaseClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/bets/${bet.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ user_id: user.id, action: "take" }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error al tomar apuesta", "error"); return }
      showToast("Apuesta tomada exitosamente", "success")
      loadBets()
      loadDetail()
    } finally {
      setTakingBetId(null)
    }
  }

  const todayUTC = new Date().toISOString().split("T")[0]
  const alreadyGrantedToday = myWallet.last_daily_grant === todayUTC

  if (!user) return <><Navbar /><div className="p-8 text-center text-muted-foreground">Inicia sesión para ver este grupo</div></>
  if (loading) return <><Navbar /><div className="p-8 text-center text-muted-foreground">Cargando grupo...</div></>
  if (!group) return <><Navbar /><div className="p-8 text-center text-muted-foreground">Grupo no encontrado</div></>

  return (
    <>
    <Navbar />
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <div className="mb-4">
        <Link href="/groups" className="text-sm text-muted-foreground flex items-center gap-1 mb-3 hover:text-foreground">
          <ChevronLeft className="w-4 h-4" /> Mis Grupos
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{group.name}</h1>
            <div className="text-sm text-muted-foreground mt-0.5">
              {group.sport ? SPORT_LABELS[group.sport] : "Todos los deportes"} · {members.length} miembros · Código: <span className="font-mono font-semibold">{group.code}</span>
            </div>
          </div>
          {group.status === "archived" && <Badge variant="outline">Archivado</Badge>}
        </div>
      </div>

      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg mb-5">
        <div className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-yellow-500" />
          <span className="font-semibold">{myWallet.balance.toLocaleString()} tokens de grupo</span>
        </div>
        <Button
          size="sm"
          variant={alreadyGrantedToday ? "outline" : "default"}
          onClick={handleDailyGrant}
          disabled={grantLoading || alreadyGrantedToday}
        >
          {alreadyGrantedToday ? "Tokens reclamados hoy" : grantLoading ? "Cargando..." : "+500 tokens diarios"}
        </Button>
      </div>

      <div className="flex gap-1 mb-5 border-b">
        {(["bets", "leaderboard", "members"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "bets" ? "Apuestas" : t === "leaderboard" ? "Leaderboard" : "Miembros"}
          </button>
        ))}
      </div>

      {tab === "bets" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">{bets.length} apuesta{bets.length !== 1 ? "s" : ""} disponible{bets.length !== 1 ? "s" : ""}</span>
            {group.status === "active" && (
              <Link href={`/groups/${groupId}/create-bet`}>
                <Button size="sm">Crear apuesta</Button>
              </Link>
            )}
          </div>

          {bets.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No hay apuestas abiertas en este grupo.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {bets.map((bet) => (
                <div key={bet.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">
                        {bet.event?.home_team} vs {bet.event?.away_team}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {bet.bet_type} · {bet.creator_selection} · por {bet.creator?.nickname ?? "—"}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="font-semibold text-sm">{bet.amount.toLocaleString()} tokens</span>
                      <Button
                        size="sm"
                        onClick={() => handleTakeBet(bet)}
                        disabled={takingBetId === bet.id || myWallet.balance < bet.amount}
                      >
                        {takingBetId === bet.id ? "Tomando..." : "Tomar"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "leaderboard" && (
        <div className="space-y-2">
          {leaderboard.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <Trophy className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>Aún no hay apuestas resueltas en este grupo.</p>
            </div>
          ) : (
            leaderboard.map((entry, i) => (
              <div key={entry.user_id} className={`flex items-center gap-3 p-3 rounded-lg ${entry.user_id === user.id ? "bg-primary/5 border border-primary/20" : "border"}`}>
                <div className="w-7 text-center font-bold text-muted-foreground text-sm">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {entry.nickname}{entry.user_id === user.id && <span className="text-xs text-muted-foreground ml-1">(tú)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{entry.total_wins} victorias</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 text-sm font-semibold">
                    <Coins className="w-3.5 h-3.5 text-yellow-500" />
                    {entry.total_won.toLocaleString()} ganados
                  </div>
                  <div className="text-xs text-muted-foreground">Balance: {entry.balance.toLocaleString()}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "members" && (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 p-3 border rounded-lg">
              <div className="flex-1">
                <span className="font-medium text-sm">{m.profile?.nickname ?? m.user_id.slice(0, 8)}</span>
                {m.user_id === user.id && <span className="text-xs text-muted-foreground ml-1">(tú)</span>}
              </div>
              {m.role === "admin" && <Badge variant="secondary">Admin</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  )
}
