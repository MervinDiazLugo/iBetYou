export function formatHouseBetTypeLabel(betType: string): string {
  const labels: Record<string, string> = {
    direct: "Directa",
    exact_score: "Resultado Exacto",
    run_line: "Run Line",
    total_runs: "Total Carreras",
    score_margin: "Margen",
    half_time: "Medio Tiempo",
    first_scorer: "Primer Anotador",
  }
  return labels[betType] ?? betType
}

export function formatHouseSelection(
  betType: string,
  selection: string,
  homeTeam?: string | null,
  awayTeam?: string | null,
): string {
  if (betType === "direct") {
    if (selection === "home") return homeTeam ? `Gana ${homeTeam}` : "Gana local"
    if (selection === "away") return awayTeam ? `Gana ${awayTeam}` : "Gana visitante"
    if (selection === "draw") return "Empate"
    return selection
  }

  if (betType === "run_line") {
    if (selection === "home_rl") return homeTeam ? `${homeTeam} gana por ≥2 carreras` : "Local gana por ≥2"
    if (selection === "away_rl") return awayTeam ? `${awayTeam} gana o pierde por 1` : "Visitante gana/pierde por 1"
    return selection
  }

  if (betType === "total_runs") {
    const m = selection.match(/^(over|under)_(\d+)$/)
    if (m) {
      const dir = m[1] === "over" ? "Más de" : "Menos de"
      return `${dir} ${m[2]} carreras`
    }
    return selection
  }

  if (betType === "score_margin") {
    const parts = selection.split("_")
    const team = parts[0]
    const teamName = team === "home" ? (homeTeam ?? "Local") : (awayTeam ?? "Visitante")
    const rangeKey = parts.slice(1).join("_")
    const rangeLabels: Record<string, string> = {
      "1_5": "1-5 puntos",
      "6_10": "6-10 puntos",
      "11_15": "11-15 puntos",
      "16plus": "16+ puntos",
    }
    const range = rangeLabels[rangeKey]
    if (range) return `${teamName} gana por ${range}`
    return selection
  }

  if (betType === "exact_score") {
    return `Resultado ${selection}`
  }

  return selection
}
