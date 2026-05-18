"use client"

import { useState, useEffect } from "react"
import { Navbar } from "@/components/navbar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import Link from "next/link"

interface PreviewBet {
  id: string
  creator_selection: string
  amount: number
  event?: {
    home_team: string
    away_team: string
    sport: string
  }
  creator?: { nickname: string }
}

interface LandingPageProps {
  refCode: string | null
}

export function LandingPage({ refCode }: LandingPageProps) {
  const [referrerNickname, setReferrerNickname] = useState<string | null>(null)
  const [previewBets, setPreviewBets] = useState<PreviewBet[]>([])

  useEffect(() => {
    if (refCode) {
      fetch(`/api/referrals/preview?code=${refCode}`)
        .then((r) => r.json())
        .then((d) => { if (d.nickname) setReferrerNickname(d.nickname) })
        .catch(() => {})
    }

    fetch("/api/bets?limit=3")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.bets)) setPreviewBets(d.bets.slice(0, 3)) })
      .catch(() => {})
  }, [refCode])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-12">
        {/* VARIANT C: Referral landing */}
        {refCode && referrerNickname !== null && (
          <div className="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-center">
            <p className="text-amber-400 font-semibold text-lg mb-1">
              {referrerNickname} te invitó a iBetYou
            </p>
            <p className="text-gray-300 text-sm mb-4">
              Regístrate ahora y recibe <span className="text-amber-400 font-bold">50 fichas gratis</span> para empezar a apostar.
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

        {/* VARIANT B: Default hero */}
        <div className="grid md:grid-cols-2 gap-10 items-center mb-16">
          <div>
            <h1 className="text-4xl font-bold leading-tight mb-4">
              La apuesta es entre{" "}
              <span className="text-blue-400">tú y otro fan</span>
            </h1>
            <p className="text-gray-300 text-lg mb-3">
              Sin casa de apuestas. El pozo va 100% al ganador.
            </p>
            <p className="text-gray-400 mb-8">
              Elige un partido, crea tu apuesta o toma la de otro usuario. Fútbol, béisbol y basketball.
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

          {/* Live bets preview */}
          <div className="space-y-3">
            <p className="text-gray-400 text-sm uppercase tracking-wide font-medium mb-4">
              Apuestas activas ahora
            </p>
            {previewBets.length === 0 && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-gray-800 rounded-lg p-4 animate-pulse h-16" />
                ))}
              </div>
            )}
            {previewBets.map((bet) => (
              <div
                key={bet.id}
                className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex justify-between items-center"
              >
                <div>
                  <p className="text-white text-sm font-medium">
                    {bet.event?.home_team} vs {bet.event?.away_team}
                  </p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {bet.creator?.nickname} apuesta: {bet.creator_selection}
                  </p>
                </div>
                <Badge className="bg-green-600 text-white text-sm font-bold">
                  {formatCurrency(bet.amount)}
                </Badge>
              </div>
            ))}
            <p className="text-center text-gray-500 text-xs pt-2">
              Regístrate gratis para ver todas las apuestas y crear las tuyas
            </p>
          </div>
        </div>

        {/* Value props */}
        <div className="grid md:grid-cols-3 gap-6 border-t border-gray-800 pt-12">
          <div className="text-center">
            <div className="text-3xl mb-3">🤝</div>
            <h3 className="font-semibold text-white mb-2">Apuestas P2P</h3>
            <p className="text-gray-400 text-sm">
              Apuestas directamente contra otro usuario. Sin intermediario, sin margen de la casa.
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
