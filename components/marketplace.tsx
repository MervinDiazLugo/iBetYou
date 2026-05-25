"use client"

import { useState, useEffect, Suspense, useRef, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Search, Trophy, Users, Clock, Calendar, SlidersHorizontal, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import type { Bet, Event, User } from "@/types"
import Link from "next/link"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useToast } from "@/components/toast"
import { useMode } from "@/components/mode-provider"
import { CreateBetForm } from "@/components/create-bet-form"
import { Countdown } from "@/components/countdown"

interface BetWithDetails extends Bet {
  event: Event
  creator: User
}

const sports = [
  { id: "all", name: "Todos", icon: "🌐" },
  { id: "football", name: "Fútbol", icon: "⚽" },
  { id: "basketball", name: "Basketball", icon: "🏀" },
  { id: "baseball", name: "Béisbol", icon: "⚾" },
]

const betTypeFilters = [
  { id: "all", label: "Todos" },
  { id: "direct", label: "Directa" },
  { id: "exact_score", label: "Score Exacto" },
  { id: "first_scorer", label: "1er Anotador" },
  { id: "half_time", label: "Medio Tiempo" },
]

const amountRanges = [
  { id: "all", label: "Cualquier monto", min: 0, max: Number.POSITIVE_INFINITY },
  { id: "micro", label: "Hasta $10", min: 0, max: 10 },
  { id: "medium", label: "$10 a $50", min: 10, max: 50 },
  { id: "high", label: "Más de $50", min: 50, max: Number.POSITIVE_INFINITY },
]

const SCORE_MARGIN_OPTIONS = [
  { value: "home_1_5",    labelFn: (home: string, _away: string) => `${home} +1–5` },
  { value: "home_6_10",   labelFn: (home: string, _away: string) => `${home} +6–10` },
  { value: "home_11_15",  labelFn: (home: string, _away: string) => `${home} +11–15` },
  { value: "home_16plus", labelFn: (home: string, _away: string) => `${home} +16+` },
  { value: "away_1_5",    labelFn: (_home: string, away: string) => `${away} +1–5` },
  { value: "away_6_10",   labelFn: (_home: string, away: string) => `${away} +6–10` },
  { value: "away_11_15",  labelFn: (_home: string, away: string) => `${away} +11–15` },
  { value: "away_16plus", labelFn: (_home: string, away: string) => `${away} +16+` },
]

const SCORE_MARGIN_ODDS_MAP: Record<string, number> = {
  home_1_5: 4.1, home_6_10: 4.5, home_11_15: 5.7, home_16plus: 4.1,
  away_1_5: 4.1, away_6_10: 4.5, away_11_15: 5.7, away_16plus: 4.1,
}

const TOTAL_RUNS_OPTIONS = [
  { value: "over_7",   label: "Más de 7",    odds: 1.40 },
  { value: "under_7",  label: "Menos de 7",  odds: 2.60 },
  { value: "over_8",   label: "Más de 8",    odds: 1.65 },
  { value: "under_8",  label: "Menos de 8",  odds: 2.02 },
  { value: "over_9",   label: "Más de 9",    odds: 2.27 },
  { value: "under_9",  label: "Menos de 9",  odds: 1.52 },
  { value: "over_10",  label: "Más de 10",   odds: 3.03 },
  { value: "under_10", label: "Menos de 10", odds: 1.30 },
]

function getHouseBetTypes(sport: string): Array<{ id: string; label: string }> {
  if (sport === "football") return [
    { id: "direct", label: "Resultado" },
    { id: "exact_score", label: "Marcador exacto" },
  ]
  if (sport === "basketball") return [
    { id: "direct", label: "Resultado" },
    { id: "score_margin", label: "Margen" },
  ]
  if (sport === "baseball") return [
    { id: "direct", label: "Resultado" },
    { id: "run_line", label: "Run Line" },
    { id: "total_runs", label: "Total carreras" },
    { id: "exact_score", label: "Marcador exacto" },
  ]
  return [{ id: "direct", label: "Resultado" }]
}

function translateAdvice(advice: string | null | undefined): string {
  if (!advice) return ""
  return advice
    .replace(/Double chance\s*:\s*/i, "Doble chance: ")
    .replace(/ or draw/gi, " o empate")
    .replace(/draw or /gi, "empate o ")
    .replace(/ to win$/gi, " gana")
    .replace(/^Win or draw$/i, "Victoria o empate")
    .replace(/^Win$/i, "Victoria")
    .replace(/^Draw$/i, "Empate")
}

function FormDots({ form }: { form: string | null | undefined }) {
  if (!form) return null
  const chars = form.slice(-5).split("")
  return (
    <span className="flex gap-0.5 items-center">
      {chars.map((c, i) => (
        <span
          key={i}
          className={`inline-block w-2 h-2 rounded-full ${c === "W" ? "bg-green-500" : c === "D" ? "bg-gray-400" : "bg-red-500"}`}
          title={c === "W" ? "Victoria" : c === "D" ? "Empate" : "Derrota"}
        />
      ))}
    </span>
  )
}

function PredictionPills({ predictions, homeTeam, awayTeam, size = "sm" }: {
  predictions: NonNullable<NonNullable<import("@/types").Event["metadata"]>["predictions"]>
  homeTeam: string
  awayTeam: string
  size?: "sm" | "xs"
}) {
  const { percent } = predictions
  if (!percent) return null
  const textSize = size === "xs" ? "text-[9px]" : "text-[10px]"
  const padding = size === "xs" ? "px-1 py-0.5" : "px-1.5 py-0.5"
  return (
    <div className="flex gap-1 justify-center flex-wrap">
      <span className={`rounded ${padding} ${textSize} font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/25`}>{percent.home} Local</span>
      <span className={`rounded ${padding} ${textSize} font-semibold bg-gray-500/20 text-gray-300 border border-gray-500/25`}>{percent.draw} Emp.</span>
      <span className={`rounded ${padding} ${textSize} font-semibold bg-orange-500/15 text-orange-300 border border-orange-500/25`}>{percent.away} Visita</span>
    </div>
  )
}

function HomeContent() {
  const createBetCtaClass = "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold shadow-md transition-all duration-200 hover:scale-105 hover:shadow-[0_0_18px_rgba(34,197,94,0.45)] hover:shadow-lg active:scale-95"
  const createBetCtaStyle = { backgroundColor: "#16a34a", color: "#ffffff" }

  const searchParams = useSearchParams()
  const [bets, setBets] = useState<BetWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedSport, setSelectedSport] = useState("all")
  const [user, setUser] = useState<{ id: string; email: string; nickname: string } | null>(null)
  const [activeBets, setActiveBets] = useState<BetWithDetails[]>([])
  const [inProgressBets, setInProgressBets] = useState<BetWithDetails[]>([])
  const [takenBets, setTakenBets] = useState<BetWithDetails[]>([])
  const [balance, setBalance] = useState<{ fantasy: number; real: number }>({
    fantasy: 0,
    real: 0,
  })
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [cloneBetId, setCloneBetId] = useState<string | null>(null)
  const [selectedBetForModal, setSelectedBetForModal] = useState<BetWithDetails | null>(null)
  const [takingBetModal, setTakingBetModal] = useState(false)
  const { showToast } = useToast()
  const { mode } = useMode()
  const [selectedEventForBet, setSelectedEventForBet] = useState<Event | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [betsVisible, setBetsVisible] = useState(20)
  const [eventsPagination, setEventsPagination] = useState<Record<string, {
    data: Event[]
    hasMore: boolean
    loading: boolean
    offset: number
  }>>({
    football: { data: [], hasMore: false, loading: true, offset: 0 },
    basketball: { data: [], hasMore: false, loading: true, offset: 0 },
    baseball: { data: [], hasMore: false, loading: true, offset: 0 },
  })
  const eventsPaginationRef = useRef(eventsPagination)
  const [loadingBets, setLoadingBets] = useState(false)
  const [marketMode, setMarketMode] = useState<"take" | "create">("take")
  const [selectedBetType, setSelectedBetType] = useState("all")
  const [selectedAmountRange, setSelectedAmountRange] = useState("all")
  const [sortBy, setSortBy] = useState<"ending_soon" | "newest" | "highest_amount">("ending_soon")
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [collapsedSports, setCollapsedSports] = useState<Record<string, boolean>>({})
  const [featuredEvents, setFeaturedEvents] = useState<Event[]>([])
  const [selectedLeague, setSelectedLeague] = useState("all")
  const [houseBetModal, setHouseBetModal] = useState<{
    event: Event
    odds: { home: number; draw?: number; away: number } | null
  } | null>(null)
  const [houseBetSelection, setHouseBetSelection] = useState<string | null>(null)
  const [houseBetExactScore, setHouseBetExactScore] = useState("")
  const [houseBetSelectionOdds, setHouseBetSelectionOdds] = useState<number | null>(null)
  const [houseBetType, setHouseBetType] = useState<string>("direct")
  const [houseBetAmount, setHouseBetAmount] = useState("")
  const [houseBetSubmitting, setHouseBetSubmitting] = useState(false)
  const leagueScrollRef = useRef<HTMLDivElement>(null)
  const [leagueScrollState, setLeagueScrollState] = useState({ canLeft: false, canRight: true })
  const sessionTokenRef = useRef<string | null>(null)
  const userIdRef = useRef<string | null>(null)
  const initialLoadDoneRef = useRef(false)
  const takeBetsSectionRef = useRef<HTMLDivElement | null>(null)

  const router = useRouter()
  const supabase = createBrowserSupabaseClient()

  useEffect(() => {
    const create = searchParams.get("create")
    const clone = searchParams.get("clone")

    if (create === "true" || clone) {
      setShowCreateModal(true)
      if (clone) {
        setCloneBetId(clone)
        setSelectedEventForBet(null)
      } else {
        setCloneBetId(null)
        setSelectedEventForBet(null)
      }
      // Clear the URL param
      window.history.replaceState({}, '', '/')
    }
  }, [searchParams])

  const closeCreateModal = () => {
    setShowCreateModal(false)
    setCloneBetId(null)
    setSelectedEventForBet(null)
  }

  const handleTakeBetFromModal = async () => {
    if (!selectedBetForModal || !user) return
    setTakingBetModal(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: HeadersInit = { "Content-Type": "application/json" }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/bets/${selectedBetForModal.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ user_id: user.id }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al tomar la apuesta")
      }
      showToast("¡Apuesta aceptada! 🏆", "win", "Tu dinero está en juego. ¡Mucha suerte!")
      window.dispatchEvent(new Event("wallet:updated"))
      setSelectedBetForModal(null)
      // Refresh open bets list
      const sportParam = selectedSport !== "all" ? `&sport=${selectedSport}` : ""
      const userParam = user ? `&user_id=${user.id}` : ""
      const freshHeaders: HeadersInit = {}
      if (sessionTokenRef.current) freshHeaders.Authorization = `Bearer ${sessionTokenRef.current}`
      fetch(`/api/bets?limit=50${userParam}${sportParam}`, { headers: freshHeaders })
        .then(r => r.json()).then(data => setBets(data.bets || [])).catch(() => {})
    } catch (err: any) {
      showToast(err.message || "Error al tomar la apuesta", "error")
    } finally {
      setTakingBetModal(false)
    }
  }

  // Check auth and load data via API
  useEffect(() => {
    let isMounted = true

    async function loadData() {
      try {
        // Check auth
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser()

        if (authUser) {
          const {
            data: { session },
          } = await supabase.auth.getSession()

          const authHeaders: HeadersInit = {}

          if (session?.access_token) {
            authHeaders.Authorization = `Bearer ${session.access_token}`
            sessionTokenRef.current = session.access_token
          }
          userIdRef.current = authUser.id

          // Get user profile and wallet
          const walletRes = await fetch(`/api/wallet?user_id=${authUser.id}`, {
            headers: authHeaders
          })

          if (walletRes.ok && isMounted) {
            const walletData = await walletRes.json()

            // Admins go to backoffice
            if (walletData.user?.role === 'backoffice_admin') {
              router.replace('/backoffice')
              return
            }

            const nickname = walletData.user?.nickname || authUser.email?.split('@')[0] || 'Usuario'
            if (walletData.user || authUser) {
              setUser({
                id: authUser.id,
                email: authUser.email!,
                nickname: nickname
              })
            }
            if (walletData.wallet && isMounted) {
              setBalance({
                fantasy: walletData.wallet.balance_fantasy,
                real: walletData.wallet.balance_real,
              })
            }
          }

          // Load marketplace (open bets excluding user's own)
          const marketplaceRes = await fetch(`/api/bets?user_id=${authUser.id}&limit=50`, {
            headers: authHeaders
          })
          const marketplaceData = await marketplaceRes.json()
          if (isMounted) {
            setBets(marketplaceData.bets || [])
          }

          // Get user's open bets (created by user, waiting for someone to take)
          const myOpenBetsRes = await fetch(`/api/bets?type=my_open&user_id=${authUser.id}&limit=10`, {
            headers: authHeaders
          })
          const myOpenBetsData = await myOpenBetsRes.json()

          // Get bets the user created that were taken by others (en curso)
          const myCreatedTakenRes = await fetch(`/api/bets?type=my_created_taken&user_id=${authUser.id}&limit=10`, {
            headers: authHeaders
          })
          const myCreatedTakenData = await myCreatedTakenRes.json()

          // Get bets the user took from others (en curso)
          const myTakenBetsRes = await fetch(`/api/bets?type=my_taken&user_id=${authUser.id}&limit=10`, {
            headers: authHeaders
          })
          const myTakenBetsData = await myTakenBetsRes.json()

          // Get all taken bets (for cloning) - exclude user's own bets
          const takenBetsRes = await fetch(`/api/bets?type=taken&user_id=${authUser.id}&limit=50`, {
            headers: authHeaders
          })
          const takenBetsData = await takenBetsRes.json()

          if (isMounted) {
            // Combine open bets + taken bets (user is creator or acceptor of taken bets)
            const allInProgress = [
              ...(myOpenBetsData.bets || []),
              ...(myCreatedTakenData.bets || []),
              ...(myTakenBetsData.bets || [])
            ]
            setInProgressBets(allInProgress)
            setActiveBets(allInProgress)
            setTakenBets(takenBetsData.bets || [])
          }
        } else {
          // Public marketplace for anonymous users
          const marketplaceRes = await fetch(`/api/bets?limit=50`)
          const marketplaceData = await marketplaceRes.json()

          const takenBetsRes = await fetch(`/api/bets?type=taken&limit=50`)
          const takenBetsData = await takenBetsRes.json()

          if (isMounted) {
            setBets(marketplaceData.bets || [])
            setTakenBets(takenBetsData.bets || [])
            setInProgressBets([])
            setActiveBets([])
          }
        }
      } catch (err) {
        console.error('Error loading data:', err)
        // Continue with empty data - loading states will show
        if (isMounted) {
          setBets([])
          setActiveBets([])
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
        initialLoadDoneRef.current = true
      }
    }

    loadData();

    return () => {
      isMounted = false
    }
  }, [])

  // Keep ref in sync with state so loadMoreEvents never reads stale offset
  useEffect(() => { eventsPaginationRef.current = eventsPagination }, [eventsPagination])

  // Debounce search input before hitting the events API
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Load featured events independently of sport filter
  useEffect(() => {
    fetch("/api/events/list?featured=true&limit=16")
      .then(r => r.json())
      .then(data => setFeaturedEvents(Array.isArray(data) ? data : data.events || []))
      .catch(() => {})
  }, [])

  // Debounced exact_score odds fetch for house bet modal
  useEffect(() => {
    if (!houseBetModal || houseBetType !== "exact_score") {
      setHouseBetSelectionOdds(null)
      return
    }
    const valid = /^\d+\s*[-:]\s*\d+$/.test(houseBetExactScore)
    if (!valid) { setHouseBetSelectionOdds(null); return }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/bets/house/odds?eventId=${houseBetModal.event.id}&betType=exact_score&selection=${encodeURIComponent(houseBetExactScore)}`
        )
        if (res.ok) {
          const json = await res.json()
          setHouseBetSelectionOdds(Number(json.odds) || null)
        }
      } catch (_) {}
    }, 600)
    return () => clearTimeout(timer)
  }, [houseBetExactScore, houseBetType, houseBetModal])

  // Load events per sport from API — reset and refetch when search changes
  useEffect(() => {
    const SPORTS_LIST = ["football", "basketball", "baseball"] as const
    const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ""

    setEventsPagination({
      football: { data: [], hasMore: false, loading: true, offset: 0 },
      basketball: { data: [], hasMore: false, loading: true, offset: 0 },
      baseball: { data: [], hasMore: false, loading: true, offset: 0 },
    })

    SPORTS_LIST.forEach(async (sport) => {
      try {
        const res = await fetch(`/api/events/list?sport=${sport}&paginated=1&limit=12${searchParam}`)
        const data = await res.json()
        setEventsPagination((prev) => ({
          ...prev,
          [sport]: { data: data.events || [], hasMore: data.hasMore || false, loading: false, offset: 12 },
        }))
      } catch {
        setEventsPagination((prev) => ({ ...prev, [sport]: { ...prev[sport], loading: false } }))
      }
    })
  }, [debouncedSearch])

  async function loadMoreEvents(sport: string) {
    const current = eventsPaginationRef.current[sport]
    if (!current || current.loading || !current.hasMore) return
    setEventsPagination((prev) => ({ ...prev, [sport]: { ...prev[sport], loading: true } }))
    const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ""
    try {
      const res = await fetch(`/api/events/list?sport=${sport}&paginated=1&limit=12&offset=${current.offset}${searchParam}`)
      const data = await res.json()
      setEventsPagination((prev) => ({
        ...prev,
        [sport]: {
          data: [...prev[sport].data, ...(data.events || [])],
          hasMore: data.hasMore || false,
          loading: false,
          offset: prev[sport].offset + 12,
        },
      }))
    } catch {
      setEventsPagination((prev) => ({ ...prev, [sport]: { ...prev[sport], loading: false } }))
    }
  }

  // Realtime: update event scores/status when cron syncs them
  useEffect(() => {
    const channel = supabase
      .channel('events-live-scores')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        (payload) => {
          const updated = payload.new as any
          setEventsPagination((prev) => {
            const sport = updated.sport as string
            if (!prev[sport]) return prev
            return {
              ...prev,
              [sport]: {
                ...prev[sport],
                data: prev[sport].data.map((e) => e.id === updated.id ? { ...e, ...updated } : e),
              },
            }
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase])

  // Re-fetch marketplace bets when sport filter changes (skip initial render)
  useEffect(() => {
    if (!initialLoadDoneRef.current) return
    setLoadingBets(true)
    const sportParam = selectedSport !== 'all' ? `&sport=${selectedSport}` : ''
    const userParam = userIdRef.current ? `&user_id=${userIdRef.current}` : ''
    const headers: HeadersInit = {}
    if (sessionTokenRef.current) headers.Authorization = `Bearer ${sessionTokenRef.current}`
    fetch(`/api/bets?limit=50${userParam}${sportParam}`, { headers })
      .then(r => r.json())
      .then(data => setBets(data.bets || []))
      .catch(() => {})
      .finally(() => setLoadingBets(false))
  }, [selectedSport])

  const matchesMarketplaceFilters = (bet: BetWithDetails) => {
    const matchesSearch =
      searchTerm === "" ||
      bet.event.home_team.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bet.event.away_team.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesSport = selectedSport === "all" || bet.event.sport === selectedSport
    const matchesBetType = selectedBetType === "all" || bet.bet_type === selectedBetType

    const selectedRange = amountRanges.find((range) => range.id === selectedAmountRange) || amountRanges[0]
    const matchesAmount = bet.amount >= selectedRange.min && bet.amount <= selectedRange.max

    const matchesLeague = selectedLeague === "all" || bet.event?.league === selectedLeague

    return matchesSearch && matchesSport && matchesBetType && matchesAmount && matchesLeague
  }

  const filteredBets = bets.filter((bet) => {
    if (bet.status !== 'open') return false
    if (user && bet.creator_id === user.id) return false
    return matchesMarketplaceFilters(bet)
  })

  const sortedBets = [...filteredBets].sort((a, b) => {
    if (sortBy === "highest_amount") {
      return b.amount - a.amount
    }

    if (sortBy === "newest") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    }

    return new Date(a.event.start_time).getTime() - new Date(b.event.start_time).getTime()
  })

  const opportunities = [...filteredBets]
    .sort((a, b) => {
      const timeA = Math.max(1, new Date(a.event.start_time).getTime() - Date.now())
      const timeB = Math.max(1, new Date(b.event.start_time).getTime() - Date.now())
      const scoreA = a.amount / timeA
      const scoreB = b.amount / timeB
      return scoreB - scoreA
    })
    .slice(0, 3)

  const filteredTakenBets = takenBets.filter((bet) => {
    const eventStart = new Date(bet.event?.start_time)
    if (eventStart < new Date()) return false
    return matchesMarketplaceFilters(bet)
  })

  // Unique leagues derived from loaded events — scoped to selected sport
  const uniqueLeagues = useMemo(() => {
    const allEvents = [
      ...(eventsPagination.football?.data || []),
      ...(eventsPagination.basketball?.data || []),
      ...(eventsPagination.baseball?.data || []),
    ].filter(e => selectedSport === "all" || e.sport === selectedSport)
    const seen = new Set<string>()
    const result: Array<{ league: string; sport: string }> = []
    for (const e of allEvents) {
      if (e.league && !seen.has(e.league)) {
        seen.add(e.league)
        result.push({ league: e.league, sport: e.sport })
      }
    }
    return result
  }, [eventsPagination, selectedSport])

  // Events are already fetched per-sport and search-filtered by the API
  const eventsBySport = {
    football: (selectedSport === "all" || selectedSport === "football")
      ? (eventsPagination.football?.data || []).filter(e => selectedLeague === "all" || e.league === selectedLeague)
      : [],
    basketball: (selectedSport === "all" || selectedSport === "basketball")
      ? (eventsPagination.basketball?.data || []).filter(e => selectedLeague === "all" || e.league === selectedLeague)
      : [],
    baseball: (selectedSport === "all" || selectedSport === "baseball")
      ? (eventsPagination.baseball?.data || []).filter(e => selectedLeague === "all" || e.league === selectedLeague)
      : [],
  }
  const filteredEvents = [...eventsBySport.football, ...eventsBySport.basketball, ...eventsBySport.baseball]

  // Reset league filter when sport changes
  useEffect(() => { setSelectedLeague("all") }, [selectedSport])

  // Reset bets pagination when filters change
  useEffect(() => { setBetsVisible(20) }, [selectedSport, selectedBetType, selectedAmountRange, searchTerm, sortBy, selectedLeague])

  const activeSecondaryFiltersCount =
    (selectedBetType !== "all" ? 1 : 0) +
    (selectedAmountRange !== "all" ? 1 : 0) +
    (sortBy !== "ending_soon" ? 1 : 0)

  const ownOpenBetsCount = user
    ? inProgressBets.filter((bet) => bet.status === 'open' && bet.creator_id === user.id).length
    : 0

  const openHouseBetModal = (event: Event) => {
    const percent = (event.metadata as any)?.predictions?.percent
    let odds: { home: number; draw?: number; away: number } | null = null
    if (percent) {
      const home = parseFloat(String(percent.home).replace("%", "")) / 100
      const away = parseFloat(String(percent.away).replace("%", "")) / 100
      const draw = percent.draw !== undefined ? parseFloat(String(percent.draw).replace("%", "")) / 100 : undefined
      if (home > 0 && away > 0) {
        odds = {
          home: parseFloat((1 / (home * 1.10)).toFixed(4)),
          away: parseFloat((1 / (away * 1.10)).toFixed(4)),
          ...(draw !== undefined && draw > 0 ? { draw: parseFloat((1 / (draw * 1.10)).toFixed(4)) } : {}),
        }
      }
    }
    setHouseBetModal({ event, odds })
    setHouseBetSelection(null)
    setHouseBetExactScore("")
    setHouseBetAmount("")
    setHouseBetType("direct")
  }

  const getActiveHouseOdds = (): number | null => {
    if (!houseBetModal || !houseBetSelection) return null
    if (houseBetType === "direct" && houseBetModal.odds) {
      if (houseBetSelection === "home") return houseBetModal.odds.home
      if (houseBetSelection === "away") return houseBetModal.odds.away
      if (houseBetSelection === "draw") return houseBetModal.odds.draw ?? null
    }
    if (houseBetType === "score_margin") return SCORE_MARGIN_ODDS_MAP[houseBetSelection] ?? null
    if (houseBetType === "run_line") return 1.82
    if (houseBetType === "total_runs") return TOTAL_RUNS_OPTIONS.find(o => o.value === houseBetSelection)?.odds ?? null
    if (houseBetType === "exact_score") return houseBetSelectionOdds
    return null
  }

  const getSportIcon = (sport: string) => {
    switch (sport) {
      case "football":
        return "⚽"
      case "basketball":
        return "🏀"
      case "baseball":
        return "⚾"
      default:
        return "🏆"
    }
  }

  const getSportLabel = (sportId: string) => {
    const sport = sports.find((item) => item.id === sportId)
    return sport?.name || sportId
  }

  const getRiskBadge = (bet: BetWithDetails) => {
    if (bet.bet_type === "exact_score" && bet.multiplier >= 3) {
      return { label: "Riesgo Alto", className: "bg-red-500/10 text-red-500 border-red-500/20" }
    }

    if (bet.bet_type === "exact_score" || bet.bet_type === "first_scorer") {
      return { label: "Riesgo Medio", className: "bg-amber-500/10 text-amber-500 border-amber-500/20" }
    }

    return { label: "Riesgo Bajo", className: "bg-green-500/10 text-green-500 border-green-500/20" }
  }

  const getPostedAgo = (createdAt: string) => {
    const diffMs = Date.now() - new Date(createdAt).getTime()
    const diffMinutes = Math.floor(diffMs / (1000 * 60))

    if (diffMinutes < 1) return "Publicado hace segundos"
    if (diffMinutes < 60) return `Publicado hace ${diffMinutes} min`

    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `Publicado hace ${diffHours} h`

    const diffDays = Math.floor(diffHours / 24)
    return `Publicado hace ${diffDays} d`
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <Dialog
        open={showCreateModal}
        onOpenChange={(open) => {
          if (!open) {
            closeCreateModal()
            return
          }
          setShowCreateModal(true)
        }}
      >
        <DialogContent onClose={closeCreateModal}>
          <CreateBetForm onClose={closeCreateModal} cloneBetId={cloneBetId} initialEvent={selectedEventForBet} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedBetForModal} onOpenChange={(open) => { if (!open) setSelectedBetForModal(null) }}>
        <DialogContent onClose={() => setSelectedBetForModal(null)}>
          {selectedBetForModal && (() => {
            const bet = selectedBetForModal
            const betTypeLabels: Record<string, string> = {
              direct: "Directa", exact_score: "Score Exacto",
              first_scorer: "1er Anotador", half_time: "Medio Tiempo",
            }
            const potentialWin = bet.amount * bet.multiplier + bet.amount
            const isOwn = user?.id === bet.creator_id
            return (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge variant="secondary" className="text-[10px]">{getSportIcon(bet.event.sport)} {bet.event.league}</Badge>
                    <Badge variant="outline" className={`text-[10px] ${(bet as any).mode === "real" ? "border-green-500/40 text-green-400" : "border-violet-500/40 text-violet-400"}`}>
                      {(bet as any).mode === "real" ? "💵 Real" : "🎮 Fantasy"}
                    </Badge>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {new Date(bet.event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 my-3">
                    <div className="flex-1 text-center">
                      {bet.event.home_logo
                        ? <img src={bet.event.home_logo} alt={bet.event.home_team} className="w-12 h-12 mx-auto mb-1 object-contain" />
                        : <div className="w-12 h-12 mx-auto mb-1 rounded-full bg-secondary flex items-center justify-center font-bold">{bet.event.home_team.slice(0,1)}</div>
                      }
                      <div className="text-sm font-bold leading-tight">{bet.event.home_team}</div>
                    </div>
                    <div className="text-base font-bold text-muted-foreground">VS</div>
                    <div className="flex-1 text-center">
                      {bet.event.away_logo
                        ? <img src={bet.event.away_logo} alt={bet.event.away_team} className="w-12 h-12 mx-auto mb-1 object-contain" />
                        : <div className="w-12 h-12 mx-auto mb-1 rounded-full bg-secondary flex items-center justify-center font-bold">{bet.event.away_team.slice(0,1)}</div>
                      }
                      <div className="text-sm font-bold leading-tight">{bet.event.away_team}</div>
                    </div>
                  </div>
                </div>

                <div className="bg-primary/10 rounded-lg p-3 border border-primary/20 text-center">
                  <div className="text-xs text-muted-foreground mb-1">{betTypeLabels[bet.bet_type]} · @{bet.creator?.nickname} apuesta por</div>
                  <div className="text-base font-bold text-primary">{bet.creator_selection}</div>
                  {bet.acceptor_selection && <div className="text-xs text-muted-foreground mt-1">Tú tomarías: <span className="font-semibold text-foreground">{bet.acceptor_selection}</span></div>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-secondary/60 rounded-lg p-3 text-center border border-border/50">
                    <div className="text-xs text-muted-foreground">Monto a igualar</div>
                    <div className="text-lg font-bold text-primary">{formatCurrency(bet.amount)}</div>
                  </div>
                  <div className="bg-green-500/10 rounded-lg p-3 text-center border border-green-500/30">
                    <div className="text-xs text-muted-foreground">Premio total</div>
                    <div className="text-lg font-bold text-green-500">{formatCurrency(potentialWin)}</div>
                  </div>
                </div>

                {bet.bet_type === "exact_score" && bet.multiplier > 1 && (
                  <div className="text-center">
                    <Badge className="bg-green-500/20 text-green-500 border-green-500/30">⚡ Multiplicador x{bet.multiplier}</Badge>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link href={`/bet/${bet.id}`}>Ver detalles</Link>
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={takingBetModal || isOwn || !user}
                    onClick={handleTakeBetFromModal}
                  >
                    {takingBetModal ? "Aceptando..." : isOwn ? "Es tu apuesta" : !user ? "Inicia sesión" : "Tomar apuesta"}
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      <main className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">Marketplace de Apuestas</h1>
          <p className="text-muted-foreground">
            Encuentra apuestas y retos de otros usuarios
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          <Card
            className={`cursor-pointer border-2 transition-all ${marketMode === "take" ? "border-primary" : "border-border"}`}
            onClick={() => {
              setMarketMode("take")
              requestAnimationFrame(() => {
                takeBetsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              })
            }}
          >
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Quiero tomar apuestas</h3>
                <Badge variant={marketMode === "take" ? "default" : "outline"}>Modo Activo</Badge>
              </div>
              <p className="text-sm text-muted-foreground">Explora rápido, compara riesgo y entra en oportunidades que vencen pronto.</p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer border-2 transition-all ${marketMode === "create" ? "border-primary" : "border-border"}`} onClick={() => setMarketMode("create")}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Quiero crear apuestas</h3>
                <Button
                  size="sm"
                  className={createBetCtaClass}
                  style={createBetCtaStyle}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!user) {
                      window.location.href = '/login'
                      return
                    }
                    setShowCreateModal(true)
                  }}
                >
                  Crear ahora
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">Publica una apuesta clara y gana visibilidad con mejores señales para tomadores.</p>
            </CardContent>
          </Card>
        </div>

        {marketMode === "take" && opportunities.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-5 w-5 text-amber-500" />
              <h2 className="text-lg sm:text-xl font-bold">Oportunidades del día</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {opportunities.map((bet) => (
                <Card key={`opportunity-${bet.id}`} className="border-amber-500/30">
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="text-[10px]">{getSportIcon(bet.event.sport)} {bet.event.league}</Badge>
                      <div className="flex gap-1">
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">Vence pronto</Badge>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${(bet as any).mode === "real" ? "border-green-500/40 text-green-400" : "border-violet-500/40 text-violet-400"}`}
                        >
                          {(bet as any).mode === "real" ? "💵" : "🎮"}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-sm font-semibold truncate">{bet.event.home_team} vs {bet.event.away_team}</div>
                    <div className="text-xs text-muted-foreground">{getPostedAgo(bet.created_at)}</div>
                    <div className="text-xs">Apuesta: <span className="font-semibold text-primary">{formatCurrency(bet.amount)}</span></div>
                    <Button size="sm" className="w-full" onClick={() => {
                      if (!user) { window.location.href = "/login"; return }
                      setSelectedBetForModal(bet)
                    }}>
                      Ver y tomar
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="space-y-3 mb-6">
          {/* Search + Filters Toggle */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar equipos o eventos..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-10 gap-2"
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filtros{activeSecondaryFiltersCount > 0 ? ` (${activeSecondaryFiltersCount})` : ""}
            </Button>
          </div>

          {/* Primary Filter */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Deporte</span>
              {sports.map((sport) => (
                <Button
                  key={sport.id}
                  variant={selectedSport === sport.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedSport(sport.id)}
                  className="whitespace-nowrap text-xs h-8 gap-1.5"
                >
                  <span>{sport.icon}</span>
                  <span>{sport.name}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* League tabs */}
          {uniqueLeagues.length > 0 && (
            <div className="relative flex items-center gap-1">
              {/* Left arrow — desktop only */}
              <button
                type="button"
                aria-label="Scroll izquierda"
                onClick={() => {
                  leagueScrollRef.current?.scrollBy({ left: -240, behavior: "smooth" })
                }}
                className={`hidden md:flex shrink-0 items-center justify-center w-7 h-7 rounded-full border border-border bg-background hover:bg-secondary transition-colors ${leagueScrollState.canLeft ? "opacity-100" : "opacity-30 pointer-events-none"}`}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <div
                ref={leagueScrollRef}
                className="flex gap-1.5 overflow-x-auto pb-1 flex-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                onScroll={(e) => {
                  const el = e.currentTarget
                  setLeagueScrollState({
                    canLeft: el.scrollLeft > 4,
                    canRight: el.scrollLeft < el.scrollWidth - el.clientWidth - 4,
                  })
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedLeague("all")}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors whitespace-nowrap border ${
                    selectedLeague === "all"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}
                >
                  🌐 Todas las ligas
                </button>
                {uniqueLeagues.map(({ league, sport }) => (
                  <button
                    key={league}
                    type="button"
                    onClick={() => setSelectedLeague(league)}
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors whitespace-nowrap border ${
                      selectedLeague === league
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                    }`}
                  >
                    {getSportIcon(sport)} {league}
                  </button>
                ))}
              </div>

              {/* Right arrow — desktop only */}
              <button
                type="button"
                aria-label="Scroll derecha"
                onClick={() => {
                  leagueScrollRef.current?.scrollBy({ left: 240, behavior: "smooth" })
                }}
                className={`hidden md:flex shrink-0 items-center justify-center w-7 h-7 rounded-full border border-border bg-background hover:bg-secondary transition-colors ${leagueScrollState.canRight ? "opacity-100" : "opacity-30 pointer-events-none"}`}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {activeSecondaryFiltersCount > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {selectedBetType !== "all" && <Badge variant="secondary">{betTypeFilters.find((type) => type.id === selectedBetType)?.label}</Badge>}
              {selectedAmountRange !== "all" && <Badge variant="secondary">{amountRanges.find((range) => range.id === selectedAmountRange)?.label}</Badge>}
              {sortBy !== "ending_soon" && (
                <Badge variant="secondary">
                  {sortBy === "newest" ? "Recientes" : "Mayor monto"}
                </Badge>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setSelectedBetType("all")
                  setSelectedAmountRange("all")
                  setSortBy("ending_soon")
                }}
              >
                Limpiar filtros
              </Button>
            </div>
          )}

          {showAdvancedFilters && (
            <Card>
              <CardContent className="py-3 space-y-3">
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {betTypeFilters.map((type) => (
                    <Button
                      key={`bet-type-${type.id}`}
                      variant={selectedBetType === type.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedBetType(type.id)}
                      className="whitespace-nowrap text-xs h-8"
                    >
                      {type.label}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 pb-1">
                  {amountRanges.map((range) => (
                    <Button
                      key={`amount-range-${range.id}`}
                      variant={selectedAmountRange === range.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedAmountRange(range.id)}
                      className="whitespace-nowrap text-xs h-8"
                    >
                      {range.label}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 pb-1">
                  <Button size="sm" variant={sortBy === "ending_soon" ? "default" : "outline"} onClick={() => setSortBy("ending_soon")} className="text-xs h-8">⏱ Vencen pronto</Button>
                  <Button size="sm" variant={sortBy === "newest" ? "default" : "outline"} onClick={() => setSortBy("newest")} className="text-xs h-8">🆕 Recientes</Button>
                  <Button size="sm" variant={sortBy === "highest_amount" ? "default" : "outline"} onClick={() => setSortBy("highest_amount")} className="text-xs h-8">💰 Mayor monto</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Eventos Destacados */}
        {(() => {
          const visibleFeatured = selectedSport === "all"
            ? featuredEvents
            : featuredEvents.filter(e => e.sport === selectedSport)
          return visibleFeatured.length > 0 ? (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">⭐</span>
              <h2 className="text-lg sm:text-xl font-bold">Eventos Destacados</h2>
              <Badge className="bg-amber-400/20 text-amber-400 border-amber-400/40 text-xs" variant="outline">
                {visibleFeatured.length}
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleFeatured.map((event) => (
                <Card
                  key={`featured-${event.id}`}
                  className="overflow-hidden border-amber-400/50 bg-amber-950/10 hover:border-amber-400/90 hover:shadow-[0_0_24px_rgba(251,191,36,0.12)] transition-all"
                >
                  <div className="h-1 bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-500" />
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <Badge className="bg-amber-400/20 text-amber-300 border-amber-400/40 text-[10px] px-1.5 py-0.5">⭐ Destacado</Badge>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 truncate">
                        {getSportIcon(event.sport)} {event.league}
                      </Badge>
                      <span className="ml-auto text-[10px] text-amber-400 font-semibold whitespace-nowrap">
                        {new Date(event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 my-3">
                      <div className="flex-1 text-center">
                        {event.home_logo ? (
                          <img src={event.home_logo} alt={event.home_team} className="w-10 h-10 mx-auto mb-1 object-contain" />
                        ) : (
                          <div className="w-10 h-10 mx-auto mb-1 rounded-full bg-secondary flex items-center justify-center text-sm font-bold">
                            {event.home_team.slice(0, 1)}
                          </div>
                        )}
                        <div className="text-xs font-bold leading-tight">{event.home_team}</div>
                      </div>
                      <div className="text-sm font-bold text-amber-400">VS</div>
                      <div className="flex-1 text-center">
                        {event.away_logo ? (
                          <img src={event.away_logo} alt={event.away_team} className="w-10 h-10 mx-auto mb-1 object-contain" />
                        ) : (
                          <div className="w-10 h-10 mx-auto mb-1 rounded-full bg-secondary flex items-center justify-center text-sm font-bold">
                            {event.away_team.slice(0, 1)}
                          </div>
                        )}
                        <div className="text-xs font-bold leading-tight">{event.away_team}</div>
                      </div>
                    </div>

                    {event.metadata?.predictions?.percent && (
                      <div className="mt-2 space-y-2" onClick={e => e.stopPropagation()}>
                        <div className="text-[10px] text-muted-foreground font-medium text-center">🤖 Predicción</div>
                        <div className="flex gap-1.5">
                          <div className="flex-1 rounded-md bg-blue-500/10 border border-blue-500/20 py-1.5 text-center">
                            <div className="text-[10px] text-muted-foreground leading-none mb-0.5">Local</div>
                            <div className="text-sm font-bold text-blue-300">{event.metadata.predictions.percent.home}</div>
                            {event.metadata.predictions.home_league_form && (
                              <div className="flex gap-0.5 justify-center mt-1">
                                <FormDots form={event.metadata.predictions.home_league_form} />
                              </div>
                            )}
                          </div>
                          {event.metadata.predictions.percent.draw && (
                          <div className="flex-1 rounded-md bg-gray-500/10 border border-gray-500/20 py-1.5 text-center">
                            <div className="text-[10px] text-muted-foreground leading-none mb-0.5">Empate</div>
                            <div className="text-sm font-bold text-gray-300">{event.metadata.predictions.percent.draw}</div>
                          </div>
                          )}
                          <div className="flex-1 rounded-md bg-orange-500/10 border border-orange-500/20 py-1.5 text-center">
                            <div className="text-[10px] text-muted-foreground leading-none mb-0.5">Visita</div>
                            <div className="text-sm font-bold text-orange-300">{event.metadata.predictions.percent.away}</div>
                            {event.metadata.predictions.away_league_form && (
                              <div className="flex gap-0.5 justify-center mt-1">
                                <FormDots form={event.metadata.predictions.away_league_form} />
                              </div>
                            )}
                          </div>
                        </div>
                        {event.metadata.predictions.advice && (
                          <p className="text-xs text-center text-amber-300/80 leading-snug">
                            💡 {translateAdvice(event.metadata.predictions.advice)}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-8"
                        onClick={() => {
                          if (!user) { window.location.href = '/login'; return }
                          setSelectedEventForBet(event)
                          setShowCreateModal(true)
                        }}
                      >
                        🤝 Apostar P2P
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-8 border-yellow-500/60 text-yellow-500 hover:bg-yellow-500/10"
                        onClick={() => {
                          if (!user) { window.location.href = '/login'; return }
                          openHouseBetModal(event)
                        }}
                      >
                        🏦 Vs. la casa
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          ) : null
        })()}

        {/* Eventos Disponibles */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-5 w-5 text-blue-400" />
            <h2 className="text-lg sm:text-xl font-bold">Eventos Disponibles</h2>
            <Badge variant="outline" className="ml-2 text-xs">
              {filteredEvents.length} evento{filteredEvents.length !== 1 ? 's' : ''}
            </Badge>
          </div>

          {filteredEvents.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center">
                <p className="text-muted-foreground">No hay eventos disponibles para este filtro</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {(selectedSport === "all"
                ? ["football", "basketball", "baseball"]
                : [selectedSport]
              ).map((sportId) => {
                const sportEvents = eventsBySport[sportId as keyof typeof eventsBySport] || []
                if (sportEvents.length === 0) return null

                const visibleEvents = sportEvents
                const hasMore = eventsPagination[sportId]?.hasMore || false
                const sportLoading = eventsPagination[sportId]?.loading || false

                return (
                  <div key={`event-group-${sportId}`}>
                    <button
                      type="button"
                      className="flex items-center gap-2 mb-3 w-full text-left hover:opacity-80 transition-opacity"
                      onClick={() =>
                        setCollapsedSports((prev) => ({ ...prev, [sportId]: !prev[sportId] }))
                      }
                    >
                      <h3 className="text-base font-semibold">
                        {getSportIcon(sportId)} {getSportLabel(sportId)}
                      </h3>
                      <Badge variant="secondary" className="text-xs">
                        {sportEvents.length}
                      </Badge>
                      <span className="ml-auto text-muted-foreground">
                        {collapsedSports[sportId] ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                      </span>
                    </button>

                    {!collapsedSports[sportId] && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sportLoading && visibleEvents.length === 0 && [...Array(6)].map((_, i) => (
                        <div key={`skel-${sportId}-${i}`} className="rounded-lg border border-border animate-pulse h-28 bg-muted/30" />
                      ))}
                      {visibleEvents.map((event) => (
                        <Card
                          key={event.id}
                          className={`overflow-hidden hover:shadow-md transition-all cursor-pointer h-full flex flex-col group ${
                            event.featured
                              ? "border-amber-400/50 hover:border-amber-400/80"
                              : "hover:border-blue-500/50"
                          }`}
                          onClick={() => {
                            if (!user) {
                              window.location.href = '/login'
                              return
                            }
                            setSelectedEventForBet(event)
                            setShowCreateModal(true)
                          }}
                        >
                          <div className={`h-0.5 bg-gradient-to-r ${event.featured ? "from-amber-400 to-yellow-300" : "from-blue-500 to-cyan-400"}`} />
                          <CardContent className="pt-3 pb-3 space-y-2 px-3 flex-1 flex flex-col justify-center">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <Badge
                                variant="secondary"
                                className={`text-[10px] px-1.5 py-0.5 leading-none truncate ${event.featured ? "bg-amber-400/15 text-amber-400 border-amber-400/30" : ""}`}
                              >
                                {event.featured ? "⭐ " : ""}{getSportIcon(event.sport)} {event.league}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {new Date(event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex-1 text-center">
                                {event.home_logo ? (
                                  <img src={event.home_logo} alt={event.home_team} className="w-5 h-5 mx-auto mb-0.5 object-contain" />
                                ) : (
                                  <div className="w-5 h-5 mx-auto mb-0.5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold">
                                    {event.home_team.slice(0, 1)}
                                  </div>
                                )}
                                <div className="text-[11px] font-semibold leading-tight truncate">{event.home_team}</div>
                              </div>
                              <div className="text-[10px] font-bold text-muted-foreground">VS</div>
                              <div className="flex-1 text-center">
                                {event.away_logo ? (
                                  <img src={event.away_logo} alt={event.away_team} className="w-5 h-5 mx-auto mb-0.5 object-contain" />
                                ) : (
                                  <div className="w-5 h-5 mx-auto mb-0.5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold">
                                    {event.away_team.slice(0, 1)}
                                  </div>
                                )}
                                <div className="text-[11px] font-semibold leading-tight truncate">{event.away_team}</div>
                              </div>
                            </div>

                            <div className="text-center text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                              Haz clic para crear apuesta
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>}

                    {!collapsedSports[sportId] && (hasMore || sportLoading) && (
                      <div className="mt-3 flex justify-center">
                        <Button
                          variant="outline"
                          disabled={sportLoading}
                          onClick={() => loadMoreEvents(sportId)}
                        >
                          {sportLoading ? "Cargando..." : `Mostrar más ${getSportLabel(sportId).toLowerCase()}`}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 bg-muted rounded w-1/2" />
                </CardHeader>
                <CardContent>
                  <div className="h-20 bg-muted rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Apuestas Disponibles */}
        {!loading && (
          <>
            <div ref={takeBetsSectionRef} className="flex items-center gap-2 mb-4">
              <Trophy className="h-5 w-5 text-primary" />
              <h2 className="text-lg sm:text-xl font-bold">Apuestas Disponibles</h2>
            </div>
            {sortedBets.length === 0 ? (
              <div className="text-center py-12">
                <Trophy className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No hay apuestas disponibles</h3>
                {ownOpenBetsCount > 0 ? (
                  <p className="text-muted-foreground mb-4">
                    Tienes {ownOpenBetsCount} apuesta{ownOpenBetsCount > 1 ? 's' : ''} abierta{ownOpenBetsCount > 1 ? 's' : ''}. El marketplace solo muestra apuestas de otros usuarios.
                  </p>
                ) : (
                  <p className="text-muted-foreground mb-4">
                    Sé el primero en crear una apuesta
                  </p>
                )}
                <Link href="/create" className={createBetCtaClass} style={createBetCtaStyle}>
                  Crear Apuesta
                </Link>
              </div>
            ) : (
              <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {sortedBets.slice(0, betsVisible).map((bet) => {
                  const betTypeLabels: Record<string, string> = {
                    direct: "Directa",
                    exact_score: "Score Exacto",
                    first_scorer: "1er Anotador",
                    half_time: "Medio Tiempo",
                  }
                  const potentialWin = bet.amount * bet.multiplier + bet.amount
                  const riskBadge = getRiskBadge(bet)

                  return (
                  <Card
                    key={bet.id}
                    className="hover:border-primary/60 hover:shadow-lg transition-all cursor-pointer overflow-hidden flex flex-col"
                  >
                    <div className="h-0.5 bg-gradient-to-r from-primary to-green-500" />

                    <CardHeader className="pb-2 pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="secondary" className="text-[10px] py-0.5 px-1.5 bg-primary/10 text-primary border-primary/20 shrink-0">
                          {getSportIcon(bet.event.sport)}
                        </Badge>
                        <Countdown
                          targetDate={bet.event.start_time}
                          className="text-[9px] bg-secondary/80 px-1.5 py-0.5 rounded-full shrink-0"
                          expiredLabel="Iniciado"
                        />
                      </div>
                    </CardHeader>

                    <CardContent className="pb-2 space-y-2 flex-1">
                      <div className="text-xs font-semibold text-muted-foreground mb-1">{bet.event.league}</div>

                      <div className="flex items-center justify-between gap-1">
                        <div className="flex-1 text-center">
                          {bet.event.home_logo ? (
                            <img
                              src={bet.event.home_logo}
                              alt={bet.event.home_team}
                              className="w-6 h-6 mx-auto mb-0.5 object-contain"
                            />
                          ) : (
                            <div className="w-6 h-6 mx-auto mb-0.5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold">
                              {bet.event.home_team.slice(0, 1)}
                            </div>
                          )}
                          <div className="font-semibold text-[11px] truncate">{bet.event.home_team}</div>
                        </div>
                        <div className="text-[10px] font-bold text-muted-foreground">VS</div>
                        <div className="flex-1 text-center">
                          {bet.event.away_logo ? (
                            <img
                              src={bet.event.away_logo}
                              alt={bet.event.away_team}
                              className="w-6 h-6 mx-auto mb-0.5 object-contain"
                            />
                          ) : (
                            <div className="w-6 h-6 mx-auto mb-0.5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold">
                              {bet.event.away_team.slice(0, 1)}
                            </div>
                          )}
                          <div className="font-semibold text-[11px] truncate">{bet.event.away_team}</div>
                        </div>
                      </div>


                      <div className="bg-primary/10 rounded p-2 border border-primary/20">
                        <div className="text-[9px] text-muted-foreground text-center mb-0.5">Apuesta</div>
                        <div className="text-sm font-bold text-center text-primary truncate">
                          {bet.creator_selection}
                        </div>
                      </div>

                      <div className="flex gap-1.5 flex-wrap justify-center">
                        <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">
                          {betTypeLabels[bet.bet_type]}
                        </Badge>
                        <Badge variant="outline" className={`text-[9px] ${riskBadge.className}`}>
                          {riskBadge.label}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-[9px] ${(bet as any).mode === "real" ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-violet-500/40 text-violet-400 bg-violet-500/10"}`}
                        >
                          {(bet as any).mode === "real" ? "💵 Real" : "🎮 Fantasy"}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                        <div className="bg-secondary/60 rounded p-1.5 text-center border border-border/50">
                          <div className="text-muted-foreground">Monto</div>
                          <div className="font-bold text-primary text-xs">{formatCurrency(bet.amount)}</div>
                        </div>
                        <div className="bg-green-500/10 rounded p-1.5 text-center border border-green-500/30">
                          <div className="text-muted-foreground">Premio</div>
                          <div className="font-bold text-green-500 text-xs">{formatCurrency(potentialWin)}</div>
                        </div>
                      </div>

                      {bet.bet_type === "exact_score" && bet.multiplier > 1 && (
                        <div className="text-center">
                          <Badge className="bg-green-500/20 text-green-500 border-green-500/30 text-[9px]">
                            ⚡x{bet.multiplier}
                          </Badge>
                        </div>
                      )}
                    </CardContent>

                    <CardFooter className="pt-2 pb-2 bg-secondary/20 border-t border-border/50">
                      <div className="flex flex-col gap-1.5 w-full">
                        <div className="text-[9px] text-center text-muted-foreground">{getPostedAgo(bet.created_at)} · @{bet.creator?.nickname}</div>
                        <div className="flex gap-1.5">
                          <Button variant="outline" size="sm" className="flex-1 text-xs h-7" onClick={() => {
                            setCloneBetId(bet.id)
                            setSelectedEventForBet(null)
                            setShowCreateModal(true)
                          }}>
                            Clonar
                          </Button>
                          <Button size="sm" className="flex-1 text-xs h-7 bg-primary hover:bg-primary/90" onClick={() => {
                            if (!user) { window.location.href = "/login"; return }
                            setSelectedBetForModal(bet)
                          }}>
                            Tomar
                          </Button>
                        </div>
                      </div>
                    </CardFooter>
                  </Card>
                )})}
              </div>
              {sortedBets.length > betsVisible && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => setBetsVisible((prev) => prev + 20)}>
                    Cargar más apuestas ({sortedBets.length - betsVisible} restantes)
                  </Button>
                </div>
              )}
              </>
            )}
          </>
        )}

        {/* Apuestas Tomadas - Para clonar */}
        {!loading && filteredTakenBets.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-4 mt-8">
              <Trophy className="h-5 w-5 text-orange-500" />
              <h2 className="text-lg sm:text-xl font-bold">Apuestas Tomadas</h2>
            </div>
            <p className="text-muted-foreground text-sm mb-4">
              Estas apuestas ya fueron tomadas. ¡Puedes clonar una para crear la tuya!
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filteredTakenBets.map((bet) => {
                const betTypeLabels: Record<string, string> = {
                  direct: "Directa",
                  exact_score: "Score Exacto",
                  first_scorer: "1er Anotador",
                  half_time: "Medio Tiempo",
                }
                const potentialWin = bet.amount * bet.multiplier + bet.amount

                return (
                <Card
                  key={bet.id}
                  className="hover:border-orange-500/50 hover:shadow-lg transition-all cursor-pointer bg-gradient-to-b from-card to-card/80 overflow-hidden opacity-80"
                >
                  <div className="h-1 bg-gradient-to-r from-orange-500 to-red-500" />

                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-[10px] py-0.5 px-2 bg-orange-500/10 text-orange-500 border-orange-500/20">
                        {getSportIcon(bet.event.sport)} {bet.event.league}
                      </Badge>
                      <Countdown
                        targetDate={bet.event.start_time}
                        className="text-[10px] bg-secondary/80 px-2 py-1 rounded-full"
                        expiredLabel="Evento iniciado"
                      />
                    </div>
                  </CardHeader>

                  <CardContent className="pb-2 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 text-center">
                        <div className="font-bold text-xs truncate max-w-[80px] mx-auto">{bet.event.home_team}</div>
                      </div>
                      <div className="px-3 py-1 bg-secondary/50 rounded-lg">
                        <span className="text-xs font-bold text-muted-foreground">VS</span>
                      </div>
                      <div className="flex-1 text-center">
                        <div className="font-bold text-xs truncate max-w-[80px] mx-auto">{bet.event.away_team}</div>
                      </div>
                    </div>

                    <div className="bg-gradient-to-r from-orange-500/20 via-orange-500/10 to-red-500/20 rounded-lg p-3 border border-orange-500/20">
                      <div className="text-[9px] text-muted-foreground text-center uppercase tracking-wider mb-1">A favor de</div>
                      <div className="text-base font-bold text-center bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">
                        {bet.creator_selection}
                      </div>
                    </div>

                    <div className="flex items-center justify-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-500">
                        {betTypeLabels[bet.bet_type] || bet.bet_type}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${(bet as any).mode === "real" ? "border-green-500/40 text-green-400 bg-green-500/10" : "border-violet-500/40 text-violet-400 bg-violet-500/10"}`}
                      >
                        {(bet as any).mode === "real" ? "💵 Real" : "🎮 Fantasy"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-secondary/60 rounded-lg p-2 text-center border border-border/50">
                        <div className="text-[9px] text-muted-foreground uppercase">Monto</div>
                        <div className="font-bold text-orange-500 text-sm">{formatCurrency(bet.amount)}</div>
                      </div>
                      <div className="bg-gradient-to-br from-orange-500/20 to-orange-500/5 rounded-lg p-2 text-center border border-orange-500/30">
                        <div className="text-[9px] text-orange-400 uppercase">Premio</div>
                        <div className="font-bold text-orange-400 text-sm">{formatCurrency(potentialWin)}</div>
                      </div>
                    </div>
                  </CardContent>

                  <CardFooter className="pt-3 pb-3 bg-secondary/20 border-t border-border/50">
                    <div className="flex flex-col gap-2 w-full">
                      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        <span>@{bet.creator?.nickname}</span>
                      </div>
                      <Button variant="outline" size="sm" className="w-full text-xs h-8 border-orange-500/30 hover:bg-orange-500/10" onClick={() => {
                        setCloneBetId(bet.id)
                        setSelectedEventForBet(null)
                        setShowCreateModal(true)
                      }}>
                        Clonar Apuesta
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              )})}
            </div>
          </>
        )}

        {/* Mis Apuestas en Curso */}
        {!loading && user && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-5 w-5 text-orange-500" />
              <h2 className="text-lg sm:text-xl font-bold">Mis Apuestas en Curso</h2>
            </div>
            {inProgressBets.filter(bet => ((bet as any).mode ?? "fantasy") === mode).length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {inProgressBets.filter(bet => ((bet as any).mode ?? "fantasy") === mode).slice(0, 5).map((bet) => {
                  const potentialWin = bet.amount * bet.multiplier + bet.amount
                  const betTypeLabels: Record<string, string> = {
                    direct: "Directa",
                    exact_score: "Resultado Exacto",
                    first_scorer: "Primer Anotador",
                    half_time: "Medio Tiempo",
                  }
                  return (
                    <Card key={bet.id} className="border-orange-500/30 overflow-hidden bg-gradient-to-b from-card to-card/70">
                      <CardHeader className="pb-2 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="secondary" className="text-[10px] py-0.5 px-2 max-w-[75%] truncate leading-none">
                            {getSportIcon(bet.event.sport)} {bet.event.league}
                          </Badge>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className="text-[10px] py-0.5 px-2 bg-orange-500/10 leading-none">
                              {bet.status === 'taken' ? 'En curso' : 'Abierta'}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] py-0.5 px-2 leading-none">
                              {betTypeLabels[bet.bet_type] || bet.bet_type}
                            </Badge>
                            {(bet as any).mode === "real" ? (
                              <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] py-0.5 px-2 leading-none">Real iBY</Badge>
                            ) : (
                              <Badge className="bg-blue-500/15 text-blue-400 border border-blue-500/30 text-[10px] py-0.5 px-2 leading-none">Fantasy</Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-sm leading-snug font-semibold text-center px-1">
                          <span className="block truncate">{bet.event.home_team}</span>
                          <span className="text-xs text-muted-foreground font-normal">vs</span>
                          <span className="block truncate">{bet.event.away_team}</span>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pb-3">
                        <div className="rounded-lg border border-border bg-secondary/40 p-2">
                          <div className="text-[10px] text-muted-foreground mb-1">Tu selección</div>
                          <div className="text-xs font-semibold text-primary leading-snug truncate">
                            {bet.creator_selection}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div className="rounded-md bg-secondary/30 px-2 py-1.5">
                            <div className="text-muted-foreground mb-0.5">Apuesta</div>
                            <div className="text-foreground font-semibold text-xs">{formatCurrency(bet.amount)}</div>
                          </div>
                          <div className="rounded-md bg-green-500/10 px-2 py-1.5">
                            <div className="text-muted-foreground mb-0.5">Potencial</div>
                            <div className="text-green-500 font-semibold text-xs">{formatCurrency(potentialWin)}</div>
                          </div>
                        </div>
                      </CardContent>
                      <CardFooter className="pt-0 pb-3">
                        <Button variant="outline" size="sm" className="w-full text-xs h-7 border-orange-500/30 hover:bg-orange-500/10" asChild>
                          <Link href={`/bet/${bet.id}`}>Ver</Link>
                        </Button>
                      </CardFooter>
                    </Card>
                  )
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="py-6 text-center">
                  <p className="text-muted-foreground mb-4">No tienes apuestas en curso</p>
                  <Button
                    className={createBetCtaClass}
                    style={createBetCtaStyle}
                    onClick={() => setShowCreateModal(true)}
                  >
                    Crear una apuesta
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>

      {/* House Bet Modal */}
      {houseBetModal && (() => {
        const sport = houseBetModal.event.sport
        const houseBetTypes = getHouseBetTypes(sport)
        const activeOdds = getActiveHouseOdds()
        const canSubmit = !houseBetSubmitting && Number(houseBetAmount) > 0 && (
          houseBetType === "exact_score"
            ? /^\d+[-:]\d+$/.test(houseBetExactScore) && houseBetSelectionOdds !== null
            : houseBetSelection !== null
        )
        return (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border/80 rounded-xl shadow-[0_8px_48px_rgba(0,0,0,0.6)] ring-1 ring-yellow-500/15 w-full max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
              <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-yellow-500/60 to-transparent" />
              <div className="p-6 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="secondary" className="text-[10px]">
                      {getSportIcon(sport)} {houseBetModal.event.league}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] ${mode === "real" ? "border-green-500/40 text-green-400" : "border-violet-500/40 text-violet-400"}`}>
                      {mode === "real" ? "💵 Real" : "🎮 Fantasy"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(houseBetModal.event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
                    </span>
                  </div>
                  <h2 className="font-bold text-lg">🏦 Vs. la casa</h2>
                </div>
                <button
                  onClick={() => { setHouseBetModal(null); setHouseBetSelection(null); setHouseBetExactScore("") }}
                  className="text-muted-foreground hover:text-foreground text-xl leading-none shrink-0 mt-1"
                >
                  ✕
                </button>
              </div>
              {/* Team VS layout */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 text-center">
                  {houseBetModal.event.home_logo
                    ? <img src={houseBetModal.event.home_logo} alt={houseBetModal.event.home_team} className="w-12 h-12 mx-auto mb-1 object-contain" />
                    : <div className="w-12 h-12 mx-auto mb-1 rounded-full bg-secondary flex items-center justify-center font-bold text-lg">{houseBetModal.event.home_team.slice(0,1)}</div>
                  }
                  <div className="text-sm font-bold leading-tight">{houseBetModal.event.home_team}</div>
                </div>
                <div className="text-base font-bold text-muted-foreground shrink-0">VS</div>
                <div className="flex-1 text-center">
                  {houseBetModal.event.away_logo
                    ? <img src={houseBetModal.event.away_logo} alt={houseBetModal.event.away_team} className="w-12 h-12 mx-auto mb-1 object-contain" />
                    : <div className="w-12 h-12 mx-auto mb-1 rounded-full bg-secondary flex items-center justify-center font-bold text-lg">{houseBetModal.event.away_team.slice(0,1)}</div>
                  }
                  <div className="text-sm font-bold leading-tight">{houseBetModal.event.away_team}</div>
                </div>
              </div>
              {/* Prediction widget */}
              {(houseBetModal.event.metadata as any)?.predictions?.percent && (() => {
                const pct = (houseBetModal.event.metadata as any).predictions.percent
                const pred = (houseBetModal.event.metadata as any).predictions
                return (
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 space-y-2">
                    <div className="text-xs font-semibold text-blue-300">🤖 Predicción</div>
                    <div className="flex gap-2">
                      <div className="flex-1 rounded-md bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                        <div className="text-[10px] text-muted-foreground truncate mb-0.5">{houseBetModal.event.home_team}</div>
                        <div className="text-lg font-bold text-blue-300">{pct.home}</div>
                        {pred.home_league_form && <div className="flex gap-0.5 justify-center mt-1"><FormDots form={pred.home_league_form} /></div>}
                      </div>
                      {pct.draw && (
                        <div className="flex-1 rounded-md bg-gray-500/10 border border-gray-500/20 p-2 text-center">
                          <div className="text-[10px] text-muted-foreground mb-0.5">Empate</div>
                          <div className="text-lg font-bold text-gray-300">{pct.draw}</div>
                        </div>
                      )}
                      <div className="flex-1 rounded-md bg-orange-500/10 border border-orange-500/20 p-2 text-center">
                        <div className="text-[10px] text-muted-foreground truncate mb-0.5">{houseBetModal.event.away_team}</div>
                        <div className="text-lg font-bold text-orange-300">{pct.away}</div>
                        {pred.away_league_form && <div className="flex gap-0.5 justify-center mt-1"><FormDots form={pred.away_league_form} /></div>}
                      </div>
                    </div>
                    {pred.advice && <p className="text-xs text-center text-amber-300/80 leading-snug">💡 {translateAdvice(pred.advice)}</p>}
                  </div>
                )
              })()}
              {/* Bet type tabs */}
              <div className="flex gap-2 flex-wrap">
                {houseBetTypes.map(bt => (
                  <Button
                    key={bt.id}
                    variant={houseBetType === bt.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setHouseBetType(bt.id); setHouseBetSelection(null); setHouseBetExactScore("") }}
                  >
                    {bt.label}
                  </Button>
                ))}
              </div>
              {/* Direct — outcome buttons */}
              {houseBetType === "direct" && houseBetModal.odds && (
                <div className={`grid gap-2 ${houseBetModal.odds.draw !== undefined ? "grid-cols-3" : "grid-cols-2"}`}>
                  {(["home", "draw", "away"] as const)
                    .filter(o => o !== "draw" || houseBetModal.odds?.draw !== undefined)
                    .map(outcome => {
                      const oddsValue = outcome === "home" ? houseBetModal.odds!.home
                        : outcome === "away" ? houseBetModal.odds!.away
                        : houseBetModal.odds!.draw!
                      const teamName = outcome === "home" ? houseBetModal.event.home_team
                        : outcome === "away" ? houseBetModal.event.away_team
                        : "Empate"
                      const actionLabel = outcome === "draw" ? "Termina en empate" : `Gana ${teamName}`
                      return (
                        <button
                          key={outcome}
                          onClick={() => setHouseBetSelection(outcome)}
                          className={`rounded-lg border p-3 text-center transition-colors ${
                            houseBetSelection === outcome
                              ? "border-yellow-500 bg-yellow-500/10"
                              : "border-border hover:border-yellow-400"
                          }`}
                        >
                          <div className="text-[11px] font-semibold truncate leading-tight">{teamName}</div>
                          <div className="text-[10px] text-muted-foreground mb-1 leading-tight">{actionLabel}</div>
                          <div className="font-bold text-yellow-500">{oddsValue.toFixed(2)}x</div>
                        </button>
                      )
                    })}
                </div>
              )}
              {houseBetType === "direct" && !houseBetModal.odds && (
                <p className="text-sm text-muted-foreground">Este evento no tiene predicciones disponibles.</p>
              )}
              {/* Exact score */}
              {houseBetType === "exact_score" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Cuota: {houseBetSelectionOdds !== null
                      ? `${houseBetSelectionOdds}x`
                      : houseBetExactScore && /^\d+[-:]\d+$/.test(houseBetExactScore)
                        ? "calculando..."
                        : "ingresa un marcador (ej: 2-1)"}
                  </p>
                  <input
                    type="text"
                    placeholder="Ej: 2-1"
                    value={houseBetExactScore}
                    onChange={e => setHouseBetExactScore(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
                  />
                </div>
              )}
              {/* Score margin */}
              {houseBetType === "score_margin" && (
                <div className="grid grid-cols-2 gap-2">
                  {SCORE_MARGIN_OPTIONS.map(opt => {
                    const label = opt.labelFn(houseBetModal.event.home_team, houseBetModal.event.away_team)
                    const odds = SCORE_MARGIN_ODDS_MAP[opt.value]
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setHouseBetSelection(opt.value)}
                        className={`rounded-lg border p-2 text-center transition-colors ${
                          houseBetSelection === opt.value
                            ? "border-yellow-500 bg-yellow-500/10"
                            : "border-border hover:border-yellow-400"
                        }`}
                      >
                        <div className="text-xs truncate">{label}</div>
                        <div className="font-bold text-yellow-500 text-sm">{odds.toFixed(2)}x</div>
                      </button>
                    )
                  })}
                </div>
              )}
              {/* Run line */}
              {houseBetType === "run_line" && (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "home_rl", label: `${houseBetModal.event.home_team} -1.5` },
                    { value: "away_rl", label: `${houseBetModal.event.away_team} +1.5` },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setHouseBetSelection(opt.value)}
                      className={`rounded-lg border p-3 text-center transition-colors ${
                        houseBetSelection === opt.value
                          ? "border-yellow-500 bg-yellow-500/10"
                          : "border-border hover:border-yellow-400"
                      }`}
                    >
                      <div className="text-xs text-muted-foreground">{opt.label}</div>
                      <div className="font-bold text-yellow-500">1.82x</div>
                    </button>
                  ))}
                </div>
              )}
              {/* Total runs */}
              {houseBetType === "total_runs" && (
                <div className="grid grid-cols-2 gap-2">
                  {TOTAL_RUNS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setHouseBetSelection(opt.value)}
                      className={`rounded-lg border p-2 text-center transition-colors ${
                        houseBetSelection === opt.value
                          ? "border-yellow-500 bg-yellow-500/10"
                          : "border-border hover:border-yellow-400"
                      }`}
                    >
                      <div className="text-xs">{opt.label}</div>
                      <div className="font-bold text-yellow-500 text-sm">{opt.odds.toFixed(2)}x</div>
                    </button>
                  ))}
                </div>
              )}
              {/* Amount slider */}
              {(() => {
                const walletBal = mode === "real" ? balance.real : balance.fantasy
                const maxAmt = Math.min(100000, Math.max(1, Math.floor(walletBal)))
                const stakeNum = Number(houseBetAmount) || 0
                return (
                  <div className="rounded-lg border p-3 bg-muted/20 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">Monto</span>
                      <span className="text-lg font-semibold">{stakeNum > 0 ? stakeNum.toLocaleString() : "0"}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={maxAmt}
                      step={1}
                      value={stakeNum > 0 ? Math.min(stakeNum, maxAmt) : 1}
                      onChange={e => setHouseBetAmount(e.target.value)}
                      className="w-full"
                      style={{ accentColor: "#eab308" }}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1</span>
                      <span>{maxAmt.toLocaleString()}</span>
                    </div>
                    <input
                      type="number"
                      value={houseBetAmount}
                      onChange={e => setHouseBetAmount(e.target.value)}
                      placeholder="0"
                      min={1}
                      max={100000}
                      className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
                    />
                  </div>
                )
              })()}
              {(() => {
                const stake = Number(houseBetAmount)
                const walletBal = mode === "real" ? balance.real : balance.fantasy
                const totalPayout = activeOdds !== null && stake > 0 ? Math.floor(stake * activeOdds) : null
                const netProfit = totalPayout !== null ? totalPayout - stake : null
                return (
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Balance disponible</span>
                      <span className={stake > walletBal ? "text-red-500 font-medium" : "font-medium text-foreground"}>
                        {walletBal.toLocaleString()} tokens
                      </span>
                    </div>
                    {stake > 0 && activeOdds !== null && (
                      <>
                        <div className="border-t border-border/40" />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Tu apuesta</span>
                          <span className="font-medium">{stake.toLocaleString()} tokens</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Cuota</span>
                          <span className="font-medium text-yellow-500">{activeOdds.toFixed(2)}x</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Ganancia neta</span>
                          <span className="font-medium text-green-500">+{netProfit!.toLocaleString()} tokens</span>
                        </div>
                        <div className="flex justify-between border-t border-border/40 pt-2">
                          <span className="font-semibold">Total si ganas</span>
                          <span className="font-bold text-green-400">{totalPayout!.toLocaleString()} tokens</span>
                        </div>
                      </>
                    )}
                  </div>
                )
              })()}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setHouseBetModal(null); setHouseBetSelection(null); setHouseBetExactScore(""); setHouseBetAmount("") }}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold"
                  disabled={!canSubmit}
                  onClick={async () => {
                    setHouseBetSubmitting(true)
                    try {
                      const { data: { session } } = await supabase.auth.getSession()
                      if (!session) { showToast("Inicia sesión para apostar", "error"); return }
                      const selectionValue = houseBetType === "exact_score" ? houseBetExactScore : houseBetSelection
                      const res = await fetch("/api/bets/house", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          "Authorization": `Bearer ${session.access_token}`,
                        },
                        body: JSON.stringify({
                          userId: session.user.id,
                          eventId: houseBetModal.event.id,
                          betType: houseBetType,
                          selection: selectionValue,
                          amount: Number(houseBetAmount),
                          mode,
                        }),
                      })
                      const json = await res.json()
                      if (!res.ok) { showToast(json.error || "Error al crear apuesta", "error"); return }
                      showToast("¡Apuesta creada contra la casa!", "success")
                      setHouseBetModal(null)
                      setHouseBetSelection(null)
                      setHouseBetExactScore("")
                      setHouseBetAmount("")
                      window.dispatchEvent(new Event("wallet:updated"))
                    } finally {
                      setHouseBetSubmitting(false)
                    }
                  }}
                >
                  {houseBetSubmitting ? "Procesando..." : "Confirmar"}
                </Button>
              </div>
            </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export function Marketplace() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <HomeContent />
    </Suspense>
  )
}
