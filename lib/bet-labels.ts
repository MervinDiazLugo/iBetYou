export function formatHouseBetTypeLabel(betType: string): string {
  const labels: Record<string, string> = {
    direct: "Directa",
    exact_score: "Resultado Exacto",
    run_line: "Run Line",
    total_runs: "Total Carreras",
    score_margin: "Margen",
    half_time: "Medio Tiempo",
    first_scorer: "Primer Anotador",
    cards_over_under: "Tarjetas",
    goals_over_under: "Goles",
    both_teams_score: "Ambos Anotan",
    first_inning_score: "1er Inning",
    total_hits_over_under: "Total Hits",
    first_half_winner: "1er Tiempo",
    total_points_over_under: "Total Puntos",
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

  if (betType === "half_time") {
    const base = selection.replace(/ HT$/, "")
    if (base === "Empate") return "Empate al medio tiempo"
    const home = homeTeam ?? "Local"
    const away = awayTeam ?? "Visitante"
    if (base === home) return `${home} gana al medio tiempo`
    if (base === away) return `${away} gana al medio tiempo`
    return `${base} gana al medio tiempo`
  }

  if (betType === "first_scorer") {
    const home = homeTeam ?? "Local"
    const away = awayTeam ?? "Visitante"
    if (selection === home) return `${home} anota primero`
    if (selection === away) return `${away} anota primero`
    return `${selection} anota primero`
  }

  if (betType === "goals_over_under") {
    const m = selection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
    if (m) {
      const dir = m[1] === "over" ? "Más de" : "Menos de"
      return `${dir} ${m[2]} goles`
    }
    return selection
  }

  if (betType === "both_teams_score") {
    if (selection === "yes") return "Ambos equipos anotan"
    if (selection === "no") return "Al menos un equipo no anota"
    return selection
  }

  if (betType === "cards_over_under") {
    const m = selection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
    if (m) {
      const dir = m[1] === "over" ? "Más de" : "Menos de"
      return `${dir} ${m[2]} tarjetas`
    }
    return selection
  }

  if (betType === "first_inning_score") {
    if (selection === "nrfi") return "No anota ningún equipo en el 1er inning (NRFI)"
    if (selection === "yrfi") return "Algún equipo anota en el 1er inning (YRFI)"
    return selection
  }

  if (betType === "total_hits_over_under") {
    const m = selection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
    if (m) return `${m[1] === "over" ? "Más de" : "Menos de"} ${m[2]} hits totales`
    return selection
  }

  if (betType === "first_half_winner") {
    if (selection === "home") return homeTeam ? `Gana ${homeTeam} al descanso` : "Local gana el 1er tiempo"
    if (selection === "away") return awayTeam ? `Gana ${awayTeam} al descanso` : "Visita gana el 1er tiempo"
    if (selection === "draw") return "Empate al descanso"
    return selection
  }

  if (betType === "total_points_over_under") {
    const m = selection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
    if (m) return `${m[1] === "over" ? "Más de" : "Menos de"} ${m[2]} puntos totales`
    return selection
  }

  return selection
}
