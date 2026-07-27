"use client"
import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import Image from "next/image"
import Link from "next/link"

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
  const [event, setEvent] = useState<EventData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${id}/live`, { cache: "no-store" })
      if (res.ok) {
        const data = await res.json()
        setEvent(data.event)
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
