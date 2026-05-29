"use client"

import { useState, useEffect } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Trophy, AlertCircle, Coins } from "lucide-react"

interface EventRow {
  id: number; sport: string
  home_team: string; away_team: string
  home_logo?: string | null; away_logo?: string | null
  start_time: string; league: string
  metadata?: {
    predictions?: {
      percent?: { home: string; draw: string; away: string } | null
      advice?: string | null
      home_league_form?: string | null
      away_league_form?: string | null
      home_goals_avg?: string | null
      away_goals_avg?: string | null
    }
  }
}

interface GroupBetModalProps {
  groupId: string
  groupBalance: number
  initialEvent: EventRow
  groupSport: string | null
  onClose: () => void
  onSuccess: () => void
}

const betTypes = [
  { id: "direct", label: "Directa", icon: "⚔️" },
  { id: "exact_score", label: "Resultado Exacto", icon: "🎯" },
  { id: "run_line", label: "Run Line", icon: "📐" },
  { id: "total_runs", label: "Total Carreras", icon: "🔢" },
  { id: "score_margin", label: "Margen de Victoria", icon: "📏" },
  { id: "first_scorer", label: "Primer Anotador", icon: "🥅" },
  { id: "half_time", label: "Medio Tiempo", icon: "⏱️" },
]

function getAvailableBetTypes(sport: string) {
  if (sport === "football") return betTypes.filter((t) => !["run_line", "total_runs", "score_margin"].includes(t.id))
  if (sport === "basketball") return betTypes.filter((t) => ["direct", "score_margin"].includes(t.id))
  if (sport === "baseball") return betTypes.filter((t) => ["direct", "run_line", "total_runs"].includes(t.id))
  return betTypes.filter((t) => t.id === "direct")
}

export function GroupBetModal({ groupId, groupBalance, initialEvent, groupSport, onClose, onSuccess }: GroupBetModalProps) {
  const { showToast } = useToast()
  const sport = groupSport || initialEvent.sport

  const [betType, setBetType] = useState("direct")
  const [betSelection, setBetSelection] = useState("")
  const [exactScoreHome, setExactScoreHome] = useState(0)
  const [exactScoreAway, setExactScoreAway] = useState(0)
  const [multiplier, setMultiplier] = useState(1)
  const [amount, setAmount] = useState(Math.min(100, Math.max(1, Math.floor(groupBalance / 1.03))))
  const [feeIncluded, setFeeIncluded] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const fee = amount * 0.03
  const betAmount = feeIncluded ? amount - fee : amount
  const totalNeeded = amount + fee
  const maxAmountInteger = Math.max(1, Math.floor(groupBalance / 1.03))

  useEffect(() => {
    const available = getAvailableBetTypes(sport)
    if (!available.some(t => t.id === betType)) {
      setBetType("direct")
      setBetSelection("")
    }
  }, [sport, betType])

  useEffect(() => {
    if (betType !== "exact_score" && multiplier !== 1) setMultiplier(1)
  }, [betType, multiplier])

  function getBetOptions() {
    switch (betType) {
      case "direct":
        return [
          { id: "home_win", label: `Gana ${initialEvent.home_team}`, value: initialEvent.home_team },
          ...(sport === "football" ? [{ id: "draw", label: "Empate", value: "Empate" }] : []),
          { id: "away_win", label: `Gana ${initialEvent.away_team}`, value: initialEvent.away_team },
        ]
      case "first_scorer":
        return [
          { id: "home_team", label: initialEvent.home_team, value: initialEvent.home_team },
          { id: "away_team", label: initialEvent.away_team, value: initialEvent.away_team },
        ]
      case "run_line":
        return [
          { id: "home_rl", label: initialEvent.home_team, sublabel: "Gana por 2+ carreras", value: "home_rl" },
          { id: "away_rl", label: initialEvent.away_team, sublabel: "Gana o pierde por 1", value: "away_rl" },
        ]
      case "total_runs":
        return [
          { id: "over_7", label: "Más de 7", value: "over_7" },
          { id: "under_7", label: "Menos de 7", value: "under_7" },
          { id: "over_8", label: "Más de 8", value: "over_8" },
          { id: "under_8", label: "Menos de 8", value: "under_8" },
          { id: "over_9", label: "Más de 9", value: "over_9" },
          { id: "under_9", label: "Menos de 9", value: "under_9" },
          { id: "over_10", label: "Más de 10", value: "over_10" },
          { id: "under_10", label: "Menos de 10", value: "under_10" },
        ]
      case "score_margin":
        return [
          { id: "home_1_5", label: `${initialEvent.home_team} +1–5`, value: "home_1_5" },
          { id: "home_6_10", label: `${initialEvent.home_team} +6–10`, value: "home_6_10" },
          { id: "home_11_15", label: `${initialEvent.home_team} +11–15`, value: "home_11_15" },
          { id: "home_16plus", label: `${initialEvent.home_team} +16`, value: "home_16plus" },
          { id: "away_1_5", label: `${initialEvent.away_team} +1–5`, value: "away_1_5" },
          { id: "away_6_10", label: `${initialEvent.away_team} +6–10`, value: "away_6_10" },
          { id: "away_11_15", label: `${initialEvent.away_team} +11–15`, value: "away_11_15" },
          { id: "away_16plus", label: `${initialEvent.away_team} +16`, value: "away_16plus" },
        ]
      case "half_time":
        return [
          { id: "home_win", label: `Gana ${initialEvent.home_team}`, value: `${initialEvent.home_team} HT` },
          { id: "draw", label: "Empate", value: "Empate HT" },
          { id: "away_win", label: `Gana ${initialEvent.away_team}`, value: `${initialEvent.away_team} HT` },
        ]
      default:
        return []
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    let finalSelection = betSelection
    if (betType === "exact_score") {
      finalSelection = `${exactScoreHome}-${exactScoreAway}`
    } else if (!finalSelection) {
      setError("Selecciona una opción")
      return
    }

    if (groupBalance < totalNeeded) { setError("Tokens de grupo insuficientes"); return }

    setSubmitting(true)
    try {
      const supabase = createBrowserSupabaseClient()
      const { data: { session } } = await supabase.auth.getSession()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError("No autenticado"); return }

      const res = await fetch("/api/bets/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          userId: user.id,
          eventId: initialEvent.id,
          betType,
          selection: { betType, selection: finalSelection, exactScoreHome, exactScoreAway, event: initialEvent },
          amount: Math.round(betAmount),
          multiplier,
          fee: Math.round(fee),
          group_id: groupId,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Error al crear apuesta"); return }
      showToast("Apuesta creada en el grupo", "success")
      onSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  const preds = initialEvent.metadata?.predictions

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent onClose={onClose}>
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="flex items-center gap-2 px-5 pt-5 pb-3 border-b">
            <Trophy className="h-5 w-5 text-primary shrink-0" />
            <span className="font-semibold">Crear Apuesta</span>
            <div className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="font-semibold text-foreground">{groupBalance.toLocaleString()}</span> tokens
            </div>
          </div>

          <div className="px-5 py-4 space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Event card */}
            <div className="rounded-lg border bg-muted/10 p-3">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">{initialEvent.league}</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                  <span className="font-semibold text-sm truncate">{initialEvent.home_team}</span>
                  {initialEvent.home_logo
                    ? <img src={initialEvent.home_logo} alt="" className="w-8 h-8 object-contain shrink-0" />
                    : <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold shrink-0">{initialEvent.home_team[0]}</div>
                  }
                </div>
                <span className="text-muted-foreground text-xs font-bold shrink-0">vs</span>
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  {initialEvent.away_logo
                    ? <img src={initialEvent.away_logo} alt="" className="w-8 h-8 object-contain shrink-0" />
                    : <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold shrink-0">{initialEvent.away_team[0]}</div>
                  }
                  <span className="font-semibold text-sm truncate">{initialEvent.away_team}</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1 text-center">
                {new Date(initialEvent.start_time).toLocaleString("es-ES", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>

            {/* Bet type cards */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo de Apuesta</label>
              <div className="grid grid-cols-2 gap-2">
                {getAvailableBetTypes(sport).map((type) => (
                  <div
                    key={type.id}
                    className={`p-2 rounded-lg border cursor-pointer ${betType === type.id ? "border-primary bg-primary/10" : "hover:border-primary/50"}`}
                    onClick={() => { setBetType(type.id); setBetSelection("") }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{type.icon}</span>
                      <span className="font-medium text-sm truncate">{type.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Predictions */}
            {preds?.percent && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 space-y-2">
                <div className="text-xs font-semibold text-blue-300">🤖 Predicción</div>
                <div className="flex gap-2">
                  <div className="flex-1 text-center rounded bg-blue-500/10 border border-blue-500/20 p-1.5">
                    <div className="text-[9px] text-muted-foreground truncate">{initialEvent.home_team}</div>
                    <div className="text-sm font-bold text-blue-300">{preds.percent.home}</div>
                    {preds.home_league_form && (
                      <div className="flex gap-0.5 justify-center mt-0.5">
                        {preds.home_league_form.slice(-5).split("").map((c, i) => (
                          <span key={i} className={`inline-block w-1.5 h-1.5 rounded-full ${c === "W" ? "bg-green-500" : c === "D" ? "bg-gray-400" : "bg-red-500"}`} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-center rounded bg-gray-500/10 border border-gray-500/20 p-1.5">
                    <div className="text-[9px] text-muted-foreground">Empate</div>
                    <div className="text-sm font-bold text-gray-300">{preds.percent.draw}</div>
                  </div>
                  <div className="flex-1 text-center rounded bg-orange-500/10 border border-orange-500/20 p-1.5">
                    <div className="text-[9px] text-muted-foreground truncate">{initialEvent.away_team}</div>
                    <div className="text-sm font-bold text-orange-300">{preds.percent.away}</div>
                    {preds.away_league_form && (
                      <div className="flex gap-0.5 justify-center mt-0.5">
                        {preds.away_league_form.slice(-5).split("").map((c, i) => (
                          <span key={i} className={`inline-block w-1.5 h-1.5 rounded-full ${c === "W" ? "bg-green-500" : c === "D" ? "bg-gray-400" : "bg-red-500"}`} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {preds.advice && <p className="text-[10px] text-center text-amber-300/80">💡 {preds.advice}</p>}
                {(preds.home_goals_avg || preds.away_goals_avg) && (
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Goles/partido: <span className="text-foreground font-semibold">{preds.home_goals_avg}</span></span>
                    <span>Goles/partido: <span className="text-foreground font-semibold">{preds.away_goals_avg}</span></span>
                  </div>
                )}
              </div>
            )}

            {/* Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tu Selección</label>
              {betType === "total_runs" && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  📊 Apuesta al <strong>total de carreras sumadas</strong> entre los dos equipos.
                </p>
              )}
              {betType === "score_margin" && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  📏 Elegí un equipo <strong>y por cuántos puntos gana</strong>.
                </p>
              )}
              {betType === "run_line" && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  📐 <strong>Run Line</strong>: el favorito necesita ganar por 2+ carreras.
                </p>
              )}
              {betType === "exact_score" ? (
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <p className="font-semibold text-sm mb-2">{initialEvent.home_team}</p>
                    <Input
                      type="number" min={0} max={20} value={exactScoreHome}
                      onChange={(e) => setExactScoreHome(Number(e.target.value))}
                      className="w-20 text-center"
                    />
                  </div>
                  <span className="text-2xl font-bold">-</span>
                  <div className="text-center">
                    <p className="font-semibold text-sm mb-2">{initialEvent.away_team}</p>
                    <Input
                      type="number" min={0} max={20} value={exactScoreAway}
                      onChange={(e) => setExactScoreAway(Number(e.target.value))}
                      className="w-20 text-center"
                    />
                  </div>
                </div>
              ) : (
                <div className={`grid gap-2 ${["score_margin", "total_runs", "run_line"].includes(betType) ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
                  {getBetOptions().map((option) => {
                    const sub = (option as any).sublabel as string | undefined
                    return (
                      <Button
                        key={option.id}
                        type="button"
                        variant={betSelection === option.value ? "default" : "outline"}
                        size="sm"
                        className={sub ? "h-auto py-2.5 flex flex-col items-center gap-0.5" : ""}
                        onClick={() => setBetSelection(option.value)}
                      >
                        <span className={sub ? "font-semibold text-sm leading-tight" : ""}>{option.label}</span>
                        {sub && <span className="text-xs font-normal opacity-75 leading-tight">{sub}</span>}
                      </Button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <div className="rounded-lg border p-3 bg-muted/20">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Coins className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm">Tokens a apostar</span>
                  </div>
                  <span className="text-lg font-semibold">{amount.toLocaleString()}</span>
                </div>
                <input
                  type="range" min={1} max={maxAmountInteger} step={1} value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: "#eab308" }}
                />
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>{maxAmountInteger.toLocaleString()}</span>
                </div>
                <input
                  type="number" min={1} max={maxAmountInteger} value={amount}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v) && v >= 1) setAmount(Math.min(v, maxAmountInteger))
                  }}
                  className="mt-2 w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
                />
              </div>
              <p className="text-xs text-muted-foreground">Máximo disponible: {maxAmountInteger.toLocaleString()} tokens de grupo</p>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={feeIncluded} onChange={(e) => setFeeIncluded(e.target.checked)} className="w-4 h-4" />
                <span className="text-muted-foreground">Fee incluido</span>
              </label>
            </div>

            {betType === "exact_score" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Multiplicador</label>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((mult) => (
                    <Button key={mult} type="button" variant={multiplier === mult ? "default" : "outline"} size="sm" onClick={() => setMultiplier(mult)}>
                      x{mult}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 px-5 py-3 bg-card/95 backdrop-blur border-t border-border">
            {groupBalance < totalNeeded && (
              <p className="text-xs text-center text-destructive mb-2">Tokens de grupo insuficientes</p>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={
                  submitting ||
                  (betType !== "exact_score" && !betSelection) ||
                  groupBalance < totalNeeded ||
                  maxAmountInteger < 1
                }
              >
                {submitting ? "Creando..." : `Publicar (${amount.toLocaleString()} tokens)`}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
