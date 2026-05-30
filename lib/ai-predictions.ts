const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

interface EventForPrediction {
  id: number
  sport: string
  league: string
  home_team: string
  away_team: string
  metadata?: Record<string, unknown>
}

interface AiPrediction {
  percent: { home: string; away: string; draw?: string }
  advice: string
  winner: string
  ai_generated: true
}

export async function generateAiPredictions(
  events: EventForPrediction[]
): Promise<Map<number, AiPrediction>> {
  const result = new Map<number, AiPrediction>()
  if (!ANTHROPIC_API_KEY) return result

  const needsPredictions = events.filter(e => !(e.metadata as any)?.predictions?.percent)
  if (!needsPredictions.length) return result

  const matchList = needsPredictions
    .map((e, i) => `${i + 1}. [${e.sport}] ${e.home_team} vs ${e.away_team} (${e.league})`)
    .join("\n")

  const prompt = `You are a sports analyst generating win probability estimates for a Venezuelan P2P betting platform.

For each match below, estimate win probabilities based on your knowledge of these teams' recent form, historical records, and relevant context.

RULES:
- home + away must sum to 100 (integers only, no % symbol in the numbers)
- For football: also include draw probability (home + draw + away = 100)
- For baseball and basketball: no draw (home + away = 100)
- advice: in Spanish, 1 concise sentence naming the favored option
- winner: the team or outcome you favor most

Matches:
${matchList}

Respond with ONLY a JSON array, one object per match, in the same order:
[
  {"index": 1, "home": 55, "away": 45, "advice": "Ventaja local para los Yankees", "winner": "New York Yankees"},
  {"index": 2, "home": 30, "draw": 25, "away": 45, "advice": "Doble chance: Manchester City o empate", "winner": "Manchester City"}
]
No explanation. No markdown. Just the raw JSON array.`

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    })

    if (!res.ok) return result

    const data = await res.json()
    const text: string = data?.content?.[0]?.text ?? ""

    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return result

    const parsed: unknown = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return result

    for (const item of parsed as Record<string, unknown>[]) {
      const idx = Number(item.index) - 1
      if (!Number.isFinite(idx) || idx < 0 || idx >= needsPredictions.length) continue
      const event = needsPredictions[idx]

      const home = Number(item.home)
      const away = Number(item.away)
      const draw = typeof item.draw === "number" ? Number(item.draw) : undefined

      if (!Number.isFinite(home) || !Number.isFinite(away)) continue

      const prediction: AiPrediction = {
        percent: {
          home: `${home}%`,
          away: `${away}%`,
          ...(draw !== undefined ? { draw: `${draw}%` } : {}),
        },
        advice: String(item.advice ?? ""),
        winner: String(item.winner ?? ""),
        ai_generated: true,
      }

      result.set(event.id, prediction)
    }
  } catch {
    // fail silently — predictions are non-critical
  }

  return result
}
