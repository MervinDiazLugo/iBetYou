"use client"

import { useState, useEffect } from "react"
import Navbar from "@/components/navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Trophy, Flame, Activity, Target, TrendingUp, Users, BarChart2, Star } from "lucide-react"

const betTypeLabels: Record<string, string> = {
  direct: "Direct",
  half_time: "Half Time",
  exact_score: "Exact Score",
  first_scorer: "First Scorer",
}

interface RankingEntry {
  nickname: string
  avatar_url: string | null
  wins: number
  participated: number
  losses: number
  winRate: number
  recentWins: number
}

interface Stats {
  rankings: {
    topByWins: RankingEntry[]
    topByRate: RankingEntry[]
    topByActivity: RankingEntry[]
    topHot: RankingEntry[]
  }
  platform: {
    totalBets: number
    totalResolved: number
    activeBetsCount: number
    totalParticipants: number
    betTypeCounts: Record<string, number>
    topLeagues: { name: string; count: number }[]
  }
  recentResolved: {
    winnerNickname: string | null
    winnerAvatar: string | null
    betType: string
    homeTeam: string
    awayTeam: string
    league: string
    resolvedAt: string | null
  }[]
}

function Avatar({ nickname, avatar_url, size = "md" }: { nickname: string; avatar_url: string | null; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "w-7 h-7 text-xs", md: "w-9 h-9 text-sm", lg: "w-12 h-12 text-base" }
  if (avatar_url) {
    return <img src={avatar_url} alt={nickname} className={`${sizes[size]} rounded-full object-cover`} />
  }
  return (
    <div className={`${sizes[size]} rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary`}>
      {nickname?.[0]?.toUpperCase() || "?"}
    </div>
  )
}

function MedalIcon({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-400 font-bold text-lg">🥇</span>
  if (rank === 2) return <span className="text-gray-300 font-bold text-lg">🥈</span>
  if (rank === 3) return <span className="text-amber-600 font-bold text-lg">🥉</span>
  return <span className="text-muted-foreground text-sm font-bold w-6 text-center">{rank}</span>
}

function RankingTable({ entries, metric }: { entries: RankingEntry[]; metric: "wins" | "winRate" | "participated" | "recentWins" }) {
  if (entries.length === 0) {
    return <p className="text-center text-muted-foreground py-6 text-sm">No data yet</p>
  }
  return (
    <div className="space-y-2">
      {entries.map((entry, i) => (
        <div key={entry.nickname} className={`flex items-center gap-3 p-2 rounded-lg ${i === 0 ? "bg-yellow-500/5 border border-yellow-500/20" : "hover:bg-muted/40"}`}>
          <div className="w-7 flex justify-center shrink-0">
            <MedalIcon rank={i + 1} />
          </div>
          <Avatar nickname={entry.nickname} avatar_url={entry.avatar_url} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{entry.nickname}</div>
            <div className="text-xs text-muted-foreground">
              {entry.participated} bets · {entry.wins}W {entry.losses}L
            </div>
          </div>
          <div className="text-right shrink-0">
            {metric === "wins" && <div className="font-bold text-green-400">{entry.wins} wins</div>}
            {metric === "winRate" && <div className="font-bold text-blue-400">{entry.winRate}%</div>}
            {metric === "participated" && <div className="font-bold text-purple-400">{entry.participated} bets</div>}
            {metric === "recentWins" && <div className="font-bold text-orange-400">{entry.recentWins} wins</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

type Tab = "wins" | "rate" | "active" | "hot"

export default function LeaderboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("wins")

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold flex items-center justify-center gap-2 mb-2">
            <Trophy className="h-8 w-8 text-yellow-400" />
            Leaderboard
          </h1>
          <p className="text-muted-foreground">Best bettors on the platform</p>
        </div>

        {loading ? (
          <div className="text-center py-20 text-muted-foreground">Loading...</div>
        ) : !stats ? (
          <div className="text-center py-20 text-red-500">Could not load stats</div>
        ) : (
          <div className="space-y-6">
            {/* Platform stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart2 className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Total bets</span>
                  </div>
                  <div className="text-2xl font-bold">{stats.platform.totalBets}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="h-4 w-4 text-green-400" />
                    <span className="text-xs text-muted-foreground">Resolved</span>
                  </div>
                  <div className="text-2xl font-bold text-green-400">{stats.platform.totalResolved}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="h-4 w-4 text-blue-400" />
                    <span className="text-xs text-muted-foreground">Active bets</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-400">{stats.platform.activeBetsCount}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4 text-purple-400" />
                    <span className="text-xs text-muted-foreground">Bettors</span>
                  </div>
                  <div className="text-2xl font-bold text-purple-400">{stats.platform.totalParticipants}</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Rankings */}
              <div className="md:col-span-2 space-y-4">
                {/* Tabs */}
                <div className="flex gap-2 flex-wrap">
                  {([
                    { id: "wins", label: "Most Wins", icon: Trophy },
                    { id: "rate", label: "Best Rate", icon: Target },
                    { id: "active", label: "Most Active", icon: Activity },
                    { id: "hot", label: "Hot 🔥", icon: Flame },
                  ] as { id: Tab; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        tab === id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {tab === "wins" && "Top by total wins"}
                      {tab === "rate" && "Top by win rate (min. 3 bets)"}
                      {tab === "active" && "Most active bettors"}
                      {tab === "hot" && "Hot in the last 30 days"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {tab === "wins" && <RankingTable entries={stats.rankings.topByWins} metric="wins" />}
                    {tab === "rate" && <RankingTable entries={stats.rankings.topByRate} metric="winRate" />}
                    {tab === "active" && <RankingTable entries={stats.rankings.topByActivity} metric="participated" />}
                    {tab === "hot" && <RankingTable entries={stats.rankings.topHot} metric="recentWins" />}
                  </CardContent>
                </Card>
              </div>

              {/* Side stats */}
              <div className="space-y-4">
                {/* Popular bet types */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Star className="h-4 w-4" /> Popular bet types
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(stats.platform.betTypeCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{betTypeLabels[type] || type}</span>
                            <Badge variant="secondary">{count}</Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Top leagues */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> Top leagues
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {stats.platform.topLeagues.map(({ name, count }) => (
                        <div key={name} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground truncate max-w-[140px]">{name}</span>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Recent resolved bets */}
            {stats.recentResolved.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Recent results
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {stats.recentResolved.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm py-1 border-b border-border/30 last:border-0">
                        <Badge variant="outline" className="text-xs shrink-0">{betTypeLabels[r.betType] || r.betType}</Badge>
                        <span className="text-muted-foreground truncate flex-1">
                          {r.homeTeam} vs {r.awayTeam}
                          {r.league && <span className="text-xs ml-1 opacity-60">· {r.league}</span>}
                        </span>
                        {r.winnerNickname && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Avatar nickname={r.winnerNickname} avatar_url={r.winnerAvatar} size="sm" />
                            <span className="font-medium text-green-400">{r.winnerNickname}</span>
                            <Trophy className="h-3.5 w-3.5 text-yellow-400" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
