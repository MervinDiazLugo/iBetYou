"use client"

import { useState, useEffect, Suspense, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Search, Trophy, Users, Clock, ChevronRight, Wallet, Calendar } from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import type { Bet, Event, User } from "@/types"
import Link from "next/link"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useToast } from "@/components/toast"
import { CreateBetForm } from "@/components/create-bet-form"
import { Countdown } from "@/components/countdown"

interface BetWithDetails extends Bet {
  event: Event
  creator: User
}

const sports = [
  { id: "all", name: "Todos", icon: "⚽" },
  { id: "football", name: "Fútbol", icon: "⚽" },
  { id: "basketball", name: "Basketball", icon: "🏀" },
  { id: "baseball", name: "Béisbol", icon: "⚾" },
]

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
  const { showToast } = useToast()
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEventForBet, setSelectedEventForBet] = useState<Event | null>(null)
  const [eventsSportFilter, setEventsSportFilter] = useState("all")
  const [eventsVisibleBySport, setEventsVisibleBySport] = useState<Record<string, number>>({
    football: 10,
    basketball: 10,
    baseball: 10,
  })
  const [loadingBets, setLoadingBets] = useState(false)
  const sessionTokenRef = useRef<string | null>(null)
  const userIdRef = useRef<string | null>(null)
  const initialLoadDoneRef = useRef(false)

  const router = useRouter()
  const supabase = createBrowserSupabaseClient()

  useEffect(() => {
    const create = searchParams.get("create")
    const clone = searchParams.get("clone")
    
    if (create === "true" || clone) {
      setShowCreateModal(true)
      if (clone) {
        setCloneBetId(clone)
      }
      // Clear the URL param
      window.history.replaceState({}, '', '/')
    }
  }, [searchParams])

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

  // Load available events on mount (all sports, filter client-side)
  useEffect(() => {
    fetch('/api/events/list')
      .then(r => r.json())
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]))
  }, [])

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

    return matchesSearch && matchesSport
  }

  const filteredBets = bets.filter((bet) => {
    if (bet.status !== 'open') return false
    if (user && bet.creator_id === user.id) return false
    return matchesMarketplaceFilters(bet)
  })

  const filteredTakenBets = takenBets.filter((bet) => {
    const eventStart = new Date(bet.event?.start_time)
    if (eventStart < new Date()) return false
    return matchesMarketplaceFilters(bet)
  })

  const filteredEvents = events.filter(event => {
    const matchesSport = eventsSportFilter === 'all' || (event.sport as string) === eventsSportFilter
    const matchesSearch = !searchTerm ||
      event.home_team.toLowerCase().includes(searchTerm.toLowerCase()) ||
      event.away_team.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesSport && matchesSearch
  })

  const eventsBySport = {
    football: filteredEvents.filter((event) => event.sport === "football"),
    basketball: filteredEvents.filter((event) => event.sport === "basketball"),
    baseball: filteredEvents.filter((event) => event.sport === "baseball"),
  }

  useEffect(() => {
    setEventsVisibleBySport({
      football: 10,
      basketball: 10,
      baseball: 10,
    })
  }, [eventsSportFilter, searchTerm])

  const ownOpenBetsCount = user
    ? inProgressBets.filter((bet) => bet.status === 'open' && bet.creator_id === user.id).length
    : 0

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

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent onClose={() => setShowCreateModal(false)}>
          <CreateBetForm onClose={() => { setShowCreateModal(false); setCloneBetId(null); setSelectedEventForBet(null) }} cloneBetId={cloneBetId} initialEvent={selectedEventForBet} />
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

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar equipos o eventos..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Sport Filter */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {sports.map((sport) => (
              <Button
                key={sport.id}
                variant={selectedSport === sport.id ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedSport(sport.id)}
                className="whitespace-nowrap"
              >
                <span>{sport.icon}</span>
                {sport.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Eventos Disponibles */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-5 w-5 text-blue-400" />
            <h2 className="text-lg sm:text-xl font-bold">Eventos Disponibles</h2>
            <Badge variant="outline" className="ml-2 text-xs">
              {filteredEvents.length} evento{filteredEvents.length !== 1 ? 's' : ''}
            </Badge>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {sports.map((sport) => (
              <Button
                key={`events-${sport.id}`}
                variant={eventsSportFilter === sport.id ? "default" : "outline"}
                size="sm"
                onClick={() => setEventsSportFilter(sport.id)}
                className="whitespace-nowrap"
              >
                <span>{sport.icon}</span>
                {sport.name}
              </Button>
            ))}
          </div>

          {filteredEvents.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center">
                <p className="text-muted-foreground">No hay eventos disponibles para este filtro</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {(eventsSportFilter === "all"
                ? ["football", "basketball", "baseball"]
                : [eventsSportFilter]
              ).map((sportId) => {
                const sportEvents = eventsBySport[sportId as keyof typeof eventsBySport] || []
                if (sportEvents.length === 0) return null

                const visibleCount = eventsVisibleBySport[sportId] || 10
                const visibleEvents = sportEvents.slice(0, visibleCount)
                const hasMore = visibleCount < sportEvents.length

                return (
                  <div key={`event-group-${sportId}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-base font-semibold">
                        {getSportIcon(sportId)} {getSportLabel(sportId)}
                      </h3>
                      <Badge variant="secondary" className="text-xs">
                        {sportEvents.length}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {visibleEvents.map((event) => (
                        <Card key={event.id} className="overflow-hidden hover:border-blue-500/50 transition-all cursor-pointer">
                          <div className="h-0.5 bg-gradient-to-r from-blue-500 to-cyan-400" />
                          <CardContent className="pt-3 pb-3 space-y-2 px-3">
                            <div className="flex items-center justify-between gap-1">
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 leading-none truncate max-w-[65%]">
                                {getSportIcon(event.sport)} {event.league}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {new Date(event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-1">
                              <div className="flex-1 text-center min-w-0">
                                {event.home_logo ? (
                                  <img src={event.home_logo} alt={event.home_team} className="w-7 h-7 mx-auto mb-0.5 object-contain" />
                                ) : (
                                  <div className="w-7 h-7 mx-auto mb-0.5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold">
                                    {event.home_team.slice(0, 2).toUpperCase()}
                                  </div>
                                )}
                                <div className="text-[10px] font-semibold leading-tight truncate">{event.home_team}</div>
                              </div>
                              <div className="text-[11px] font-bold text-muted-foreground px-1">VS</div>
                              <div className="flex-1 text-center min-w-0">
                                {event.away_logo ? (
                                  <img src={event.away_logo} alt={event.away_team} className="w-7 h-7 mx-auto mb-0.5 object-contain" />
                                ) : (
                                  <div className="w-7 h-7 mx-auto mb-0.5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold">
                                    {event.away_team.slice(0, 2).toUpperCase()}
                                  </div>
                                )}
                                <div className="text-[10px] font-semibold leading-tight truncate">{event.away_team}</div>
                              </div>
                            </div>

                            <Button
                              size="sm"
                              className="w-full text-[11px] h-7 bg-blue-600 hover:bg-blue-700 text-white"
                              onClick={() => {
                                if (!user) {
                                  window.location.href = '/login'
                                  return
                                }
                                setSelectedEventForBet(event)
                                setShowCreateModal(true)
                              }}
                            >
                              Apostar aquí
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {hasMore && (
                      <div className="mt-3 flex justify-center">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEventsVisibleBySport((prev) => ({
                              ...prev,
                              [sportId]: (prev[sportId] || 10) + 10,
                            }))
                          }}
                        >
                          Mostrar más {getSportLabel(sportId).toLowerCase()}
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
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="h-5 w-5 text-primary" />
              <h2 className="text-lg sm:text-xl font-bold">Apuestas Disponibles</h2>
            </div>
            {filteredBets.length === 0 ? (
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
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredBets.map((bet) => {
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
                    className="hover:border-primary/60 hover:shadow-lg transition-all cursor-pointer bg-gradient-to-b from-card to-card/80 overflow-hidden"
                  >
                    <div className="h-1 bg-gradient-to-r from-primary to-green-500" />
                    
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary" className="text-[10px] py-0.5 px-2 bg-primary/10 text-primary border-primary/20">
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
                          <div className="w-10 h-10 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-1">
                            {bet.event.home_logo ? (
                              <img
                                src={bet.event.home_logo}
                                alt={bet.event.home_team}
                                className="w-8 h-8 object-contain"
                              />
                            ) : (
                              <span className="text-lg">🏆</span>
                            )}
                          </div>
                          <div className="font-bold text-xs truncate max-w-[80px] mx-auto">{bet.event.home_team}</div>
                        </div>
                        <div className="px-3 py-1 bg-secondary/50 rounded-lg">
                          <span className="text-xs font-bold text-muted-foreground">VS</span>
                        </div>
                        <div className="flex-1 text-center">
                          <div className="w-10 h-10 mx-auto rounded-full bg-gradient-to-br from-green-500/20 to-green-500/5 flex items-center justify-center mb-1">
                            {bet.event.away_logo ? (
                              <img
                                src={bet.event.away_logo}
                                alt={bet.event.away_team}
                                className="w-8 h-8 object-contain"
                              />
                            ) : (
                              <span className="text-lg">🎯</span>
                            )}
                          </div>
                          <div className="font-bold text-xs truncate max-w-[80px] mx-auto">{bet.event.away_team}</div>
                        </div>
                      </div>

                      <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-green-500/20 rounded-lg p-3 border border-primary/20">
                        <div className="text-[9px] text-muted-foreground text-center uppercase tracking-wider mb-1">Apuesta a favor de</div>
                        <div className="text-base font-bold text-center bg-gradient-to-r from-primary to-green-400 bg-clip-text text-transparent">
                          {bet.creator_selection}
                        </div>
                      </div>

                      <div className="flex items-center justify-center">
                        <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                          {betTypeLabels[bet.bet_type] || bet.bet_type}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-secondary/60 rounded-lg p-2 text-center border border-border/50">
                          <div className="text-[9px] text-muted-foreground uppercase">Monto</div>
                          <div className="font-bold text-primary text-sm">{formatCurrency(bet.amount)}</div>
                        </div>
                        <div className="bg-gradient-to-br from-green-500/20 to-green-500/5 rounded-lg p-2 text-center border border-green-500/30">
                          <div className="text-[9px] text-green-400 uppercase">Premio</div>
                          <div className="font-bold text-green-400 text-sm">{formatCurrency(potentialWin)}</div>
                        </div>
                      </div>

                      {bet.bet_type === "exact_score" && bet.multiplier > 1 && (
                        <div className="text-center">
                          <Badge className="bg-gradient-to-r from-green-500/30 to-green-500/10 text-green-400 border-green-500/30 text-[10px]">
                            ⚡ x{bet.multiplier} Multiplicador
                          </Badge>
                        </div>
                      )}
                    </CardContent>

                    <CardFooter className="pt-3 pb-3 bg-secondary/20 border-t border-border/50">
                      <div className="flex flex-col gap-2 w-full">
                        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          <span>@{bet.creator?.nickname}</span>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Button variant="outline" size="sm" className="flex-1 text-xs h-8 border-primary/30 hover:bg-primary/10" asChild>
                            <Link href={`/create?clone=${bet.id}`}>
                              Clonar
                            </Link>
                          </Button>
                          <Button size="sm" className="flex-1 text-xs h-8 bg-gradient-to-r from-primary to-yellow-500 hover:from-primary/90 hover:to-yellow-500/90" asChild>
                            <Link href={`/bet/${bet.id}`}>
                              Tomar
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </CardFooter>
                  </Card>
                )})}
              </div>
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

                    <div className="flex items-center justify-center">
                      <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-500">
                        {betTypeLabels[bet.bet_type] || bet.bet_type}
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
                      <Button variant="outline" size="sm" className="w-full text-xs h-8 border-orange-500/30 hover:bg-orange-500/10" asChild>
                        <Link href={`/create?clone=${bet.id}`}>
                          Clonar Apuesta
                        </Link>
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
            {inProgressBets.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {inProgressBets.slice(0, 5).map((bet) => {
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
                  <Button asChild>
                    <Link href="/create">Crear una apuesta</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center">Cargando...</div>}>
      <HomeContent />
    </Suspense>
  )
}
