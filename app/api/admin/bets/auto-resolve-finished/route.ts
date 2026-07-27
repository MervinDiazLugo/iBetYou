import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createNotifications } from "@/lib/notifications"
import { calculateTotalPrize } from "@/lib/bet-resolution"
import { updateWageringProgress } from "@/lib/referrals"
import { payoutToMode, tokenTypeForMode } from "@/lib/wallet-utils"
import { houseWalletCredit } from "@/lib/house-wallet"
import { tsdbEventTimeline, extractYellowCards, extractHalfTimeScore, tsdbLookupEvent, parseBaseballInnings, parseBasketballQuarters } from "@/lib/tsdb"

const FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const BASEBALL_URL = process.env.API_BASEBALL_URL || "https://v1.baseball.api-sports.io"
const BASKETBALL_URL = process.env.API_BASKETBALL_URL || "https://v1.basketball.api-sports.io"
const API_KEY = process.env.API_FOOTBALL_KEY

function fetchApiSports(url: string): Promise<any> {
  if (!API_KEY) return Promise.reject(new Error("API_FOOTBALL_KEY not set"))
  return new Promise((resolve, reject) => {
    const { hostname, pathname, search } = new URL(url)
    const req = https.request(
      { method: "GET", hostname, path: pathname + search, headers: { "x-apisports-key": API_KEY } },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
          catch (e) { reject(e) }
        })
      }
    )
    req.setTimeout(8000, () => { req.destroy(new Error("timeout")) })
    req.on("error", reject)
    req.end()
  })
}

async function fetchScoresOnDemand(externalId: string): Promise<{ homeScore: number; awayScore: number } | null> {
  try {
    if (externalId.startsWith("football_")) {
      const fixtureId = externalId.replace("football_", "")
      const data = await fetchApiSports(`${FOOTBALL_URL}/fixtures?id=${fixtureId}`)
      const item = data.response?.[0]
      const home = item?.goals?.home
      const away = item?.goals?.away
      if (home !== null && home !== undefined && away !== null && away !== undefined) return { homeScore: home, awayScore: away }
    } else if (externalId.startsWith("baseball_")) {
      const gameId = externalId.replace("baseball_", "")
      const data = await fetchApiSports(`${BASEBALL_URL}/games?id=${gameId}`)
      const item = data.response?.[0]
      const home = item?.scores?.home?.total
      const away = item?.scores?.away?.total
      if (home !== null && home !== undefined && away !== null && away !== undefined) return { homeScore: home, awayScore: away }
    } else if (externalId.startsWith("basketball_")) {
      const gameId = externalId.replace("basketball_", "")
      const data = await fetchApiSports(`${BASKETBALL_URL}/games?id=${gameId}`)
      const item = data.response?.[0]
      const home = item?.scores?.home?.total
      const away = item?.scores?.away?.total
      if (home !== null && home !== undefined && away !== null && away !== undefined) return { homeScore: home, awayScore: away }
    }
  } catch (_) { /* fall through */ }
  return null
}

function hasValidResolveSecret(request: NextRequest) {
  const expected = process.env.AUTO_RESOLVE_API_SECRET || process.env.CRON_SECRET
  if (!expected) return false
  const byHeader = request.headers.get("x-auto-resolve-secret")
  if (byHeader && byHeader === expected) return true
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (token === expected) return true
  }
  return false
}

function extractCreatorSelection(bet: {
  creator_selection?: string | null
  selection?: string | null
}) {
  let selection = bet.creator_selection || ""
  if (bet.selection) {
    try {
      const parsed = JSON.parse(bet.selection)
      selection = parsed.selection || parsed.creator_selection || selection
    } catch { /* keep fallback */ }
  }
  return selection
}

// ─── exact_score ─────────────────────────────────────────────────────────────

function parseExactScore(value: string) {
  const match = value.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/)
  if (!match) return null
  return { home: Number(match[1]), away: Number(match[2]) }
}

function resolveExactScore(
  creatorSelection: string,
  event: { home_score: number; away_score: number },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const parsed = parseExactScore(creatorSelection)
  if (!parsed) return null
  const match = event.home_score === parsed.home && event.away_score === parsed.away
  return {
    winnerId: match ? bet.creator_id : bet.acceptor_id,
    reason: `exact_score: selección ${creatorSelection}, resultado ${event.home_score}-${event.away_score}`,
  }
}

// ─── half_time ────────────────────────────────────────────────────────────────

function fuzzyMatchTeam(sel: string, home: string, away: string) {
  let choseHome = sel === home
  let choseAway = sel === away

  if (!choseHome && !choseAway) {
    const homeWords = home.split(/[\s\-_.]/).filter((w) => w.length > 1)
    const awayWords = away.split(/[\s\-_.]/).filter((w) => w.length > 1)
    const selWords = sel.split(/[\s\-_.]/).filter((w) => w.length > 1)

    for (const word of selWords) {
      if (home.includes(word)) { choseHome = true; break }
      if (away.includes(word)) { choseAway = true; break }
    }
    if (!choseHome && !choseAway) {
      for (const word of homeWords) { if (sel.includes(word)) { choseHome = true; break } }
      for (const word of awayWords) { if (sel.includes(word)) { choseAway = true; break } }
    }
  }

  return { choseHome, choseAway }
}

function resolveHalfTime(
  creatorSelection: string,
  event: { home_team: string; away_team: string; metadata?: any },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const md = event.metadata?.match_details
  const htHome = md?.halftime_home_score
  const htAway = md?.halftime_away_score

  if (htHome === null || htHome === undefined || htAway === null || htAway === undefined) return null

  // Strip " HT" suffix from selection
  const sel = creatorSelection.toLowerCase().trim().replace(/\s+ht$/i, "").trim()
  const homeNorm = (event.home_team || "").toLowerCase().trim()
  const awayNorm = (event.away_team || "").toLowerCase().trim()

  const choseDraw = ["empate", "draw", "tie"].includes(sel)
  const { choseHome, choseAway } = choseDraw ? { choseHome: false, choseAway: false } : fuzzyMatchTeam(sel, homeNorm, awayNorm)

  if (!choseDraw && !choseHome && !choseAway) return null

  const htHomeWon = htHome > htAway
  const htAwayWon = htAway > htHome
  const htDraw = htHome === htAway

  let winnerId: string
  if (choseDraw) {
    winnerId = htDraw ? bet.creator_id : bet.acceptor_id
  } else if (choseHome) {
    winnerId = htHomeWon ? bet.creator_id : bet.acceptor_id
  } else {
    winnerId = htAwayWon ? bet.creator_id : bet.acceptor_id
  }

  return {
    winnerId,
    reason: `half_time: selección "${creatorSelection}", HT ${htHome}-${htAway}`,
  }
}

// ─── direct ───────────────────────────────────────────────────────────────────

function resolveDirect(
  creatorSelection: string,
  event: { home_team: string; away_team: string; home_score: number; away_score: number },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const sel = creatorSelection.toLowerCase().trim()

  // House bet keywords resolve directly — "home"/"away"/"draw" never match team names via fuzzy
  let choseHome = sel === "home"
  let choseAway = sel === "away"
  const choseDraw = ["empate", "draw", "tie", "draw"].includes(sel)

  if (!choseHome && !choseAway && !choseDraw) {
    // P2P bet: fuzzy-match against team names
    const homeNorm = (event.home_team || "").toLowerCase().trim()
    const awayNorm = (event.away_team || "").toLowerCase().trim()
    const fuzzy = fuzzyMatchTeam(sel, homeNorm, awayNorm)
    choseHome = fuzzy.choseHome
    choseAway = fuzzy.choseAway
  }

  if (!choseDraw && !choseHome && !choseAway) return null

  const homeWon = event.home_score > event.away_score
  const awayWon = event.away_score > event.home_score
  const isDraw = event.home_score === event.away_score

  let winnerId: string
  if (choseDraw) {
    winnerId = isDraw ? bet.creator_id : bet.acceptor_id
  } else if (choseHome) {
    winnerId = homeWon ? bet.creator_id : bet.acceptor_id
  } else {
    winnerId = awayWon ? bet.creator_id : bet.acceptor_id
  }

  return {
    winnerId,
    reason: `direct: selección "${creatorSelection}", resultado ${event.home_score}-${event.away_score}`,
  }
}

// ─── first_scorer ─────────────────────────────────────────────────────────────

function resolveFirstScorer(
  creatorSelection: string,
  event: { home_team: string; away_team: string; home_score: number; away_score: number; metadata?: any },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const totalGoals = (event.home_score || 0) + (event.away_score || 0)

  // No goals → no first scorer possible → creator's prediction is wrong
  if (totalGoals === 0) {
    return {
      winnerId: bet.acceptor_id,
      reason: `first_scorer: partido terminó 0-0, no hubo primer anotador`,
    }
  }

  const firstScorer = event.metadata?.match_details?.first_scorer
  if (!firstScorer?.team) return null

  const sel = creatorSelection.toLowerCase().trim()
  const homeNorm = (event.home_team || "").toLowerCase().trim()
  const awayNorm = (event.away_team || "").toLowerCase().trim()
  const firstTeam = (firstScorer.team || "").toLowerCase().trim()

  const { choseHome, choseAway } = fuzzyMatchTeam(sel, homeNorm, awayNorm)
  if (!choseHome && !choseAway) return null

  const firstTeamIsHome = homeNorm.includes(firstTeam) || firstTeam.includes(homeNorm) ||
    fuzzyMatchTeam(firstTeam, homeNorm, awayNorm).choseHome
  const firstTeamIsAway = !firstTeamIsHome

  let winnerId: string
  if (choseHome) {
    winnerId = firstTeamIsHome ? bet.creator_id : bet.acceptor_id
  } else {
    winnerId = firstTeamIsAway ? bet.creator_id : bet.acceptor_id
  }

  return {
    winnerId,
    reason: `first_scorer: selección "${creatorSelection}", primer anotador ${firstScorer.player || "?"} (${firstScorer.team}) min.${firstScorer.minute ?? "?"}`,
  }
}

// ─── run_line ─────────────────────────────────────────────────────────────────

function resolveRunLine(
  creatorSelection: string,
  event: { home_score: number; away_score: number },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const margin = event.home_score - event.away_score // positive = home leads

  let creatorWins: boolean
  if (creatorSelection === "home_rl") {
    creatorWins = margin >= 2          // home covers -1.5: wins by 2+
  } else if (creatorSelection === "away_rl") {
    creatorWins = margin <= 1          // away covers +1.5: away wins OR home wins by exactly 1
  } else {
    return null
  }

  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `run_line: selección "${creatorSelection}", resultado ${event.home_score}-${event.away_score} (margen ${margin})`,
  }
}

// ─── total_runs ───────────────────────────────────────────────────────────────

function resolveTotalRuns(
  creatorSelection: string,
  event: { home_score: number; away_score: number },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const parts = creatorSelection.split("_")
  if (parts.length !== 2) return null
  const direction = parts[0]
  const threshold = Number(parts[1])
  if (!Number.isFinite(threshold)) return null

  const total = event.home_score + event.away_score
  if (total === threshold) return null  // push — skip, refund via manual resolution

  let creatorWins: boolean
  if (direction === "over")       creatorWins = total > threshold
  else if (direction === "under") creatorWins = total < threshold
  else return null

  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `total_runs: selección "${creatorSelection}", total ${total} carreras (${event.home_score}+${event.away_score})`,
  }
}

// ─── score_margin ─────────────────────────────────────────────────────────────

function resolveScoreMargin(
  creatorSelection: string,
  event: { home_score: number; away_score: number },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const parts = creatorSelection.split("_")
  if (parts.length < 2) return null

  const team = parts[0] // "home" | "away"
  const rangeKey = parts.slice(1).join("_") // "1_5" | "6_10" | "11_15" | "16plus"

  const margin = Math.abs(event.home_score - event.away_score)
  const homeWon = event.home_score > event.away_score
  const awayWon = event.away_score > event.home_score

  let rangeMin: number, rangeMax: number
  if (rangeKey === "1_5")       { rangeMin = 1;  rangeMax = 5  }
  else if (rangeKey === "6_10") { rangeMin = 6;  rangeMax = 10 }
  else if (rangeKey === "11_15"){ rangeMin = 11; rangeMax = 15 }
  else if (rangeKey === "16plus"){ rangeMin = 16; rangeMax = Infinity }
  else return null

  const inRange = margin >= rangeMin && margin <= rangeMax
  let creatorWins: boolean

  if (team === "home")      creatorWins = homeWon && inRange
  else if (team === "away") creatorWins = awayWon && inRange
  else return null

  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `score_margin: selección "${creatorSelection}", resultado ${event.home_score}-${event.away_score} (margen ${margin})`,
  }
}

// ─── goals_over_under ─────────────────────────────────────────────────────────

function resolveGoalsOverUnder(
  creatorSelection: string,
  event: { home_score: number; away_score: number },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const m = creatorSelection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const direction = m[1]
  const threshold = Number(m[2])
  const total = event.home_score + event.away_score
  const creatorWins = direction === "over" ? total > threshold : total < threshold
  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `goals_over_under: selección "${creatorSelection}", goles totales: ${total} (${event.home_score}+${event.away_score})`,
  }
}

// ─── both_teams_score ─────────────────────────────────────────────────────────

function resolveBothTeamsScore(
  creatorSelection: string,
  event: { home_score: number; away_score: number },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  if (creatorSelection !== "yes" && creatorSelection !== "no") return null
  const btts = event.home_score > 0 && event.away_score > 0
  const creatorWins = creatorSelection === "yes" ? btts : !btts
  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `both_teams_score: selección "${creatorSelection}", resultado ${event.home_score}-${event.away_score} → BTTS=${btts}`,
  }
}

// ─── cards_over_under ─────────────────────────────────────────────────────────

function resolveCardsOverUnder(
  creatorSelection: string,
  event: { metadata?: any },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const totalCards = event.metadata?.match_details?.yellow_cards_total
  if (totalCards === null || totalCards === undefined) return null

  // selection format: "over_2.5" | "under_3.5"
  const m = creatorSelection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
  if (!m) return null

  const direction = m[1]
  const threshold = Number(m[2])

  const creatorWins = direction === "over" ? totalCards > threshold : totalCards < threshold

  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `cards_over_under: selección "${creatorSelection}", tarjetas amarillas totales: ${totalCards}`,
  }
}

// ─── first_inning_score (NRFI/YRFI) ──────────────────────────────────────────

function resolveFirstInningScore(
  creatorSelection: string,
  event: { metadata?: any },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const md = event.metadata?.match_details
  const inn1Home = md?.first_inning_home
  const inn1Away = md?.first_inning_away
  if (inn1Home === null || inn1Home === undefined || inn1Away === null || inn1Away === undefined) return null

  const yrfi = inn1Home > 0 || inn1Away > 0
  const sel = creatorSelection.toLowerCase().trim()
  if (sel !== "nrfi" && sel !== "yrfi") return null

  const creatorWins = sel === "yrfi" ? yrfi : !yrfi
  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `first_inning_score: selección "${creatorSelection}", 1er inning local ${inn1Home} - visita ${inn1Away}`,
  }
}

// ─── total_hits_over_under ────────────────────────────────────────────────────

function resolveTotalHitsOverUnder(
  creatorSelection: string,
  event: { metadata?: any },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const md = event.metadata?.match_details
  const homeHits = md?.total_home_hits
  const awayHits = md?.total_away_hits
  if (homeHits === null || homeHits === undefined || awayHits === null || awayHits === undefined) return null

  const m = creatorSelection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const direction = m[1]
  const threshold = Number(m[2])
  const total = homeHits + awayHits
  const creatorWins = direction === "over" ? total > threshold : total < threshold
  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `total_hits_over_under: selección "${creatorSelection}", total ${total} hits (${homeHits}+${awayHits})`,
  }
}

// ─── first_half_winner (basketball) ──────────────────────────────────────────

function resolveFirstHalfWinner(
  creatorSelection: string,
  event: { metadata?: any },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const md = event.metadata?.match_details
  const half1Home = md?.half1_home
  const half1Away = md?.half1_away
  if (half1Home === null || half1Home === undefined || half1Away === null || half1Away === undefined) return null

  const sel = creatorSelection.toLowerCase().trim()
  const homeWon = half1Home > half1Away
  const awayWon = half1Away > half1Home
  const isDraw = half1Home === half1Away

  let creatorWins: boolean
  if (sel === "home")      creatorWins = homeWon
  else if (sel === "away") creatorWins = awayWon
  else if (sel === "draw") creatorWins = isDraw
  else return null

  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `first_half_winner: selección "${creatorSelection}", 1er tiempo ${half1Home}-${half1Away}`,
  }
}

// ─── total_points_over_under (basketball) ────────────────────────────────────

function resolveTotalPointsOverUnder(
  creatorSelection: string,
  event: { home_score: number; away_score: number },
  bet: { creator_id: string; acceptor_id: string }
): { winnerId: string; reason: string } | null {
  const m = creatorSelection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const direction = m[1]
  const threshold = Number(m[2])
  const total = event.home_score + event.away_score
  if (total === threshold) return null
  const creatorWins = direction === "over" ? total > threshold : total < threshold
  return {
    winnerId: creatorWins ? bet.creator_id : bet.acceptor_id,
    reason: `total_points_over_under: selección "${creatorSelection}", total ${total} puntos (${event.home_score}+${event.away_score})`,
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

const RESOLVABLE_TYPES = ["direct", "exact_score", "run_line", "total_runs", "score_margin", "half_time", "first_scorer", "cards_over_under", "goals_over_under", "both_teams_score", "first_inning_score", "total_hits_over_under", "first_half_winner", "total_points_over_under", "live_match_winner", "live_total_ou"]

export async function POST(request: NextRequest) {
  const authorizedBySecret = hasValidResolveSecret(request)
  let decidedBy = "system"

  if (!authorizedBySecret) {
    const auth = await requireBackofficeAdmin(request)
    if (!auth.authorized) return auth.response
    decidedBy = auth.userId || "system"
  }

  const supabase = createAdminSupabaseClient()

  try {
    // Sweep: cancel house bets for cancelled/postponed events
    const { data: strandedBets } = await supabase
      .from("bets")
      .select("id, creator_id, amount, potential_payout, mode, event_id, bet_type")
      .eq("house_bet", true)
      .eq("status", "taken")

    // Filter to only those with cancelled/postponed events
    const strandedEventIds = (strandedBets || []).map(b => b.event_id)
    let cancelledEventIds: number[] = []
    if (strandedEventIds.length > 0) {
      const { data: cancelledEvents } = await supabase
        .from("events")
        .select("id")
        .in("id", strandedEventIds)
        .in("status", ["cancelled", "postponed"])
      cancelledEventIds = (cancelledEvents || []).map(e => e.id)
    }

    for (const sb of (strandedBets || []).filter(b => cancelledEventIds.includes(b.event_id))) {
      const stake = Number(sb.amount || 0)
      const potentialPayout = Number(sb.potential_payout || 0)
      const houseRisk = potentialPayout - stake
      const betMode = (sb as any).mode ?? "fantasy"

      const { error: cancelErr } = await supabase
        .from("bets")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("id", sb.id)
        .eq("status", "taken")

      if (cancelErr) {
        console.error("STRANDED_HOUSE_BET_CANCEL_FAILED", { betId: sb.id, error: cancelErr })
        continue
      }

      try {
        await payoutToMode(supabase, sb.creator_id, stake, betMode)
        await supabase.from("transactions").insert({
          user_id: sb.creator_id,
          token_type: betMode === "real" ? "iBY" : "fantasy",
          amount: stake,
          operation: "bet_cancelled_refund",
          reference_id: sb.id,
        })
      } catch (err) {
        console.error("STRANDED_HOUSE_BET_PAYOUT_FAILED", { betId: sb.id, userId: sb.creator_id, error: err })
      }
      if (houseRisk > 0) {
        try { await houseWalletCredit(supabase, houseRisk, betMode) } catch (err) {
          console.error("STRANDED_HOUSE_BET_CREDIT_FAILED", { betId: sb.id, houseRisk, error: err })
        }
      }

      await supabase.from("arbitration_decisions").insert({
        bet_id: sb.id,
        action: "auto_cancel_event_cancelled",
        previous_status: "taken",
        new_status: "cancelled",
        decided_winner_id: null,
        reason: "Evento cancelado o pospuesto — stake devuelto automáticamente",
        details: { house_bet: true, bet_type: sb.bet_type, event_id: sb.event_id },
        decided_by: "system",
        source: "system",
      })

      await createNotifications([{
        userId: sb.creator_id,
        type: "bet_cancelled",
        title: "Apuesta cancelada — evento pospuesto",
        body: "Tu stake fue devuelto porque el evento fue cancelado o pospuesto.",
        betId: sb.id,
      }], supabase)
    }

    const body = await request.json().catch(() => ({}))
    const eventId = Number(body?.event_id)
    const hasEventFilter = Number.isFinite(eventId) && eventId > 0
    const dryRun = Boolean(body?.dry_run)
    const betTypes: string[] = Array.isArray(body?.bet_types)
      ? body.bet_types.filter((t: string) => RESOLVABLE_TYPES.includes(t))
      : RESOLVABLE_TYPES

    // ── Cancel open bets on finished events (never accepted) ─────────────────
    let openQuery = supabase
      .from("bets")
      .select("id, creator_id, amount, mode, group_id, event_id, bet_type, event:events(status)")
      .eq("status", "open")
      .is("acceptor_id", null)

    if (hasEventFilter) openQuery = openQuery.eq("event_id", eventId)

    const { data: openBets } = await openQuery
    const cancelledOpen: string[] = []

    for (const ob of (openBets || [])) {
      const evStatus = (Array.isArray((ob as any).event) ? (ob as any).event[0] : (ob as any).event)?.status
      if (evStatus !== "finished") continue

      if (!dryRun) {
        const { error: cancelErr } = await supabase
          .from("bets")
          .update({ status: "cancelled", resolved_at: new Date().toISOString() })
          .eq("id", ob.id)
          .eq("status", "open")

        if (cancelErr) {
          console.error("OPEN_BET_CANCEL_FAILED", { betId: ob.id, error: cancelErr })
          continue
        }

        const stake = Number(ob.amount || 0)
        const betMode = (ob as any).mode ?? "fantasy"
        const betGroupId = (ob as any).group_id ?? null

        try {
          if (betGroupId) {
            const { creditGroupWallet } = await import("@/lib/group-wallet-utils")
            await creditGroupWallet(supabase, betGroupId, ob.creator_id, stake)
          } else {
            await payoutToMode(supabase, ob.creator_id, stake, betMode)
          }
          await supabase.from("transactions").insert({
            user_id: ob.creator_id,
            token_type: betGroupId ? "group_fantasy" : tokenTypeForMode(betMode),
            amount: stake,
            operation: "bet_cancelled_event_finished",
            reference_id: ob.id,
          })
        } catch (refundErr) {
          console.error("OPEN_BET_REFUND_FAILED", { betId: ob.id, userId: ob.creator_id, error: refundErr })
        }

        await supabase.from("arbitration_decisions").insert({
          bet_id: ob.id,
          action: "auto_cancel_event_finished",
          previous_status: "open",
          new_status: "cancelled",
          decided_winner_id: null,
          reason: "Evento finalizado sin aceptante — stake devuelto al creador",
          details: { bet_type: ob.bet_type, event_id: ob.event_id, group_id: betGroupId },
          decided_by: "system",
          source: "system",
        })

        await createNotifications([{
          userId: ob.creator_id,
          type: "bet_cancelled",
          title: "Apuesta cancelada — evento finalizado",
          body: "Nadie tomó tu apuesta antes de que terminara el evento. Tu stake fue devuelto.",
          betId: ob.id,
        }], supabase)
      }

      cancelledOpen.push(ob.id)
    }

    let query = supabase
      .from("bets")
      .select(`
        id, event_id, creator_id, acceptor_id, amount, multiplier,
        status, bet_type, creator_selection, selection, mode, group_id,
        house_bet, house_odds, potential_payout,
        event:events(id, external_id, status, home_score, away_score, home_team, away_team, metadata)
      `)
      .in("bet_type", betTypes)
      .in("status", ["taken", "disputed", "pending_resolution", "pending_resolution_creator", "pending_resolution_acceptor"])
      .limit(2000)

    if (hasEventFilter) query = query.eq("event_id", eventId)

    const { data: bets, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // ── P2P-live settlement pass (separate from RESOLVABLE_TYPES loop) ──
    // Resolves live bets that were pending until the match ended (e.g. "no more scoring", or
    // "next team" void when nobody scored). Triggered per finished event by sync-scores.
    let liveSettled = 0
    if (hasEventFilter) {
      const { data: fin } = await supabase
        .from("events").select("status, home_score, away_score").eq("id", eventId).single()
      if (fin && (fin.status || "").toLowerCase() === "finished") {
        const { settleLiveBetsForEvent } = await import("@/lib/settle-live-bets")
        liveSettled = await settleLiveBetsForEvent(
          supabase, eventId, { home: fin.home_score ?? 0, away: fin.away_score ?? 0 }, true
        )
      }
    }

    const results: Array<Record<string, unknown>> = []
    let scanned = 0, eligible = 0, resolved = 0, skipped = 0, failed = 0

    for (const bet of bets || []) {
      scanned += 1
      const eventRow = (Array.isArray((bet as any).event) ? (bet as any).event[0] : (bet as any).event) as any

      if (!eventRow) { skipped += 1; continue }

      const betType: string = (bet as any).bet_type
      const isFinished = (eventRow.status || "").toLowerCase() === "finished"
      if (!isFinished) {
        skipped += 1; continue
      }

      // For score-based bets: try fetching scores on-demand if null
      if ((eventRow.home_score === null || eventRow.away_score === null) &&
          (betType === "direct" || betType === "exact_score" || betType === "run_line" || betType === "total_runs" || betType === "live_match_winner" || betType === "live_total_ou")) {
        const scores = await fetchScoresOnDemand(eventRow.external_id || "")
        if (scores) {
          await supabase.from("events").update({
            home_score: scores.homeScore,
            away_score: scores.awayScore,
          }).eq("id", eventRow.id)
          eventRow.home_score = scores.homeScore
          eventRow.away_score = scores.awayScore
        }
      }

      if (eventRow.home_score === null || eventRow.away_score === null) {
        skipped += 1; continue
      }

      eligible += 1
      const creatorSelection = extractCreatorSelection({
        creator_selection: (bet as any).creator_selection,
        selection: (bet as any).selection,
      })
      // Treat as house bet if flag is set OR acceptor is null (P2P bets always have an acceptor in "taken" status)
      const isHouseBet = Boolean((bet as any).house_bet) || (bet as any).acceptor_id === null
      const betForResolver = {
        creator_id: (bet as any).creator_id as string,
        acceptor_id: (isHouseBet ? "house" : (bet as any).acceptor_id) as string,
      }

      let resolution: { winnerId: string; reason: string } | null = null

      if (betType === "direct") {
        resolution = resolveDirect(creatorSelection, eventRow, betForResolver)
      } else if (betType === "live_match_winner") {
        resolution = resolveDirect(creatorSelection, eventRow, betForResolver)
      } else if (betType === "live_total_ou") {
        resolution = resolveGoalsOverUnder(creatorSelection, eventRow, betForResolver)
      } else if (betType === "exact_score") {
        resolution = resolveExactScore(creatorSelection, eventRow, betForResolver)
      } else if (betType === "run_line") {
        resolution = resolveRunLine(creatorSelection, eventRow, betForResolver)
      } else if (betType === "total_runs") {
        resolution = resolveTotalRuns(creatorSelection, eventRow, betForResolver)
      } else if (betType === "score_margin") {
        resolution = resolveScoreMargin(creatorSelection, eventRow, betForResolver)
      } else if (betType === "half_time") {
        // Fetch halftime scores on-demand if missing (e.g. admin manually set status=finished)
        const md = eventRow.metadata?.match_details
        const htMissing = md?.halftime_home_score === null || md?.halftime_home_score === undefined
        const externalIdHT: string = eventRow.external_id || ""
        if (htMissing && externalIdHT.startsWith("football_")) {
          try {
            const fixtureId = externalIdHT.replace("football_", "")
            const data = await fetchApiSports(`${FOOTBALL_URL}/fixtures?id=${fixtureId}`)
            const fixture = data.response?.[0]
            const htHome = fixture?.score?.halftime?.home
            const htAway = fixture?.score?.halftime?.away
            if (htHome !== null && htHome !== undefined && htAway !== null && htAway !== undefined) {
              const meta = eventRow.metadata || {}
              const matchDetails = { ...(meta.match_details || {}), halftime_home_score: htHome, halftime_away_score: htAway }
              const updatedMetadata = { ...meta, match_details: matchDetails }
              await supabase.from("events").update({ metadata: updatedMetadata }).eq("id", eventRow.id)
              eventRow.metadata = updatedMetadata
            }
          } catch (_) { /* proceed without halftime, will skip */ }
        }
        // For TSDB events: reconstruct HT score from V2 timeline (count goals ≤ min 45)
        if (htMissing && externalIdHT.startsWith("tsdb_")) {
          try {
            const idEvent = externalIdHT.replace("tsdb_", "")
            const timeline = await tsdbEventTimeline(idEvent)
            const ht = extractHalfTimeScore(timeline)
            if (ht !== null) {
              const meta = eventRow.metadata || {}
              const matchDetails = { ...(meta.match_details || {}), halftime_home_score: ht.home, halftime_away_score: ht.away }
              const updatedMetadata = { ...meta, match_details: matchDetails }
              await supabase.from("events").update({ metadata: updatedMetadata }).eq("id", eventRow.id)
              eventRow.metadata = updatedMetadata
            }
          } catch (_) { /* proceed without halftime, will skip */ }
        }
        resolution = resolveHalfTime(creatorSelection, eventRow, betForResolver)
      } else if (betType === "first_scorer") {
        // Fetch first_scorer metadata on-demand if missing (e.g. admin manually set status=finished)
        const hasFirstScorerMeta = !!eventRow.metadata?.match_details?.first_scorer?.team
        const externalId: string = eventRow.external_id || ""
        if (!hasFirstScorerMeta && externalId.startsWith("football_") && (eventRow.home_score + eventRow.away_score) > 0) {
          try {
            const fixtureId = externalId.replace("football_", "")
            const data = await fetchApiSports(`${FOOTBALL_URL}/fixtures/events?fixture=${fixtureId}`)
            const fixtureEvents: any[] = data.response || []
            const firstGoal = fixtureEvents.find((e: any) => e.type === "Goal" && e.detail !== "Missed Penalty")
            if (firstGoal) {
              const md = eventRow.metadata || {}
              const matchDetails = { ...(md.match_details || {}), first_scorer: {
                player: firstGoal.player?.name || null,
                team: firstGoal.team?.name || null,
                minute: firstGoal.time?.elapsed ?? null,
              }}
              const updatedMetadata = { ...md, match_details: matchDetails }
              await supabase.from("events").update({ metadata: updatedMetadata }).eq("id", eventRow.id)
              eventRow.metadata = updatedMetadata
            }
          } catch (_) { /* proceed without first_scorer, will skip */ }
        }
        resolution = resolveFirstScorer(creatorSelection, eventRow, betForResolver)
      } else if (betType === "cards_over_under") {
        // Fetch yellow cards on-demand if missing from metadata
        const hasCardsMeta = eventRow.metadata?.match_details?.yellow_cards_total != null
        const externalId: string = eventRow.external_id || ""
        if (!hasCardsMeta && externalId.startsWith("tsdb_")) {
          try {
            const idEvent = externalId.replace("tsdb_", "")
            const timeline = await tsdbEventTimeline(idEvent)
            const cards = extractYellowCards(timeline)
            const md = eventRow.metadata || {}
            const matchDetails = {
              ...(md.match_details || {}),
              yellow_cards_home: cards.home,
              yellow_cards_away: cards.away,
              yellow_cards_total: cards.total,
            }
            const updatedMetadata = { ...md, match_details: matchDetails }
            await supabase.from("events").update({ metadata: updatedMetadata }).eq("id", eventRow.id)
            eventRow.metadata = updatedMetadata
          } catch (_) { /* proceed, resolver will return null and skip */ }
        }
        resolution = resolveCardsOverUnder(creatorSelection, eventRow, betForResolver)
      } else if (betType === "goals_over_under") {
        resolution = resolveGoalsOverUnder(creatorSelection, eventRow, betForResolver)
      } else if (betType === "both_teams_score") {
        resolution = resolveBothTeamsScore(creatorSelection, eventRow, betForResolver)
      } else if (betType === "total_points_over_under") {
        resolution = resolveTotalPointsOverUnder(creatorSelection, eventRow, betForResolver)
      } else if (betType === "first_inning_score" || betType === "total_hits_over_under") {
        // Fetch strResult on-demand if inning metadata is missing
        const hasMeta = eventRow.metadata?.match_details?.first_inning_home != null
        const externalId: string = eventRow.external_id || ""
        if (!hasMeta && externalId.startsWith("tsdb_")) {
          try {
            const idEvent = externalId.replace("tsdb_", "")
            const raw = await tsdbLookupEvent(idEvent)
            if (raw?.strResult) {
              const parsed = parseBaseballInnings(raw.strResult)
              if (parsed) {
                const md = eventRow.metadata || {}
                const matchDetails = {
                  ...(md.match_details || {}),
                  first_inning_home: parsed.homeInnings[0] ?? null,
                  first_inning_away: parsed.awayInnings[0] ?? null,
                  total_home_hits: parsed.homeHits,
                  total_away_hits: parsed.awayHits,
                }
                await supabase.from("events").update({ metadata: { ...md, match_details: matchDetails } }).eq("id", eventRow.id)
                eventRow.metadata = { ...md, match_details: matchDetails }
              }
            }
          } catch (_) { /* will skip if metadata still missing */ }
        }
        if (betType === "first_inning_score") {
          resolution = resolveFirstInningScore(creatorSelection, eventRow, betForResolver)
        } else {
          resolution = resolveTotalHitsOverUnder(creatorSelection, eventRow, betForResolver)
        }
      } else if (betType === "first_half_winner") {
        // Fetch strResult on-demand if half1 metadata is missing
        const hasHalf1 = eventRow.metadata?.match_details?.half1_home != null
        const externalId: string = eventRow.external_id || ""
        if (!hasHalf1 && externalId.startsWith("tsdb_")) {
          try {
            const idEvent = externalId.replace("tsdb_", "")
            const raw = await tsdbLookupEvent(idEvent)
            if (raw?.strResult) {
              const parsed = parseBasketballQuarters(raw.strResult)
              if (parsed && parsed.homeQuarters.length >= 2 && parsed.awayQuarters.length >= 2) {
                const md = eventRow.metadata || {}
                const matchDetails = {
                  ...(md.match_details || {}),
                  half1_home: parsed.homeQuarters[0] + parsed.homeQuarters[1],
                  half1_away: parsed.awayQuarters[0] + parsed.awayQuarters[1],
                }
                await supabase.from("events").update({ metadata: { ...md, match_details: matchDetails } }).eq("id", eventRow.id)
                eventRow.metadata = { ...md, match_details: matchDetails }
              }
            }
          } catch (_) { /* will skip if metadata still missing */ }
        }
        resolution = resolveFirstHalfWinner(creatorSelection, eventRow, betForResolver)
      }

      if (!resolution) {
        skipped += 1
        results.push({
          bet_id: (bet as any).id,
          bet_type: betType,
          status: "skipped",
          reason: `No se pudo determinar ganador para "${creatorSelection}"`,
        })
        continue
      }

      const { winnerId, reason } = resolution
      const totalPrize = calculateTotalPrize((bet as any).amount || 0, (bet as any).multiplier || 1)

      // "house" is a sentinel used by resolvers to signal the house won.
      // winner_id in DB is a UUID FK — store null when house wins.
      const dbWinnerId = winnerId === "house" ? null : winnerId

      if (dryRun) {
        resolved += 1
        results.push({
          bet_id: (bet as any).id,
          bet_type: betType,
          status: "would_resolve",
          winner_id: dbWinnerId,
          reason,
          total_prize: totalPrize,
        })
        continue
      }

      const { data: updatedBet, error: updateError } = await supabase
        .from("bets")
        .update({ status: "resolved", winner_id: dbWinnerId, resolved_at: new Date().toISOString() })
        .eq("id", (bet as any).id)
        .in("status", ["taken", "disputed", "pending_resolution", "pending_resolution_creator", "pending_resolution_acceptor"])
        .is("resolved_at", null)
        .select("id")
        .single()

      if (updateError || !updatedBet) {
        failed += 1
        results.push({ bet_id: (bet as any).id, status: "failed", reason: updateError?.message || "No se pudo actualizar" })
        continue
      }

      if (isHouseBet) {
        const potentialPayout = Number((bet as any).potential_payout || 0)
        const stake = Number((bet as any).amount || 0)
        const betMode = (bet as any).mode ?? "fantasy"
        const userWon = winnerId !== "house"
        const isSimulation = Boolean((bet as any).is_simulation)

        if (!isSimulation) {
          if (userWon) {
            try {
              await payoutToMode(supabase, winnerId, potentialPayout, betMode)
            } catch (payoutErr) {
              failed += 1
              console.error("HOUSE_BET_PAYOUT_FAILED", { userId: winnerId, amount: potentialPayout, betId: (bet as any).id, error: payoutErr })
              const { error: revertErr } = await supabase.from("bets").update({ status: (bet as any).status, resolved_at: null, winner_id: null }).eq("id", (bet as any).id).eq("status", "resolved")
              if (revertErr) console.error("PAYOUT_REVERT_FAILED", { betId: (bet as any).id, error: revertErr })
              results.push({ bet_id: (bet as any).id, status: "failed", reason: "User payout failed" })
              continue
            }
            await supabase.from("transactions").insert({
              user_id: winnerId,
              token_type: tokenTypeForMode(betMode),
              amount: potentialPayout,
              operation: `house_bet_won_${betType}`,
              reference_id: (bet as any).id,
            })
          } else {
            try {
              await houseWalletCredit(supabase, potentialPayout, betMode)
            } catch (creditErr) {
              console.error("HOUSE_WALLET_CREDIT_FAILED", { amount: potentialPayout, betId: (bet as any).id, error: creditErr })
            }
            await supabase.from("transactions").insert({
              user_id: (bet as any).creator_id,
              token_type: tokenTypeForMode(betMode),
              amount: -stake,
              operation: `house_bet_lost_${betType}`,
              reference_id: (bet as any).id,
            })
          }
        }

        await supabase.from("arbitration_decisions").insert({
          bet_id: (bet as any).id,
          action: `auto_resolve_finished_${betType}`,
          previous_status: (bet as any).status,
          new_status: "resolved",
          decided_winner_id: userWon ? winnerId : null,
          reason,
          details: {
            bet_type: betType,
            house_bet: true,
            creator_selection: (bet as any).creator_selection,
            final_score: `${eventRow.home_score}-${eventRow.away_score}`,
            event_id: (bet as any).event_id,
            house_odds: (bet as any).house_odds,
            potential_payout: potentialPayout,
            user_won: userWon,
          },
          decided_by: decidedBy,
          source: "system",
        })

        if (!isSimulation) {
          const matchInfo = `${eventRow.home_team} vs ${eventRow.away_team}` +
            (eventRow.home_score !== null && eventRow.away_score !== null ? ` (${eventRow.home_score}-${eventRow.away_score})` : "")
          await createNotifications([{
            userId: (bet as any).creator_id,
            type: userWon ? "bet_resolved_win" : "bet_resolved_loss",
            title: userWon
              ? `¡Ganaste ${potentialPayout.toFixed(0)} ${betMode === "real" ? "iBYC" : "Fantasy Tokens"}!`
              : "Perdiste tu apuesta contra la casa",
            body: matchInfo,
            betId: (bet as any).id,
          }], supabase)
        }

        resolved += 1
        results.push({
          bet_id: (bet as any).id,
          bet_type: betType,
          house_bet: true,
          is_simulation: isSimulation,
          status: "resolved",
          winner_id: winnerId,
          user_won: userWon,
          reason,
          potential_payout: potentialPayout,
        })
        continue
      }

      // ── Standard P2P bet resolution (existing code below, unchanged) ──────────
      const betMode = (bet as any).mode ?? "fantasy"
      const betGroupId = (bet as any).group_id ?? null
      try {
        if (betGroupId) {
          const { creditGroupWallet } = await import("@/lib/group-wallet-utils")
          await creditGroupWallet(supabase, betGroupId, winnerId, totalPrize)
        } else {
          await payoutToMode(supabase, winnerId, totalPrize, betMode)
        }
      } catch (payoutErr) {
        failed += 1
        console.error("PAYOUT_FAILED", { userId: winnerId, amount: totalPrize, betId: (bet as any).id, betMode, error: payoutErr })
        const { error: revertErr } = await supabase.from("bets").update({ status: (bet as any).status, resolved_at: null, winner_id: null }).eq("id", (bet as any).id).eq("status", "resolved")
        if (revertErr) console.error("PAYOUT_REVERT_FAILED", { betId: (bet as any).id, error: revertErr })
        results.push({ bet_id: (bet as any).id, status: "failed", reason: "Payout failed after 3 retries" })
        continue
      }
      await supabase.from("transactions").insert({
        user_id: winnerId,
        token_type: betGroupId ? "group_fantasy" : tokenTypeForMode(betMode),
        amount: totalPrize,
        operation: `bet_won_auto_resolved_${betType}`,
        reference_id: (bet as any).id,
      })

      await supabase.from("arbitration_decisions").insert({
        bet_id: (bet as any).id,
        action: `auto_resolve_finished_${betType}`,
        previous_status: (bet as any).status,
        new_status: "resolved",
        decided_winner_id: winnerId,
        reason,
        details: {
          bet_type: betType,
          creator_selection: creatorSelection,
          final_score: `${eventRow.home_score}-${eventRow.away_score}`,
          event_id: (bet as any).event_id,
        },
        decided_by: decidedBy,
        source: "system",
      })

      // Notify winner and loser
      const loserId = winnerId === (bet as any).creator_id ? (bet as any).acceptor_id : (bet as any).creator_id
      const matchInfo = `${eventRow.home_team} vs ${eventRow.away_team}` + (eventRow.home_score !== null && eventRow.away_score !== null ? ` (${eventRow.home_score}-${eventRow.away_score})` : '')
      await createNotifications([
        { userId: winnerId, type: "bet_resolved_win", title: `¡Ganaste ${totalPrize.toFixed(2)} ${betMode === "real" ? "iBYC" : "Fantasy Tokens"}!`, body: matchInfo, betId: (bet as any).id, mode: betMode },
        { userId: loserId, type: "bet_resolved_loss", title: "Perdiste esta apuesta", body: matchInfo, betId: (bet as any).id, mode: betMode },
      ], supabase)

      await updateWageringProgress((bet as any).creator_id, (bet as any).amount, supabase, (bet as any).mode ?? "fantasy")
      if ((bet as any).acceptor_id) {
        await updateWageringProgress((bet as any).acceptor_id, (bet as any).amount, supabase, (bet as any).mode ?? "fantasy")
      }

      resolved += 1
      results.push({
        bet_id: (bet as any).id,
        bet_type: betType,
        status: "resolved",
        winner_id: winnerId,
        reason,
        total_prize: totalPrize,
      })
    }

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      bet_types: betTypes,
      cancelled_open: cancelledOpen.length,
      scanned,
      eligible,
      resolved,
      live_settled: liveSettled,
      skipped,
      failed,
      results,
    })
  } catch (error: any) {
    console.error("Auto-resolve finished error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
