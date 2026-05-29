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
  Users, Trophy, Coins, ChevronLeft, Calendar, Settings, UserPlus, Plus
} from "lucide-react"
import Link from "next/link"
import { Navbar } from "@/components/navbar"
import { GroupBetModal } from "./group-bet-modal"

interface GroupDetail {
  id: string; name: string; code: string; sport: string | null; leagues: string[]; status: string
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
  event: { home_team: string; away_team: string; start_time: string; sport: string; league: string } | null
  creator: { nickname: string } | null
}
interface EventRow {
  id: number; home_team: string; away_team: string; start_time: string
  sport: string; league: string; status: string
  home_logo?: string | null; away_logo?: string | null
  metadata?: {
    predictions?: {
      percent?: { home: string; draw: string; away: string } | null
      advice?: string | null
      home_league_form?: string | null
      away_league_form?: string | null
    }
  }
}

const SPORT_LABELS: Record<string, string> = {
  football: "Fútbol", basketball: "Basketball", baseball: "Béisbol"
}
const BET_TYPE_LABELS: Record<string, string> = {
  direct: "Ganador directo", exact_score: "Score exacto",
  half_time: "Medio tiempo", first_scorer: "1er Anotador",
}

function selectionLabel(sel: string, event: GroupBet["event"] | null): string {
  if (!event) return sel
  if (sel === "home") return event.home_team
  if (sel === "away") return event.away_team
  if (sel === "draw") return "Empate"
  return sel
}

export default function GroupPage() {
  const { id: groupId } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()

  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [myRole, setMyRole] = useState<"admin" | "member" | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [myWallet, setMyWallet] = useState<{ balance: number; last_daily_grant: string | null }>({ balance: 0, last_daily_grant: null })
  const [bets, setBets] = useState<GroupBet[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [tab, setTab] = useState<"bets" | "leaderboard" | "members" | "settings">("bets")
  const [betSubTab, setBetSubTab] = useState<"crear" | "tomar">("crear")
  const [loading, setLoading] = useState(true)
  const [takingBetId, setTakingBetId] = useState<string | null>(null)

  // Bet modal state
  const [betModalEvent, setBetModalEvent] = useState<EventRow | null>(null)
  const [leavingGroup, setLeavingGroup] = useState(false)

  // Invite state
  const [inviteNickname, setInviteNickname] = useState("")
  const [inviting, setInviting] = useState(false)

  // Settings state
  const [settingsLeagues, setSettingsLeagues] = useState<string[]>([])
  const [availableLeagues, setAvailableLeagues] = useState<{ league: string; country: string }[]>([])
  const [settingsLeagueSearch, setSettingsLeagueSearch] = useState("")
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)

  const PRIORITY_LEAGUES: Record<string, string[]> = {
    football: ["UEFA Champions League", "UEFA Europa League", "Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "MLS", "Copa Libertadores", "Copa Sudamericana", "Liga MX", "Eredivisie", "Primeira Liga"],
    basketball: ["NBA", "Euroleague", "EuroBasket", "NCAA"],
    baseball: ["MLB", "KBO", "NPB", "LMB", "LMBP"],
  }

  function sortLeagueEntries(leagues: { league: string; country: string }[], sport: string): { league: string; country: string }[] {
    const priority = PRIORITY_LEAGUES[sport] || []
    const prioritySet = new Map(priority.map((l, i) => [l.toLowerCase(), i]))
    return [...leagues].sort((a, b) => {
      const ai = prioritySet.get(a.league.toLowerCase()) ?? 9999
      const bi = prioritySet.get(b.league.toLowerCase()) ?? 9999
      if (ai !== bi) return ai - bi
      return a.league.localeCompare(b.league)
    })
  }

  async function authFetch(input: RequestInfo, init?: RequestInit) {
    const supabase = createBrowserSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

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

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/groups/${groupId}`)
      if (res.status === 403 || res.status === 404) { router.push("/groups"); return }
      if (!res.ok) return
      const data = await res.json()
      const g: GroupDetail = data.group
      const wallet = data.my_wallet || { balance: 0, last_daily_grant: null }

      setGroup(g)
      setMyRole(data.my_role)
      setMembers(data.members || [])

      // Await daily grant so balance is correct before page renders
      const todayUTC = new Date().toISOString().split("T")[0]
      if (wallet.last_daily_grant !== todayUTC) {
        try {
          const grantRes = await authFetch(`/api/groups/${groupId}/daily-grant`, { method: "POST" })
          const grantData = await grantRes.json()
          if (grantData.granted) {
            wallet.balance = Number(grantData.balance)
            wallet.last_daily_grant = todayUTC
            showToast("+1.000 tokens de grupo acreditados", "success")
          }
        } catch {}
      }
      setMyWallet(wallet)

      // Load events for group's sport/leagues
      const params = new URLSearchParams({ limit: "50" })
      if (g.sport) params.set("sport", g.sport)
      const evRes = await fetch(`/api/events/list?${params}`)
      if (evRes.ok) {
        const evData = await evRes.json()
        const evs: EventRow[] = Array.isArray(evData) ? evData : (evData.events || [])
        const relevant = evs.filter(e =>
          (e.status === "scheduled" || e.status === "live") &&
          (g.leagues && g.leagues.length > 0 ? g.leagues.includes(e.league) : true)
        )
        setEvents(relevant)
      }
    } finally {
      setLoading(false)
    }
  }, [groupId])

  const userId = user?.id
  useEffect(() => {
    if (userId && groupId) {
      Promise.all([loadAll(), loadBets(), loadLeaderboard()])
    }
  }, [userId, groupId])

  // Load available leagues when settings tab opens
  useEffect(() => {
    if (tab !== "settings" || !group?.sport) return
    setSettingsLoading(true)
    setSettingsLeagueSearch("")
    fetch(`/api/events/list?sport=${group.sport}&status=all&limit=200`)
      .then(r => r.json())
      .then(d => {
        const evs: EventRow[] = Array.isArray(d) ? d : (d.events || [])
        const leagueMap = new Map<string, string>()
        for (const e of evs) {
          if (e.league && !leagueMap.has(e.league)) leagueMap.set(e.league, (e as any).country || "")
        }
        const entries = [...leagueMap.entries()].map(([league, country]) => ({ league, country }))
        setAvailableLeagues(sortLeagueEntries(entries, group.sport!))
      })
      .finally(() => setSettingsLoading(false))
  }, [tab, group?.sport])

  useEffect(() => {
    if (tab === "settings" && group) setSettingsLeagues(group.leagues || [])
  }, [tab, group])

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
      loadAll()
    } finally {
      setTakingBetId(null)
    }
  }

  async function handleInvite() {
    if (!inviteNickname.trim()) return
    setInviting(true)
    try {
      const res = await authFetch(`/api/groups/${groupId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: inviteNickname.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error al enviar invitación", "error"); return }
      showToast(`Invitación enviada a ${inviteNickname.trim()}`, "success")
      setInviteNickname("")
    } finally {
      setInviting(false)
    }
  }

  async function handleLeaveGroup() {
    setLeavingGroup(true)
    try {
      const res = await authFetch(`/api/groups/${groupId}/leave`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error al salir del grupo", "error"); return }
      showToast("Saliste del grupo", "success")
      router.push("/groups")
    } finally {
      setLeavingGroup(false)
    }
  }

  async function handleSaveSettings() {
    setSettingsSaving(true)
    try {
      const res = await authFetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagues: settingsLeagues }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "Error al guardar configuración", "error"); return }
      showToast("Configuración guardada", "success")
      setGroup(g => g ? { ...g, leagues: settingsLeagues } : g)
    } finally {
      setSettingsSaving(false)
    }
  }

  const tabs = [
    { id: "bets" as const, label: "Apuestas" },
    { id: "leaderboard" as const, label: "Leaderboard" },
    { id: "members" as const, label: "Miembros" },
    ...(myRole === "admin" ? [{ id: "settings" as const, label: "Configuración" }] : []),
  ]

  // Build event → bets map
  const betsByEvent = new Map<number, GroupBet[]>()
  for (const bet of bets) {
    const arr = betsByEvent.get(bet.event_id) || []
    arr.push(bet)
    betsByEvent.set(bet.event_id, arr)
  }

  if (!user) return <><Navbar /><div className="p-8 text-center text-muted-foreground">Inicia sesión para ver este grupo</div></>
  if (loading) return <><Navbar /><div className="p-8 text-center text-muted-foreground">Cargando grupo...</div></>
  if (!group) return <><Navbar /><div className="p-8 text-center text-muted-foreground">Grupo no encontrado</div></>

  return (
    <>
    <Navbar />
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      {/* Header */}
      <div className="mb-4">
        <Link href="/groups" className="text-sm text-muted-foreground flex items-center gap-1 mb-3 hover:text-foreground">
          <ChevronLeft className="w-4 h-4" /> Mis Grupos
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{group.name}</h1>
            <div className="text-sm text-muted-foreground mt-0.5">
              {group.sport ? SPORT_LABELS[group.sport] : "Todos los deportes"}
              {group.leagues && group.leagues.length > 0 && (
                <span> · {group.leagues.length} torneo{group.leagues.length !== 1 ? "s" : ""}</span>
              )}
              {" "}· {members.length} miembro{members.length !== 1 ? "s" : ""} · Código: <span className="font-mono font-semibold">{group.code}</span>
            </div>
          </div>
          {group.status === "archived" && <Badge variant="outline">Archivado</Badge>}
        </div>
      </div>

      {/* Wallet bar */}
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg mb-5">
        <Coins className="w-5 h-5 text-yellow-500" />
        <span className="font-semibold">{myWallet.balance.toLocaleString()} tokens de grupo</span>
        <span className="text-xs text-muted-foreground ml-auto">+1.000 diarios automáticos</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Bets tab — sub-tabs: Crear / Tomar */}
      {tab === "bets" && (() => {
        const eventsWithBets = events.filter(ev => (betsByEvent.get(ev.id) || []).length > 0)
        const takableCount = eventsWithBets.reduce((n, ev) => {
          const bs = betsByEvent.get(ev.id) || []
          return n + bs.filter(b => b.creator_id !== user.id).length
        }, 0)

        function EventHeader({ ev, showApostar }: { ev: EventRow; showApostar: boolean }) {
          const isLive = ev.status === "live"
          return (
            <div className={`px-4 py-3 ${isLive ? "bg-red-500/10 border-b border-red-500/20" : "bg-muted/30 border-b"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{ev.league}</span>
                <div className="flex items-center gap-2">
                  {isLive && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      En vivo
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(ev.start_time).toLocaleString("es-ES", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                    <span className="font-semibold text-sm truncate text-right">{ev.home_team}</span>
                    {ev.home_logo
                      ? <img src={ev.home_logo} alt="" className="w-7 h-7 object-contain shrink-0" />
                      : <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold shrink-0">{ev.home_team[0]}</div>
                    }
                  </div>
                  <span className="text-muted-foreground font-bold text-xs shrink-0">vs</span>
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    {ev.away_logo
                      ? <img src={ev.away_logo} alt="" className="w-7 h-7 object-contain shrink-0" />
                      : <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold shrink-0">{ev.away_team[0]}</div>
                    }
                    <span className="font-semibold text-sm truncate">{ev.away_team}</span>
                  </div>
                </div>
                {showApostar && group?.status === "active" && (
                  <Button size="sm" variant="outline" className="gap-1 text-xs ml-2 shrink-0" onClick={() => setBetModalEvent(ev)}>
                    <Plus className="w-3 h-3" /> Apostar
                  </Button>
                )}
              </div>
              {ev.metadata?.predictions?.percent && (
                <div className="mt-2 flex gap-2">
                  <div className="flex-1 text-center rounded bg-blue-500/10 border border-blue-500/15 py-1 px-2">
                    <div className="text-[9px] text-muted-foreground truncate">{ev.home_team}</div>
                    <div className="text-xs font-bold text-blue-300">{ev.metadata.predictions.percent.home}</div>
                    {ev.metadata.predictions.home_league_form && (
                      <div className="flex gap-0.5 justify-center mt-0.5">
                        {ev.metadata.predictions.home_league_form.slice(-5).split("").map((c, i) => (
                          <span key={i} className={`inline-block w-1.5 h-1.5 rounded-full ${c === "W" ? "bg-green-500" : c === "D" ? "bg-gray-400" : "bg-red-500"}`} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-center rounded bg-gray-500/10 border border-gray-500/15 py-1 px-2">
                    <div className="text-[9px] text-muted-foreground">Empate</div>
                    <div className="text-xs font-bold text-gray-300">{ev.metadata.predictions.percent.draw}</div>
                  </div>
                  <div className="flex-1 text-center rounded bg-orange-500/10 border border-orange-500/15 py-1 px-2">
                    <div className="text-[9px] text-muted-foreground truncate">{ev.away_team}</div>
                    <div className="text-xs font-bold text-orange-300">{ev.metadata.predictions.percent.away}</div>
                    {ev.metadata.predictions.away_league_form && (
                      <div className="flex gap-0.5 justify-center mt-0.5">
                        {ev.metadata.predictions.away_league_form.slice(-5).split("").map((c, i) => (
                          <span key={i} className={`inline-block w-1.5 h-1.5 rounded-full ${c === "W" ? "bg-green-500" : c === "D" ? "bg-gray-400" : "bg-red-500"}`} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {ev.metadata?.predictions?.advice && (
                <p className="mt-1.5 text-[10px] text-center text-amber-300/80">💡 {ev.metadata.predictions.advice}</p>
              )}
            </div>
          )
        }

        return (
          <div>
            {/* Sub-tabs */}
            <div className="flex gap-1 mb-4 border rounded-lg p-1 bg-muted/30 w-fit">
              <button
                onClick={() => setBetSubTab("crear")}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${betSubTab === "crear" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Crear apuesta
              </button>
              <button
                onClick={() => setBetSubTab("tomar")}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${betSubTab === "tomar" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Tomar apuesta
                {takableCount > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${betSubTab === "tomar" ? "bg-primary text-primary-foreground" : "bg-muted-foreground/30 text-foreground"}`}>
                    {takableCount}
                  </span>
                )}
              </button>
            </div>

            {/* Crear sub-tab */}
            {betSubTab === "crear" && (
              events.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>No hay eventos disponibles para este grupo.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {events.map((ev) => (
                    <div key={ev.id} className="border rounded-xl overflow-hidden">
                      <EventHeader ev={ev} showApostar={true} />
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Tomar sub-tab */}
            {betSubTab === "tomar" && (
              eventsWithBets.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  <Coins className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p>No hay apuestas abiertas en este grupo.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {eventsWithBets.map((ev) => {
                    const eventBets = betsByEvent.get(ev.id) || []
                    return (
                      <div key={ev.id} className="border rounded-xl overflow-hidden">
                        <EventHeader ev={ev} showApostar={false} />
                        <div className="divide-y">
                          {eventBets.map((bet) => {
                            const isOwn = bet.creator_id === user.id
                            const hasBalance = myWallet.balance >= bet.amount
                            const canTake = !isOwn && hasBalance
                            return (
                              <div key={bet.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium">{selectionLabel(bet.creator_selection, bet.event)}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {BET_TYPE_LABELS[bet.bet_type] ?? bet.bet_type} · por {bet.creator?.nickname ?? "—"}
                                  </div>
                                  {!isOwn && !hasBalance && (
                                    <div className="text-[10px] text-red-400 mt-0.5">Saldo insuficiente ({myWallet.balance.toLocaleString()} / {bet.amount.toLocaleString()})</div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <div className="flex items-center gap-1 text-sm font-semibold">
                                    <Coins className="w-3.5 h-3.5 text-yellow-500" />
                                    {bet.amount.toLocaleString()}
                                  </div>
                                  {isOwn ? (
                                    <Badge variant="outline" className="text-[10px]">Tuya</Badge>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="h-7 text-xs"
                                      onClick={() => handleTakeBet(bet)}
                                      disabled={takingBetId === bet.id || !canTake}
                                    >
                                      {takingBetId === bet.id ? "..." : "Tomar"}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </div>
        )
      })()}

      {/* Leaderboard tab */}
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

      {/* Members tab */}
      {tab === "members" && (
        <div>
          {myRole === "admin" && (
            <div className="mb-4 p-3 border rounded-lg bg-card">
              <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <UserPlus className="w-4 h-4" /> Invitar por nickname
              </p>
              <div className="flex gap-2">
                <input
                  className="flex-1 border rounded px-3 py-1.5 text-sm bg-background"
                  placeholder="Nickname del usuario"
                  value={inviteNickname}
                  onChange={(e) => setInviteNickname(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                />
                <Button size="sm" onClick={handleInvite} disabled={inviting || !inviteNickname.trim()}>
                  {inviting ? "Enviando..." : "Invitar"}
                </Button>
              </div>
            </div>
          )}
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
          <div className="mt-6 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={handleLeaveGroup}
              disabled={leavingGroup}
            >
              {leavingGroup ? "Saliendo..." : "Salir del grupo"}
            </Button>
          </div>
        </div>
      )}

      {/* Settings tab (admin only) */}
      {tab === "settings" && myRole === "admin" && (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
              <Settings className="w-4 h-4" /> Torneos del grupo
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Solo puedes quitar torneos si no hay apuestas del grupo en esos torneos.
            </p>
            {!group.sport ? (
              <p className="text-sm text-muted-foreground">Este grupo acepta todos los deportes — el filtro de torneo no aplica.</p>
            ) : settingsLoading ? (
              <p className="text-sm text-muted-foreground">Cargando torneos disponibles...</p>
            ) : availableLeagues.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay torneos disponibles para este deporte.</p>
            ) : (() => {
              const filtered = availableLeagues.filter(({ league }) =>
                league.toLowerCase().includes(settingsLeagueSearch.toLowerCase())
              )
              return (
                <div className="border rounded-lg overflow-hidden">
                  <div className="px-3 pt-2 pb-1.5 border-b">
                    <input
                      className="w-full border rounded px-2 py-1 text-xs bg-muted/30 placeholder:text-muted-foreground/60"
                      placeholder="Buscar torneo..."
                      value={settingsLeagueSearch}
                      onChange={(e) => setSettingsLeagueSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-3 py-2">Sin resultados</p>
                    ) : filtered.map(({ league, country }) => (
                      <label key={league} className="flex items-center gap-3 px-3 py-2.5 text-sm border-b last:border-b-0 hover:bg-muted/40 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settingsLeagues.includes(league)}
                          onChange={(e) => setSettingsLeagues(prev =>
                            e.target.checked ? [...prev, league] : prev.filter(x => x !== league)
                          )}
                          className="rounded"
                        />
                        <span className="flex-1 min-w-0">
                          {country && <span className="text-muted-foreground text-xs">{country} · </span>}
                          {league}
                        </span>
                        {group.leagues?.includes(league) && !settingsLeagues.includes(league) && (
                          <span className="shrink-0 text-xs text-destructive">Se quitará</span>
                        )}
                        {!group.leagues?.includes(league) && settingsLeagues.includes(league) && (
                          <span className="shrink-0 text-xs text-primary">Se agregará</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })()}
            {group.sport && settingsLeagues.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                {settingsLeagues.length} torneo{settingsLeagues.length !== 1 ? "s" : ""} seleccionado{settingsLeagues.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSaveSettings} disabled={settingsSaving}>
              {settingsSaving ? "Guardando..." : "Guardar configuración"}
            </Button>
            <Button variant="outline" onClick={() => setSettingsLeagues(group.leagues || [])} disabled={settingsSaving}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>

    {/* Bet creation modal */}
    {betModalEvent && (
      <GroupBetModal
        groupId={groupId}
        groupBalance={myWallet.balance}
        initialEvent={betModalEvent}
        groupSport={group.sport}
        onClose={() => setBetModalEvent(null)}
        onSuccess={() => {
          setBetModalEvent(null)
          loadBets()
          loadAll()
        }}
      />
    )}
    </>
  )
}
