"use client"
import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import Image from "next/image"
import Link from "next/link"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"
import { formatCurrency } from "@/lib/utils"
import { formatHouseSelection, formatHouseBetTypeLabel } from "@/lib/bet-labels"
import { isLiveP2PBetType } from "@/lib/live-bet-types"

interface OpenBet { id: string; bet_type: string; creator_selection: string; amount: number; status: string; creator_id: string }

interface LiveMeta {
  status: string
  progress: string
  home_score: number
  away_score: number
  updated_at: string
  snapshots: Array<{ minute: unknown; home: number; away: number }>
  win_prob: { home: number; draw?: number; away: number }
  suspended: boolean
}
interface EventData {
  id: number
  sport: string
  home_team: string
  away_team: string
  home_logo?: string
  away_logo?: string
  league: string
  status: string
  start_time: string
  home_score?: number
  away_score?: number
  metadata?: any
}

const sportIcon: Record<string, string> = { football: "⚽", basketball: "🏀", baseball: "⚾" }
const pct = (n: number) => `${Math.round(n * 100)}%`

export default function EventPage() {
  const { id } = useParams<{ id: string }>()
  const { showToast } = useToast()
  const [event, setEvent] = useState<EventData | null>(null)
  const [openBets, setOpenBets] = useState<OpenBet[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState("100")
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${id}/live`, { cache: "no-store" })
      if (res.ok) {
        const data = await res.json()
        setEvent(data.event)
        setOpenBets(data.openBets || [])
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user?.id ?? null))
  }, [])

  async function authHeaders(): Promise<HeadersInit> {
    const supabase = createBrowserSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    const headers: HeadersInit = { "Content-Type": "application/json" }
    if (session?.access_token) (headers as Record<string, string>).Authorization = `Bearer ${session.access_token}`
    return headers
  }

  async function createLiveBet(betType: string, selection: string) {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { showToast("Monto inválido", "error"); return }
    setSubmitting(true)
    try {
      const res = await fetch("/api/bets/create", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ eventId: Number(id), betType, selection: { selection }, amount: amt, mode: "fantasy" }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || "No se pudo crear", "error"); return }
      showToast("Apuesta en vivo creada", "success")
      load()
    } finally { setSubmitting(false) }
  }

  async function takeBet(betId: string) {
    if (!userId) { showToast("Inicia sesión para tomar", "error"); return }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/bets/${betId}`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ user_id: userId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(data.error || "No se pudo tomar", "error"); return }
      showToast("Apuesta tomada", "success")
      load()
    } finally { setSubmitting(false) }
  }

  if (loading) return (<><Navbar /><div className="max-w-2xl mx-auto p-6 text-gray-400">Cargando…</div></>)
  if (!event) return (<><Navbar /><div className="max-w-2xl mx-auto p-6 text-gray-400">Evento no encontrado.</div></>)

  const live: LiveMeta | undefined = event.metadata?.live
  const isLive = event.status === "live"
  const preds = event.metadata?.predictions
  const channels: Array<{ name: string; country: string; logo?: string }> = event.metadata?.tv?.channels || []
  const wp = live?.win_prob
  const homeScore = live?.home_score ?? event.home_score ?? 0
  const awayScore = live?.away_score ?? event.away_score ?? 0

  return (
    <>
      <Navbar />
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-200">← Volver</Link>

        {/* Scoreboard */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
            <span>{sportIcon[event.sport]} {event.league}</span>
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 text-red-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />EN VIVO {live?.progress}
              </span>
            ) : (
              <span>{new Date(event.start_time).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</span>
            )}
          </div>
          <div className="flex items-center justify-center gap-6">
            <div className="flex-1 text-center">
              {event.home_logo && <Image src={event.home_logo} alt="" width={44} height={44} className="mx-auto object-contain" unoptimized />}
              <div className="text-sm font-semibold mt-1">{event.home_team}</div>
            </div>
            <div className="text-4xl font-extrabold tabular-nums">
              {homeScore}<span className="text-gray-600 mx-2">–</span>{awayScore}
            </div>
            <div className="flex-1 text-center">
              {event.away_logo && <Image src={event.away_logo} alt="" width={44} height={44} className="mx-auto object-contain" unoptimized />}
              <div className="text-sm font-semibold mt-1">{event.away_team}</div>
            </div>
          </div>
        </div>

        {/* Live probability */}
        {isLive && wp && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Probabilidad en vivo</div>
            <div className="flex h-3.5 rounded-lg overflow-hidden border border-gray-800">
              <div style={{ width: pct(wp.home) }} className="bg-blue-500" />
              {wp.draw !== undefined && <div style={{ width: pct(wp.draw) }} className="bg-slate-500" />}
              <div style={{ width: pct(wp.away) }} className="bg-orange-500" />
            </div>
            <div className="flex justify-between text-[11px] font-semibold mt-1.5">
              <span className="text-blue-300">Local {pct(wp.home)}</span>
              {wp.draw !== undefined && <span className="text-slate-300">Empate {pct(wp.draw)}</span>}
              <span className="text-orange-300">Visita {pct(wp.away)}</span>
            </div>
          </div>
        )}

        {/* Timeline */}
        {isLive && !!live?.snapshots?.length && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Línea de tiempo</div>
            <div className="space-y-1.5">
              {live.snapshots.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-amber-400 w-10">{String(s.minute)}&apos;</span>
                  <span>{sportIcon[event.sport]} {s.home}–{s.away}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* P2P-live betting */}
        {isLive && live && (
          <div className="rounded-xl border border-blue-800/40 bg-blue-950/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-wider text-blue-300">🤝 Apuestas en vivo · P2P</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">Monto</span>
                <input
                  type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                />
              </div>
            </div>

            {live.suspended ? (
              <p className="text-xs text-amber-400/80">Mercado suspendido momentáneamente (anotación reciente). Vuelve en unos segundos.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-gray-400 mb-1">¿Habrá más anotaciones?</div>
                  <div className="flex gap-2">
                    <button disabled={submitting} onClick={() => createLiveBet("live_more_scoring", "yes")}
                      className="flex-1 rounded-md bg-gray-800 hover:bg-green-900/40 border border-gray-700 hover:border-green-500/40 py-1.5 text-xs font-semibold disabled:opacity-50">Sí</button>
                    <button disabled={submitting} onClick={() => createLiveBet("live_more_scoring", "no")}
                      className="flex-1 rounded-md bg-gray-800 hover:bg-red-900/40 border border-gray-700 hover:border-red-500/40 py-1.5 text-xs font-semibold disabled:opacity-50">No</button>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400 mb-1">¿Quién anota primero?</div>
                  <div className="flex gap-2">
                    <button disabled={submitting} onClick={() => createLiveBet("live_next_team_scores", "home")}
                      className="flex-1 rounded-md bg-gray-800 hover:bg-blue-900/40 border border-gray-700 hover:border-blue-500/40 py-1.5 text-xs font-semibold disabled:opacity-50 truncate">{event.home_team}</button>
                    <button disabled={submitting} onClick={() => createLiveBet("live_next_team_scores", "away")}
                      className="flex-1 rounded-md bg-gray-800 hover:bg-orange-900/40 border border-gray-700 hover:border-orange-500/40 py-1.5 text-xs font-semibold disabled:opacity-50 truncate">{event.away_team}</button>
                  </div>
                </div>
              </div>
            )}

            {/* Open live P2P bets to take */}
            {openBets.filter((b) => isLiveP2PBetType(b.bet_type) && b.creator_id !== userId).map((b) => (
              <div key={b.id} className="mt-3 flex items-center justify-between gap-2 rounded-md bg-gray-900/60 border border-gray-800 p-2.5">
                <div className="text-xs min-w-0">
                  <div className="text-gray-400 text-[10px]">{formatHouseBetTypeLabel(b.bet_type)}</div>
                  <div className="text-green-400 font-medium truncate">{formatHouseSelection(b.bet_type, b.creator_selection, event.home_team, event.away_team)}</div>
                </div>
                <div className="flex items-center gap-2 flex-none">
                  <span className="text-amber-400 font-bold text-xs">{formatCurrency(b.amount)}</span>
                  <button disabled={submitting} onClick={() => takeBet(b.id)}
                    className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">Tomar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pre-match analysis */}
        {preds?.percent && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">🤖 Análisis pre-partido</div>
            <div className="flex gap-1.5">
              <div className="flex-1 rounded-md bg-blue-500/10 border border-blue-500/20 py-1.5 text-center">
                <div className="text-[10px] text-gray-500">Local</div>
                <div className="text-sm font-bold text-blue-300">{preds.percent.home}</div>
              </div>
              {preds.percent.draw && (
                <div className="flex-1 rounded-md bg-gray-500/10 border border-gray-500/20 py-1.5 text-center">
                  <div className="text-[10px] text-gray-500">Empate</div>
                  <div className="text-sm font-bold text-gray-300">{preds.percent.draw}</div>
                </div>
              )}
              <div className="flex-1 rounded-md bg-orange-500/10 border border-orange-500/20 py-1.5 text-center">
                <div className="text-[10px] text-gray-500">Visita</div>
                <div className="text-sm font-bold text-orange-300">{preds.percent.away}</div>
              </div>
            </div>
            {preds.advice && <p className="text-xs text-center text-amber-300/80 mt-2">💡 {preds.advice}</p>}
          </div>
        )}

        {/* Dónde ver */}
        {channels.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">📺 Dónde ver</div>
            <div className="grid grid-cols-2 gap-1.5">
              {channels.slice(0, 6).map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md bg-gray-800/60 border border-gray-800 px-2.5 py-1.5 text-xs">
                  {c.logo ? <Image src={c.logo} alt="" width={20} height={20} className="rounded object-contain" unoptimized /> : <span>📡</span>}
                  <span className="font-medium truncate">
                    {c.name}
                    <span className="block text-[9px] text-gray-500">{c.country}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
