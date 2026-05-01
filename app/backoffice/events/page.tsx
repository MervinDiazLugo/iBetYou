"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Calendar,
  Plus,
  RefreshCw,
  Search,
  Globe,
  Clock,
  Check,
  Trash2,
  Star,
  Pencil
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import { useToast } from "@/components/toast"
import { createBrowserSupabaseClient } from "@/lib/supabase"

interface ExternalEvent {
  fixture: {
    id: number
    date: string
    status: { short: string; long: string }
    venue?: { name?: string; city?: string }
  }
  league: {
    id: number
    name: string
    country: string
    logo: string
    flag?: string
  }
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null }
    away: { id: number; name: string; logo: string; winner: boolean | null }
  }
  score: {
    fulltime: { home: number | null; away: number | null }
  }
}

interface SavedEvent {
  id: number
  sport: string
  league: string
  country: string
  home_team: string
  away_team: string
  home_logo?: string
  away_logo?: string
  start_time: string
  status: string
  external_id: string | null
  home_score?: number | null
  away_score?: number | null
  featured?: boolean
  metadata?: {
    venue?: { name?: string; city?: string }
  }
}

export default function BackofficeEvents() {
  const searchParams = useSearchParams()
  const dateFromRef = useRef<HTMLInputElement | null>(null)
  const dateToRef = useRef<HTMLInputElement | null>(null)
  const [view, setView] = useState<'external' | 'saved'>('saved')
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([])
  const [externalError, setExternalError] = useState<string | null>(null)
  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingSaved, setLoadingSaved] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<string>("")
  const [sport, setSport] = useState<string>("all")
  const [highlightEventId, setHighlightEventId] = useState<number | null>(null)
  const [dateFrom, setDateFrom] = useState<string>(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState<string>(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
  const [selectedEvents, setSelectedEvents] = useState<Set<number>>(new Set())
  const [savedExternalIds, setSavedExternalIds] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [countryFilter, setCountryFilter] = useState<string>("")
  const [eventsPage, setEventsPage] = useState(0)
  const [eventsTotal, setEventsTotal] = useState(0)
  const [pastEvents, setPastEvents] = useState<SavedEvent[]>([])
  const [pastPage, setPastPage] = useState(0)
  const [pastTotal, setPastTotal] = useState(0)
  const [loadingPast, setLoadingPast] = useState(false)
  const [loadingMorePast, setLoadingMorePast] = useState(false)
  const [pastLoaded, setPastLoaded] = useState(false)
  const EVENTS_PAGE_SIZE = 50
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [scoreDialog, setScoreDialog] = useState<{ eventId: number; homeTeam: string; awayTeam: string } | null>(null)
  const [scoreForm, setScoreForm] = useState({ home_score: "", away_score: "", status: "finished" })
  const [savingScore, setSavingScore] = useState(false)
  const [newEvent, setNewEvent] = useState({
    sport: 'football',
    league: '',
    home_team: '',
    away_team: '',
    start_time: '',
    country: ''
  })
  const { showToast } = useToast()

  async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
    const supabase = createBrowserSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) {
      headers.set("Authorization", `Bearer ${session.access_token}`)
    }
    return fetch(input, { ...init, headers })
  }

  const fetchAbortRef = useRef<AbortController | null>(null)

  async function fetchExternalEvents() {
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller

    setLoading(true)
    setExternalError(null)
    setSelectedEvents(new Set())
    const effectiveSport = sport === 'all' ? 'football' : sport
    if (sport === 'all') setSport('football')
    try {
      const res = await authFetch(`/api/events?sport=${effectiveSport}&from=${dateFrom}&to=${dateTo}`)

      if (controller.signal.aborted) return

      if (!res.ok) {
        const errData = await res.json()
        const detail = errData.details?.[0]?.reason ? ` — ${errData.details[0].reason}` : ''
        const msg = (errData.error || 'Error al consultar la API') + detail
        setExternalError(msg)
        setExternalEvents([])
        return
      }

      const data = await res.json()
      if (controller.signal.aborted) return

      const raw: any[] = Array.isArray(data) ? data : []

      if (raw.length === 0) {
        setExternalEvents([])
        setExternalError('La API no devolvió eventos para este rango de fechas.')
        return
      }

      const normalizedEvents = raw.map((event: any) => {
        if (effectiveSport === 'basketball') {
          return {
            fixture: {
              id: event.id,
              date: event.date,
              status: event.status,
              venue: { name: event.venue || null, city: null },
            },
            league: {
              name: event.league?.name || 'Unknown',
              country: event.country?.name || 'Unknown',
            },
            teams: {
              home: { name: event.teams?.home?.name || '', logo: event.teams?.home?.logo || null },
              away: { name: event.teams?.away?.name || '', logo: event.teams?.away?.logo || null },
            },
            scores: event.scores,
          }
        }
        if (effectiveSport === 'baseball') {
          return {
            fixture: {
              id: event.id,
              date: event.date,
              status: event.status,
              venue: { name: event.venue?.name, city: event.venue?.city },
            },
            league: {
              name: event.league?.name || 'Unknown',
              country: event.country?.name || 'Unknown',
            },
            teams: {
              home: { name: event.teams?.home?.name || '', logo: event.teams?.home?.logo || null },
              away: { name: event.teams?.away?.name || '', logo: event.teams?.away?.logo || null },
            },
            scores: event.scores,
          }
        }
        return event
      })

      const sorted = normalizedEvents.sort((a: any, b: any) =>
        new Date(a.fixture?.date || '').getTime() - new Date(b.fixture?.date || '').getTime()
      )
      setExternalEvents(sorted)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error('Error fetching external events:', err)
      setExternalError('Error inesperado al consultar la API.')
      setExternalEvents([])
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  async function fetchSavedEvents(page = 0) {
    if (page === 0) setLoadingSaved(true)
    else setLoadingMore(true)
    try {
      const res = await authFetch(`/api/admin/events?sport=${sport === 'all' ? 'all' : sport}&page=${page}&limit=${EVENTS_PAGE_SIZE}&direction=upcoming`)
      if (!res.ok) {
        const err = await res.json()
        showToast(err.error || 'Error al cargar eventos', 'error')
        return
      }
      const data = await res.json()
      const events: SavedEvent[] = data.events || []
      setEventsTotal(data.total ?? 0)
      setEventsPage(page)

      if (page === 0) {
        setSavedEvents(events)
      } else {
        setSavedEvents(prev => [...prev, ...events])
      }
    } catch (err) {
      console.error('Error fetching saved events:', err)
      showToast('Error al cargar eventos', 'error')
    } finally {
      setLoadingSaved(false)
      setLoadingMore(false)
    }
  }

  async function fetchPastEvents(page = 0) {
    if (page === 0) setLoadingPast(true)
    else setLoadingMorePast(true)
    try {
      const res = await authFetch(`/api/admin/events?sport=${sport === 'all' ? 'all' : sport}&page=${page}&limit=${EVENTS_PAGE_SIZE}&direction=past`)
      if (!res.ok) {
        const err = await res.json()
        showToast(err.error || 'Error al cargar eventos pasados', 'error')
        return
      }
      const data = await res.json()
      const events: SavedEvent[] = data.events || []
      setPastTotal(data.total ?? 0)
      setPastPage(page)
      setPastLoaded(true)

      if (page === 0) {
        setPastEvents(events)
      } else {
        setPastEvents(prev => [...prev, ...events])
      }
    } catch (err) {
      console.error('Error fetching past events:', err)
      showToast('Error al cargar eventos pasados', 'error')
    } finally {
      setLoadingPast(false)
      setLoadingMorePast(false)
    }
  }

  useEffect(() => {
    const ids = new Set<string>()
    savedEvents.forEach(e => { if (e.external_id) ids.add(e.external_id) })
    pastEvents.forEach(e => { if (e.external_id) ids.add(e.external_id) })
    setSavedExternalIds(ids)
  }, [savedEvents, pastEvents])

  useEffect(() => {
    if (view === 'saved') {
      fetchSavedEvents(0)
      setPastEvents([])
      setPastTotal(0)
      setPastPage(0)
      setPastLoaded(false)
    }
  }, [view, sport])


  // Handle event_id URL param — highlight and scroll to that event after load
  useEffect(() => {
    const eventId = searchParams.get('event_id')
    if (!eventId) return
    const id = parseInt(eventId)
    setHighlightEventId(id)
    setSport('all')
    // Scroll after events have rendered
    setTimeout(() => {
      document.getElementById(`event-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 600)
  }, [searchParams])

  function toggleEvent(id: number, externalId: string) {
    const newSelected = new Set(selectedEvents)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      // Don't allow selecting already saved events
      if (!savedExternalIds.has(externalId)) {
        newSelected.add(id)
      }
    }
    setSelectedEvents(newSelected)
  }

  function selectAllVisible() {
    const visible = filteredExternalEvents
      .filter(e => !savedExternalIds.has(`${sport}_${e.fixture.id}`))
      .map(e => e.fixture.id)
    
    if (selectedEvents.size === visible.length) {
      setSelectedEvents(new Set())
    } else {
      setSelectedEvents(new Set(visible))
    }
  }

  async function handleSaveSelected() {
    if (selectedEvents.size === 0) {
      showToast('Selecciona al menos un evento', 'error')
      return
    }

    setSaving(true)
    try {
      const eventsToSave = filteredExternalEvents
        .filter(e => selectedEvents.has(e.fixture.id))
        .map(e => ({
          external_id: `${sport}_${e.fixture.id}`,
          sport: sport,
          home_team: e.teams.home.name,
          away_team: e.teams.away.name,
          home_logo: e.teams.home.logo,
          away_logo: e.teams.away.logo,
          start_time: e.fixture.date,
          status: e.fixture.status?.short === 'FT' ? 'finished' : 
                  e.fixture.status?.short === 'NS' ? 'scheduled' : 
                  e.fixture.status?.short?.startsWith('IN') ? 'live' : 'scheduled',
          league: e.league?.name || 'Unknown',
          country: e.league?.country || 'Unknown',
          metadata: {
            venue: {
              name: e.fixture?.venue?.name || null,
              city: e.fixture?.venue?.city || null,
            },
          },
        }))

      const res = await authFetch('/api/admin/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'bulk_create', events: eventsToSave })
      })

      const data = await res.json()
      
      if (res.ok) {
        showToast(`Se guardaron ${eventsToSave.length} eventos`, 'success')
        setSelectedEvents(new Set())
        fetchSavedEvents(0)
        fetchExternalEvents()
      } else {
        showToast(data.error || 'Error al guardar', 'error')
      }
    } catch (err) {
      console.error('Error saving:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteEvent(id: number) {
    setConfirmDialog({
      title: 'Eliminar evento',
      message: '¿Estás seguro de eliminar este evento? Esta acción no se puede deshacer.',
      onConfirm: async () => {
        setConfirmDialog(null)
        await _doDeleteEvent(id)
      },
    })
  }

  async function _doDeleteEvent(id: number) {
    try {
      const res = await authFetch(`/api/admin/events?id=${id}`, {
        method: 'DELETE',
      })
      
      if (res.ok) {
        fetchSavedEvents(0)
      }
    } catch (err) {
      console.error('Error deleting:', err)
    }
  }

  async function handleToggleFeatured(id: number, currentFeatured: boolean) {
    try {
      const res = await authFetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, featured: !currentFeatured }),
      })
      if (res.ok) {
        setSavedEvents(prev => prev.map(e => e.id === id ? { ...e, featured: !currentFeatured } : e))
      } else {
        const data = await res.json()
        showToast(data.error || 'Error al actualizar', 'error')
      }
    } catch {
      showToast('Error al actualizar evento', 'error')
    }
  }

  async function handleSetScore() {
    if (!scoreDialog) return
    setSavingScore(true)
    try {
      const res = await authFetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: scoreDialog.eventId,
          set_score: {
            home_score: scoreForm.home_score,
            away_score: scoreForm.away_score,
            status: scoreForm.status,
          },
        }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast('Score actualizado', 'success')
        setScoreDialog(null)
        setSavedEvents(prev => prev.map(e =>
          e.id === scoreDialog.eventId
            ? { ...e, home_score: Number(scoreForm.home_score), away_score: Number(scoreForm.away_score), status: scoreForm.status }
            : e
        ))
      } else {
        showToast(data.error || 'Error al actualizar score', 'error')
      }
    } catch {
      showToast('Error al actualizar score', 'error')
    } finally {
      setSavingScore(false)
    }
  }

  async function handleCleanupOld() {
    setConfirmDialog({
      title: 'Limpiar eventos > 2 semanas',
      message: 'Se eliminarán eventos anteriores a hace 2 semanas que NO tengan apuestas. Los eventos con apuestas se conservan siempre.',
      onConfirm: async () => {
        setConfirmDialog(null)
        await _doCleanupOld()
      },
    })
  }

  async function _doCleanupOld() {
    try {
      const res = await authFetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup_old' }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(
          `${data.deleted} eventos eliminados · ${data.protected} conservados (tienen apuestas)`,
          'success'
        )
        fetchSavedEvents(0)
      } else {
        showToast(data.error || 'Error al limpiar', 'error')
      }
    } catch (err) {
      console.error('Error cleanup:', err)
      showToast('Error al limpiar eventos', 'error')
    }
  }

  async function handleCleanupNoBets() {
    setConfirmDialog({
      title: 'Eliminar eventos sin apuestas',
      message: 'Se borrarán TODOS los eventos que no tienen ninguna apuesta, sin importar la fecha. Los eventos con apuestas no se tocan.',
      onConfirm: async () => {
        setConfirmDialog(null)
        await _doCleanupNoBets()
      },
    })
  }

  async function _doCleanupNoBets() {
    try {
      const res = await authFetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup_no_bets' }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(`${data.deleted} eventos eliminados · ${data.protected} conservados (tienen apuestas)`, 'success')
        fetchSavedEvents(0)
      } else {
        showToast(data.error || 'Error al limpiar', 'error')
      }
    } catch (err) {
      showToast('Error al eliminar eventos', 'error')
    }
  }

  async function handleDedup() {
    setConfirmDialog({
      title: 'Eliminar duplicados',
      message: 'Se detectan eventos con el mismo ID externo y se conserva solo uno. Las apuestas de los duplicados se reasignan al evento conservado automáticamente.',
      onConfirm: async () => {
        setConfirmDialog(null)
        await _doDedup()
      },
    })
  }

  async function _doDedup() {
    try {
      const res = await authFetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dedup' }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.removed === 0) {
          showToast('No se encontraron duplicados', 'success')
        } else {
          showToast(`${data.removed} duplicados eliminados (${data.groups} grupos)`, 'success')
          fetchSavedEvents(0)
        }
      } else {
        showToast(data.error || 'Error al deduplicar', 'error')
      }
    } catch (err) {
      console.error('Error dedup:', err)
      showToast('Error al eliminar duplicados', 'error')
    }
  }

  async function handleCreate() {
    if (!newEvent.home_team || !newEvent.away_team || !newEvent.start_time) {
      showToast('Completa los campos requeridos', 'error')
      return
    }

    try {
      const res = await authFetch('/api/admin/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'create', ...newEvent })
      })

      const data = await res.json()
      
      if (res.ok) {
        showToast('Evento creado exitosamente', 'success')
        setShowCreate(false)
        setNewEvent({
          sport: 'football',
          league: '',
          home_team: '',
          away_team: '',
          start_time: '',
          country: ''
        })
        fetchSavedEvents(0)
      } else {
        showToast(data.error || 'Error al crear evento', 'error')
      }
    } catch (err) {
      console.error('Error creating:', err)
    }
  }

  const filteredExternalEvents = externalEvents.filter(event => {
    // Filter by country
    if (countryFilter && event.league?.country !== countryFilter) return false
    
    // Filter by search term
    if (!filter) return true
    const search = filter.toLowerCase()
    return (
      event.teams.home.name.toLowerCase().includes(search) ||
      event.teams.away.name.toLowerCase().includes(search) ||
      event.league.name.toLowerCase().includes(search)
    )
  })

  const filteredSavedEvents = savedEvents.filter(event => {
    // Filter by sport
    if (sport !== 'all' && event.sport !== sport) return false
    
    // Filter by search term
    if (!filter) return true
    const search = filter.toLowerCase()
    return (
      event.home_team.toLowerCase().includes(search) ||
      event.away_team.toLowerCase().includes(search) ||
      event.league.toLowerCase().includes(search)
    )
  })

  const now = new Date()
  const startOfTodayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const endOfTodayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))

  const orderedSavedEvents = [...filteredSavedEvents].sort((a, b) => {
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  })

  const todaysSavedEvents = orderedSavedEvents.filter((event) => {
    const eventDate = new Date(event.start_time)
    return eventDate >= startOfTodayUTC && eventDate <= endOfTodayUTC
  })

  const upcomingSavedEvents = orderedSavedEvents.filter((event) => {
    const eventDate = new Date(event.start_time)
    return eventDate > endOfTodayUTC
  })

  const filteredPastEvents = pastEvents.filter((event) => {
    if (!filter) return true
    const search = filter.toLowerCase()
    return (
      event.home_team.toLowerCase().includes(search) ||
      event.away_team.toLowerCase().includes(search) ||
      event.league.toLowerCase().includes(search)
    )
  })

  const getSportIcon = (sport: string) => {
    switch (sport) {
      case 'football': return '⚽'
      case 'basketball': return '🏀'
      case 'baseball': return '⚾'
      default: return '🏆'
    }
  }

  const renderSavedEventCard = (event: SavedEvent) => (
    <Card
      key={event.id}
      id={`event-${event.id}`}
      className={`hover:shadow-md ${
        highlightEventId === event.id
          ? "border-primary ring-2 ring-primary/40"
          : event.featured
          ? "border-amber-400/60 ring-1 ring-amber-400/30"
          : ""
      }`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{getSportIcon(event.sport)}</span>
            <Badge variant="outline">{event.league}</Badge>
            {event.featured && (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-400/15 text-amber-400 border-amber-400/40" variant="outline">
                ⭐ Destacado
              </Badge>
            )}
          </div>
          <span className="text-xs font-medium text-primary">
            {new Date(event.start_time).toLocaleDateString('es-ES', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
            })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-center flex-1">
            {event.home_logo && (
              <img src={event.home_logo} alt="" className="w-8 h-8 mx-auto mb-1 object-contain" />
            )}
            <div className="font-bold text-sm">{event.home_team}</div>
          </div>
          <div className="px-2 text-muted-foreground">vs</div>
          <div className="text-center flex-1">
            {event.away_logo && (
              <img src={event.away_logo} alt="" className="w-8 h-8 mx-auto mb-1 object-contain" />
            )}
            <div className="font-bold text-sm">{event.away_team}</div>
          </div>
        </div>
        {(event.home_score !== null && event.home_score !== undefined) && (
          <div className="text-center font-bold text-lg mb-1">
            {event.home_score} - {event.away_score}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground truncate max-w-[140px]">
            {event.metadata?.venue?.name ? `📍 ${event.metadata.venue.name}` : ''}
          </div>
          <Badge variant="secondary" className="text-xs flex-shrink-0">
            {event.status}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-primary flex-shrink-0"
            onClick={() => {
              setScoreForm({
                home_score: event.home_score?.toString() ?? "",
                away_score: event.away_score?.toString() ?? "",
                status: event.status,
              })
              setScoreDialog({ eventId: event.id, homeTeam: event.home_team, awayTeam: event.away_team })
            }}
            title="Editar score"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 w-8 p-0 flex-shrink-0 ${event.featured ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}
            onClick={() => handleToggleFeatured(event.id, event.featured || false)}
            title={event.featured ? 'Quitar destacado' : 'Marcar como destacado'}
          >
            <Star className="h-4 w-4" fill={event.featured ? 'currentColor' : 'none'} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-500 flex-shrink-0"
            onClick={() => handleDeleteEvent(event.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Eventos</h1>
          <p className="text-muted-foreground">Gestiona los eventos disponibles para apuestas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCleanupNoBets}>
            <Trash2 className="h-4 w-4 mr-2" />
            Sin apuestas
          </Button>
          <Button variant="outline" onClick={handleDedup}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Eliminar duplicados
          </Button>
          <Button variant="outline" onClick={handleCleanupOld}>
            <Trash2 className="h-4 w-4 mr-2" />
            Limpiar &gt;2 semanas
          </Button>
          <Button onClick={() => { setShowCreate(true); setView('saved') }}>
            <Plus className="h-4 w-4 mr-2" />
            Crear Evento
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={view === 'external' ? 'default' : 'ghost'}
          onClick={() => setView('external')}
        >
          <Search className="h-4 w-4 mr-2" />
          Consultar API
        </Button>
        <Button
          variant={view === 'saved' ? 'default' : 'ghost'}
          onClick={() => { setView('saved') }}
        >
          <Check className="h-4 w-4 mr-2" />
          Eventos Guardados
        </Button>
      </div>

      {/* External Events View */}
      {view === 'external' && (
        <>
          {/* Search Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex items-center gap-2">
                  <span className="text-sm">Deporte:</span>
                  <select
                    value={sport}
                    onChange={(e) => { setSport(e.target.value); setExternalError(null) }}
                    className="px-3 py-2 rounded-lg border bg-background"
                  >
                    <option value="football">⚽ Fútbol</option>
                    <option value="basketball">🏀 Básquet</option>
                    <option value="baseball">⚾ Béisbol</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">Desde:</span>
                  <Input
                    ref={dateFromRef}
                    type="date"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setExternalError(null) }}
                    className="w-auto min-w-[170px]"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => {
                      if (dateFromRef.current?.showPicker) {
                        dateFromRef.current.showPicker()
                      } else {
                        dateFromRef.current?.focus()
                      }
                    }}
                    aria-label="Abrir calendario desde"
                  >
                    <Calendar className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">Hasta:</span>
                  <Input
                    ref={dateToRef}
                    type="date"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setExternalError(null) }}
                    className="w-auto min-w-[170px]"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => {
                      if (dateToRef.current?.showPicker) {
                        dateToRef.current.showPicker()
                      } else {
                        dateToRef.current?.focus()
                      }
                    }}
                    aria-label="Abrir calendario hasta"
                  >
                    <Calendar className="h-4 w-4" />
                  </Button>
                </div>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por equipo o liga..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {externalEvents.length > 0 && (
                  <select
                    value={countryFilter}
                    onChange={(e) => setCountryFilter(e.target.value)}
                    className="px-3 py-2 border rounded-md bg-background text-sm"
                  >
                    <option value="">Todos los países</option>
                    {[...new Set(externalEvents.map(e => e.league?.country).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map(country => (
                      <option key={country} value={country}>{country}</option>
                    ))}
                  </select>
                )}
                <Button onClick={fetchExternalEvents} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? 'Consultando...' : 'Consultar'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Events List */}
          {loading ? (
            <div className="text-center py-12">Consultando API externa...</div>
          ) : externalError ? (
            <Card>
              <CardContent className="py-12 text-center space-y-2">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-destructive font-medium">{externalError}</p>
                <p className="text-xs text-muted-foreground">Probá ajustando el rango de fechas (el plan gratuito de la API tiene restricciones)</p>
              </CardContent>
            </Card>
          ) : externalEvents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">Ingresa un rango de fechas y consultá la API</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox"
                    checked={selectedEvents.size === filteredExternalEvents.filter(e => !savedExternalIds.has(`${sport}_${e.fixture.id}`)).length && selectedEvents.size > 0}
                    onChange={selectAllVisible}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">
                    {selectedEvents.size} de {filteredExternalEvents.filter(e => !savedExternalIds.has(`${sport}_${e.fixture.id}`)).length} seleccionados
                  </span>
                </div>
                <Button 
                  onClick={handleSaveSelected} 
                  disabled={selectedEvents.size === 0 || saving}
                >
                  <Check className="h-4 w-4 mr-2" />
                  {saving ? 'Guardando...' : `Guardar ${selectedEvents.size} Seleccionados`}
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredExternalEvents.map((event) => {
                const isSaved = savedExternalIds.has(`${sport}_${event.fixture.id}`)
                
                return (
                  <Card 
                    key={event.fixture.id} 
                    className={`transition-all ${
                      isSaved 
                        ? 'opacity-50 border-green-500/30' 
                        : selectedEvents.has(event.fixture.id) 
                          ? 'border-primary bg-primary/5' 
                          : 'hover:shadow-md cursor-pointer'
                    }`}
                    onClick={() => !isSaved && toggleEvent(event.fixture.id, `${sport}_${event.fixture.id}`)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">
                            {sport === 'football' && '⚽'}
                            {sport === 'basketball' && '🏀'}
                            {sport === 'baseball' && '⚾'}
                          </span>
                          <Badge variant={isSaved ? "secondary" : "outline"}>
                            {isSaved && <Check className="h-3 w-3 mr-1" />}
                            {event.league.flag && (
                              <img src={event.league.flag} alt="" className="w-4 h-3 mr-1 inline" />
                            )}
                            {event.league.name}
                          </Badge>
                        </div>
                        <span className="text-xs font-medium text-primary">
                          {new Date(event.fixture.date).toLocaleDateString('es-ES', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
                          })}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="py-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-center flex-1">
                          {event.teams.home.logo && (
                            <img src={event.teams.home.logo} alt="" className="w-8 h-8 mx-auto mb-1 object-contain" />
                          )}
                          <div className="font-bold text-sm">{event.teams.home.name}</div>
                        </div>
                        <div className="px-2 text-muted-foreground">vs</div>
                        <div className="text-center flex-1">
                          {event.teams.away.logo && (
                            <img src={event.teams.away.logo} alt="" className="w-8 h-8 mx-auto mb-1 object-contain" />
                          )}
                          <div className="font-bold text-sm">{event.teams.away.name}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="truncate max-w-[200px]">
                          {event.fixture?.venue?.name ? `📍 ${event.fixture.venue.name}${event.fixture.venue.city ? `, ${event.fixture.venue.city}` : ''}` : ''}
                        </div>
                        {isSaved && (
                          <Badge variant="outline" className="text-xs bg-green-500/10">Ya guardado</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
            </>
          )}
        </>
      )}

      {/* Saved Events View */}
      {view === 'saved' && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-4 items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar eventos guardados..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <select
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  className="px-3 py-2 border rounded-md bg-background"
                >
                  <option value="all">Todos</option>
                  <option value="football">⚽ Fútbol</option>
                  <option value="basketball">🏀 Básquet</option>
                  <option value="baseball">⚾ Béisbol</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {loadingSaved ? (
            <div className="text-center py-12 text-muted-foreground">Cargando eventos...</div>
          ) : filteredSavedEvents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No hay eventos guardados</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Juegos de hoy</h3>
                  <Badge variant="outline">{todaysSavedEvents.length}</Badge>
                </div>
                {todaysSavedEvents.length === 0 ? (
                  <Card>
                    <CardContent className="py-6 text-sm text-muted-foreground">
                      No hay juegos para hoy con este filtro.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {todaysSavedEvents.map(renderSavedEventCard)}
                  </div>
                )}
              </section>

              {upcomingSavedEvents.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Próximos juegos</h3>
                    <Badge variant="outline">{upcomingSavedEvents.length}</Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {upcomingSavedEvents.map(renderSavedEventCard)}
                  </div>
                </section>
              )}

              {loadingMore && (
                <div className="text-center py-4 text-sm text-muted-foreground">Cargando próximos eventos...</div>
              )}
              {!loadingMore && savedEvents.length < eventsTotal && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => fetchSavedEvents(eventsPage + 1)}
                >
                  Cargar más próximos ({eventsTotal - savedEvents.length} restantes)
                </Button>
              )}

              <section>
                <details
                  className="rounded-lg border bg-card px-4 py-3"
                  onToggle={(e) => {
                    if ((e.target as HTMLDetailsElement).open && !pastLoaded) {
                      fetchPastEvents(0)
                    }
                  }}
                >
                  <summary className="cursor-pointer list-none flex items-center justify-between">
                    <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Eventos pasados</span>
                    <Badge variant="secondary">{pastLoaded ? pastTotal : '—'}</Badge>
                  </summary>
                  <div className="mt-4">
                    {loadingPast ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">Cargando eventos pasados...</div>
                    ) : !pastLoaded ? (
                      <p className="text-sm text-muted-foreground">Desplegá para ver eventos pasados.</p>
                    ) : filteredPastEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No hay eventos pasados con este filtro.</p>
                    ) : (
                      <>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                          {filteredPastEvents.map(renderSavedEventCard)}
                        </div>
                        {loadingMorePast && (
                          <div className="text-center py-4 text-sm text-muted-foreground">Cargando...</div>
                        )}
                        {!loadingMorePast && pastEvents.length < pastTotal && (
                          <Button
                            variant="outline"
                            className="w-full mt-4"
                            onClick={() => fetchPastEvents(pastPage + 1)}
                          >
                            Cargar más pasados ({pastTotal - pastEvents.length} restantes)
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </details>
              </section>
            </div>
          )}
        </>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Crear Evento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Liga</label>
                <Input
                  value={newEvent.league}
                  onChange={(e) => setNewEvent({...newEvent, league: e.target.value})}
                  placeholder="Ej: Copa America"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Equipo Local</label>
                  <Input
                    value={newEvent.home_team}
                    onChange={(e) => setNewEvent({...newEvent, home_team: e.target.value})}
                    placeholder="Argentina"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Equipo Visitante</label>
                  <Input
                    value={newEvent.away_team}
                    onChange={(e) => setNewEvent({...newEvent, away_team: e.target.value})}
                    placeholder="Brasil"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Fecha y Hora</label>
                <Input
                  type="datetime-local"
                  value={newEvent.start_time}
                  onChange={(e) => setNewEvent({...newEvent, start_time: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">País</label>
                <Input
                  value={newEvent.country}
                  onChange={(e) => setNewEvent({...newEvent, country: e.target.value})}
                  placeholder="Argentina"
                />
              </div>
              <div className="flex gap-2 pt-4">
                <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={handleCreate}>
                  Crear
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Score edit modal */}
      {scoreDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-sm mx-4">
            <CardHeader>
              <CardTitle className="text-base">Editar score</CardTitle>
              <p className="text-sm text-muted-foreground">{scoreDialog.homeTeam} vs {scoreDialog.awayTeam}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">{scoreDialog.homeTeam}</label>
                  <Input
                    type="number"
                    min="0"
                    value={scoreForm.home_score}
                    onChange={(e) => setScoreForm(f => ({ ...f, home_score: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{scoreDialog.awayTeam}</label>
                  <Input
                    type="number"
                    min="0"
                    value={scoreForm.away_score}
                    onChange={(e) => setScoreForm(f => ({ ...f, away_score: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Estado</label>
                <select
                  value={scoreForm.status}
                  onChange={(e) => setScoreForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                >
                  <option value="finished">Finalizado</option>
                  <option value="live">En curso</option>
                  <option value="scheduled">Programado</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setScoreDialog(null)}>
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={handleSetScore} disabled={savingScore}>
                  {savingScore ? 'Guardando...' : 'Guardar'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h2 className="text-lg font-semibold">{confirmDialog.title}</h2>
            <p className="text-sm text-muted-foreground">{confirmDialog.message}</p>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmDialog(null)}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={confirmDialog.onConfirm}
              >
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
