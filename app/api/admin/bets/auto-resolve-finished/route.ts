import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createNotifications } from "@/lib/notifications"
import { calculateTotalPrize } from "@/lib/bet-resolution"

const FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
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
  const homeNorm = (event.home_team || "").toLowerCase().trim()
  const awayNorm = (event.away_team || "").toLowerCase().trim()

  const choseDraw = ["empate", "draw", "tie"].includes(sel)
  const { choseHome, choseAway } = choseDraw ? { choseHome: false, choseAway: false } : fuzzyMatchTeam(sel, homeNorm, awayNorm)

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

// ─── Main handler ─────────────────────────────────────────────────────────────

const RESOLVABLE_TYPES = ["direct", "exact_score", "half_time", "first_scorer"]

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
    const body = await request.json().catch(() => ({}))
    const eventId = Number(body?.event_id)
    const hasEventFilter = Number.isFinite(eventId) && eventId > 0
    const dryRun = Boolean(body?.dry_run)
    const betTypes: string[] = Array.isArray(body?.bet_types)
      ? body.bet_types.filter((t: string) => RESOLVABLE_TYPES.includes(t))
      : RESOLVABLE_TYPES

    let query = supabase
      .from("bets")
      .select(`
        id, event_id, creator_id, acceptor_id, amount, multiplier,
        status, bet_type, creator_selection, selection,
        event:events(id, external_id, status, home_score, away_score, home_team, away_team, metadata)
      `)
      .in("bet_type", betTypes)
      .in("status", ["taken", "disputed"])
      .limit(2000)

    if (hasEventFilter) query = query.eq("event_id", eventId)

    const { data: bets, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const results: Array<Record<string, unknown>> = []
    let scanned = 0, eligible = 0, resolved = 0, skipped = 0, failed = 0

    for (const bet of bets || []) {
      scanned += 1
      const eventRow = (Array.isArray((bet as any).event) ? (bet as any).event[0] : (bet as any).event) as any

      if (!eventRow) { skipped += 1; continue }

      const isFinished = (eventRow.status || "").toLowerCase() === "finished"
      if (!isFinished || eventRow.home_score === null || eventRow.away_score === null) {
        skipped += 1; continue
      }

      eligible += 1
      const creatorSelection = extractCreatorSelection({
        creator_selection: (bet as any).creator_selection,
        selection: (bet as any).selection,
      })

      const betType: string = (bet as any).bet_type
      const betForResolver = {
        creator_id: (bet as any).creator_id as string,
        acceptor_id: (bet as any).acceptor_id as string,
      }

      let resolution: { winnerId: string; reason: string } | null = null

      if (betType === "direct") {
        resolution = resolveDirect(creatorSelection, eventRow, betForResolver)
      } else if (betType === "exact_score") {
        resolution = resolveExactScore(creatorSelection, eventRow, betForResolver)
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

      if (dryRun) {
        resolved += 1
        results.push({
          bet_id: (bet as any).id,
          bet_type: betType,
          status: "would_resolve",
          winner_id: winnerId,
          reason,
          total_prize: totalPrize,
        })
        continue
      }

      const { data: updatedBet, error: updateError } = await supabase
        .from("bets")
        .update({ status: "resolved", winner_id: winnerId, resolved_at: new Date().toISOString() })
        .eq("id", (bet as any).id)
        .in("status", ["taken", "disputed"])
        .is("resolved_at", null)
        .select("id")
        .single()

      if (updateError || !updatedBet) {
        failed += 1
        results.push({ bet_id: (bet as any).id, status: "failed", reason: updateError?.message || "No se pudo actualizar" })
        continue
      }

      const { data: winnerWallet } = await supabase
        .from("wallets")
        .select("balance_fantasy")
        .eq("user_id", winnerId)
        .single()

      if (!winnerWallet) {
        failed += 1
        results.push({ bet_id: (bet as any).id, status: "failed", reason: "Wallet del ganador no encontrada" })
        continue
      }

      const { error: walletPayError } = await supabase
        .from("wallets")
        .update({ balance_fantasy: Number(winnerWallet.balance_fantasy || 0) + totalPrize })
        .eq("user_id", winnerId)

      if (walletPayError) {
        console.error("Wallet payout error (bet already resolved):", walletPayError, { betId: (bet as any).id, winnerId, totalPrize })
      } else {
        await supabase.from("transactions").insert({
          user_id: winnerId,
          token_type: "fantasy",
          amount: totalPrize,
          operation: `bet_won_auto_resolved_${betType}`,
          reference_id: (bet as any).id,
        })
      }

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
      await createNotifications([
        { userId: winnerId, type: "bet_resolved_win", title: "¡Ganaste la apuesta!", body: `Tu apuesta fue resuelta automáticamente. Ganaste $${totalPrize.toFixed(2)} Fantasy Tokens.`, betId: (bet as any).id },
        { userId: loserId, type: "bet_resolved_loss", title: "Apuesta resuelta", body: "Tu apuesta fue resuelta automáticamente. ¡Suerte la próxima!", betId: (bet as any).id },
      ], supabase)

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
      scanned,
      eligible,
      resolved,
      skipped,
      failed,
      results,
    })
  } catch (error: any) {
    console.error("Auto-resolve finished error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
