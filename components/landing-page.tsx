"use client"

import { useState, useEffect } from "react"
import { Navbar } from "@/components/navbar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import Image from "next/image"

interface FeaturedEvent {
  id: number
  sport: string
  league: string
  home_team: string
  away_team: string
  home_logo?: string
  away_logo?: string
  start_time: string
  status: string
  metadata?: {
    predictions?: {
      percent?: { home?: string; draw?: string; away?: string }
      advice?: string | null
    }
  }
}

const HOUSE_EDGE = 1.10
const MAX_TEAM_ODDS = 4.0

function calcPreviewOdds(percent: { home?: string; draw?: string; away?: string }) {
  const parse = (v?: string) => parseFloat((v || "0").replace("%", "")) / 100
  const h = parse(percent.home)
  const a = parse(percent.away)
  if (h <= 0 || a <= 0) return null
  const cap = (odds: number) => Math.min(odds, MAX_TEAM_ODDS)
  const d = percent.draw ? parse(percent.draw) : undefined
  return {
    home: +(cap(1 / (h * HOUSE_EDGE))).toFixed(2),
    away: +(cap(1 / (a * HOUSE_EDGE))).toFixed(2),
    draw: d && d > 0 ? +(1 / (d * HOUSE_EDGE)).toFixed(2) : undefined,
  }
}

const sportIcon: Record<string, string> = { football: "⚽", basketball: "🏀", baseball: "⚾" }

interface LandingPageProps {
  refCode: string | null
}

export function LandingPage({ refCode }: LandingPageProps) {
  const [referrerNickname, setReferrerNickname] = useState<string | null>(null)
  const [events, setEvents] = useState<FeaturedEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (refCode) {
      fetch(`/api/referrals/preview?code=${refCode}`)
        .then((r) => r.json())
        .then((d) => { if (d.nickname) setReferrerNickname(d.nickname) })
        .catch(() => {})
    }

    fetch("/api/events/list?featured=true&limit=6")
      .then((r) => r.json())
      .then((data) => {
        const arr: FeaturedEvent[] = Array.isArray(data) ? data : []
        const withOdds = arr.filter((e) => e.metadata?.predictions?.percent)
        setEvents(withOdds.slice(0, 6))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refCode])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-12">
        {refCode && referrerNickname !== null && (
          <div className="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-center">
            <p className="text-amber-400 font-semibold text-lg mb-1">
              {referrerNickname} te invitó a iBetYou
            </p>
            <p className="text-gray-300 text-sm mb-4">
              Regístrate ahora y recibe <span className="text-amber-400 font-bold">50 fichas gratis</span> para empezar a predecir.
            </p>
            <div className="inline-flex items-center gap-2 bg-gray-800 rounded-lg px-4 py-2 mb-4">
              <span className="text-gray-400 text-sm">Código aplicado:</span>
              <span className="text-amber-400 font-mono font-bold">{refCode}</span>
              <span className="text-green-400 text-sm">✓</span>
            </div>
            <div className="flex justify-center">
              <Link href="/login">
                <Button className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-8 py-3 text-base">
                  Reclamar mis 50 fichas →
                </Button>
              </Link>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-10 items-start mb-16">
          <div>
            <h1 className="text-4xl font-bold leading-tight mb-4">
              Predice resultados.{" "}
              <span className="text-blue-400">Gana fichas.</span>
            </h1>
            <p className="text-gray-300 text-lg mb-3">
              Apuesta contra la casa o desafía a otro fan. Tú eliges.
            </p>
            <p className="text-gray-400 mb-8">
              Cuotas en vivo para cada partido. Fútbol, béisbol y basketball — incluido el Mundial 2026.
            </p>
            <div className="flex gap-4 flex-wrap">
              <Link href="/login">
                <Button className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 text-base font-semibold">
                  Crear cuenta gratis →
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-800 px-6 py-3">
                  Iniciar sesión
                </Button>
              </Link>
            </div>

            <div className="flex gap-6 mt-8 text-sm text-gray-400">
              <div className="text-center">
                <div className="text-2xl mb-1">⚽</div>
                <div>Fútbol</div>
              </div>
              <div className="text-center">
                <div className="text-2xl mb-1">⚾</div>
                <div>Béisbol</div>
              </div>
              <div className="text-center">
                <div className="text-2xl mb-1">🏀</div>
                <div>Basketball</div>
              </div>
            </div>
          </div>

          {/* House bets preview */}
          <div>
            <p className="text-gray-400 text-sm uppercase tracking-wide font-medium mb-4">
              ⚡ Cuotas disponibles ahora
            </p>
            <div className="space-y-3">
              {loading && [1, 2, 3].map((i) => (
                <div key={i} className="bg-gray-800 rounded-lg p-4 animate-pulse h-20" />
              ))}
              {!loading && events.length === 0 && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
                  <p className="text-gray-500 text-sm">No hay eventos con cuotas en este momento</p>
                </div>
              )}
              {!loading && events.map((event) => {
                const odds = event.metadata?.predictions?.percent
                  ? calcPreviewOdds(event.metadata.predictions.percent)
                  : null
                return (
                  <Link key={event.id} href="/login" className="block">
                    <div className="bg-gray-800 border border-gray-700 hover:border-blue-500/50 rounded-lg p-4 transition-all hover:bg-gray-750 cursor-pointer group">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm flex-shrink-0">{sportIcon[event.sport] || "🏆"}</span>
                          <span className="text-[11px] text-gray-500 truncate">{event.league}</span>
                        </div>
                        <span className="text-[11px] text-gray-500 flex-shrink-0">
                          {new Date(event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {event.home_logo && (
                            <Image src={event.home_logo} alt="" width={20} height={20} className="object-contain flex-shrink-0" unoptimized />
                          )}
                          <span className="text-sm font-medium text-white truncate">{event.home_team}</span>
                        </div>
                        <span className="text-gray-600 text-xs flex-shrink-0">vs</span>
                        <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                          <span className="text-sm font-medium text-white truncate text-right">{event.away_team}</span>
                          {event.away_logo && (
                            <Image src={event.away_logo} alt="" width={20} height={20} className="object-contain flex-shrink-0" unoptimized />
                          )}
                        </div>
                      </div>

                      {odds && (
                        <div className="flex gap-2 mt-3">
                          <div className="flex-1 bg-gray-900 rounded px-2 py-1.5 text-center group-hover:bg-blue-900/30 transition-colors">
                            <div className="text-[10px] text-gray-500 truncate">{event.home_team.split(" ").slice(-1)[0]}</div>
                            <div className="text-sm font-bold text-blue-400">{odds.home.toFixed(2)}</div>
                          </div>
                          {odds.draw !== undefined && (
                            <div className="flex-1 bg-gray-900 rounded px-2 py-1.5 text-center group-hover:bg-gray-700/50 transition-colors">
                              <div className="text-[10px] text-gray-500">Empate</div>
                              <div className="text-sm font-bold text-gray-300">{odds.draw.toFixed(2)}</div>
                            </div>
                          )}
                          <div className="flex-1 bg-gray-900 rounded px-2 py-1.5 text-center group-hover:bg-orange-900/30 transition-colors">
                            <div className="text-[10px] text-gray-500 truncate">{event.away_team.split(" ").slice(-1)[0]}</div>
                            <div className="text-sm font-bold text-orange-400">{odds.away.toFixed(2)}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
            <p className="text-center text-gray-500 text-xs pt-3">
              Regístrate gratis para apostar en estos y más eventos
            </p>
          </div>
        </div>

        {/* Value props */}
        <div className="grid md:grid-cols-3 gap-6 border-t border-gray-800 pt-12">
          <div className="text-center">
            <div className="text-3xl mb-3">🤝</div>
            <h3 className="font-semibold text-white mb-2">Predicciones P2P</h3>
            <p className="text-gray-400 text-sm">
              Predicciones directamente contra otro usuario. Sin intermediario, sin margen de la casa.
            </p>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-3">🏆</div>
            <h3 className="font-semibold text-white mb-2">Ganas el pozo completo</h3>
            <p className="text-gray-400 text-sm">
              El ganador se lleva el monto total apostado por ambas partes.
            </p>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-3">⚡</div>
            <h3 className="font-semibold text-white mb-2">Resolución automática</h3>
            <p className="text-gray-400 text-sm">
              Los resultados se sincronizan desde fuentes oficiales. Resolución justa y transparente.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
