"use client"

import { useEffect, useRef, useState } from "react"
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
  Trash2
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
  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingSaved, setLoadingSaved] = useState(false)
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

  async function fetchExternalEvents() {
    setLoading(true)
    setSelectedEvents(new Set())
    try {
      const res = await authFetch(`/api/events?sport=${sport}&from=${dateFrom}&to=${dateTo}`)
      
      if (!res.ok) {
        const error = await res.json()
        showToast(error.error || 'Error al consultar la API', 'error')
        setExternalEvents([])
        return
      }
      
      const data = await res.json()
      
      // Normalize the data based on sport (different API response structures)
      const normalizedEvents = (Array.isArray(data) ? data : []).map((event: any) => {
        if (sport === 'baseball') {
          // Baseball: direct structure
          return {
            fixture: {
              id: event.id,
              date: event.date,
                status: event.status,
                venue: {
                  name: event.venue?.name,
                  city: event.venue?.city,
                }
            },
            league: {
              name: event.league?.name || 'Unknown',
              country: event.country?.name || 'Unknown'
            },
            teams: {
              home: { name: event.teams?.home?.name || '', logo: event.teams?.home?.logo || null },
              away: { name: event.teams?.away?.name || '', logo: event.teams?.away?.logo || null }
            },
            scores: event.scores
          }
        }
        // Football and basketball have the same structure
        return event
      })
      
      const sorted = normalizedEvents.sort((a: any, b: any) => 
        new Date(a.fixture?.date || '').getTime() - new Date(b.fixture?.date || '').getTime()
      )
      setExternalEvents(sorted)
      
      await fetchSavedEvents()
    } catch (err) {
      console.error('Error fetching external events:', err)
      setExternalEvents([])
    } finally {
      setLoading(false)
    }
  }

  async function fetchSavedEvents() {
    setLoadingSaved(true)
    try {
      const res = await authFetch(`/api/admin/events?sport=all`)
      if (!res.ok) {
        const err = await res.json()
        showToast(err.error || 'Error al cargar eventos', 'error')
        return
      }
      const data = await res.json()
      const events = data.events || []
      setSavedEvents(events)

      const ids = new Set<string>()
      events.forEach((e: SavedEvent) => {
        if (e.external_id) ids.add(e.external_id)
      })
      setSavedExternalIds(ids)
    } catch (err) {
      console.error('Error fetching saved events:', err)
      showToast('Error al cargar eventos', 'error')
    } finally {
      setLoadingSaved(false)
    }
  }

  useEffect(() => {
    if (view === 'saved') {
      fetchSavedEvents()
    }
  }, [view])

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
        fetchSavedEvents()
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
    if (!confirm('¿Estás seguro de eliminar este evento?')) return
    
    try {
      const res = await authFetch(`/api/admin/events?id=${id}`, {
        method: 'DELETE',
      })
      
      if (res.ok) {
        fetchSavedEvents()
      }
    } catch (err) {
      console.error('Error deleting:', err)
    }
  }

  async function handleCleanupOld() {
    if (!confirm('¿Eliminar eventos pasados (más de 2 semanas)?\n\nSolo se eliminan los que NO tienen apuestas asociadas. Los eventos con apuestas se conservan siempre.')) return
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
        fetchSavedEvents()
      } else {
        showToast(data.error || 'Error al limpiar', 'error')
      }
    } catch (err) {
      console.error('Error cleanup:', err)
      showToast('Error al limpiar eventos', 'error')
    }
  }

  async function handleCleanupNoBets() {
    if (!confirm('¿Eliminar TODOS los eventos sin apuestas?\n\nSe borrarán todos los eventos que no tienen ninguna apuesta asociada, sin importar la fecha. Los eventos con apuestas no se tocan.')) return
    try {
      const res = await authFetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup_no_bets' }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(`${data.deleted} eventos eliminados · ${data.protected} conservados (tienen apuestas)`, 'success')
        fetchSavedEvents()
      } else {
        showToast(data.error || 'Error al limpiar', 'error')
      }
    } catch (err) {
      showToast('Error al eliminar eventos', 'error')
    }
  }

  async function handleDedup() {
    if (!confirm('¿Eliminar eventos duplicados?\n\nSe detectan eventos con el mismo ID externo y se conserva solo uno. Las apuestas de los duplicados se reasignan al evento conservado automáticamente.')) return
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
          fetchSavedEvents()
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
        fetchSavedEvents()
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
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfPastWindow = new Date(startOfToday)
  startOfPastWindow.setDate(startOfPastWindow.getDate() - 7)
  const endOfToday = new Date(startOfToday)
  endOfToday.setHours(23, 59, 59, 999)

  const orderedSavedEvents = [...filteredSavedEvents].sort((a, b) => {
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  })

  const todaysSavedEvents = orderedSavedEvents.filter((event) => {
    const eventDate = new Date(event.start_time)
    return eventDate >= startOfToday && eventDate <= endOfToday
  })

  const upcomingSavedEvents = orderedSavedEvents.filter((event) => {
    const eventDate = new Date(event.start_time)
    return eventDate > endOfToday
  })

  const pastSavedEvents = [...orderedSavedEvents]
    .filter((event) => {
      const eventDate = new Date(event.start_time)
      return eventDate < startOfToday && eventDate >= startOfPastWindow
    })
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())

  const getSportIcon = (sport: string) => {
    switch (sport) {
      case 'football': return '⚽'
      case 'basketball': return '🏀'
      case 'baseball': return '⚾'
      default: return '🏆'
    }
  }

  const renderSavedEventCard = (event: SavedEvent) => (
    <Card key={event.id} className={`hover:shadow-md ${highlightEventId === event.id ? "border-primary ring-2 ring-primary/40" : ""}`} id={`event-${event.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{getSportIcon(event.sport)}</span>
            <Badge variant="outline">
              {event.league}
            </Badge>
          </div>
          <span className="text-xs font-medium text-primary">
            {new Date(event.start_time).toLocaleDateString('es-ES', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
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
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
            {event.metadata?.venue?.name ? `📍 ${event.metadata.venue.name}${event.metadata.venue.city ? `, ${event.metadata.venue.city}` : ''}` : ''}
          </div>
          <Badge variant="secondary" className="text-xs flex-shrink-0">
            {event.status}
          </Badge>
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
          onClick={() => { fetchSavedEvents(); setView('saved') }}
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
                    onChange={(e) => setSport(e.target.value)}
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
                    onChange={(e) => setDateFrom(e.target.value)}
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
                    onChange={(e) => setDateTo(e.target.value)}
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
                    {[...new Set(externalEvents.map(e => e.league?.country).filter(Boolean))].map(country => (
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
          ) : externalEvents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">Ingresa un rango de fechas y consulta la API</p>
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
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
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

              <section>
                <details className="rounded-lg border bg-card px-4 py-3">
                  <summary className="cursor-pointer list-none flex items-center justify-between">
                    <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Eventos pasados</span>
                    <Badge variant="secondary">{pastSavedEvents.length}</Badge>
                  </summary>

                  <div className="mt-4">
                    {pastSavedEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No hay eventos pasados con este filtro.</p>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {pastSavedEvents.map(renderSavedEventCard)}
                      </div>
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
    </div>
  )
}
