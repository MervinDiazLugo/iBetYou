import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

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

function parseExactScore(value: string | null | undefined) {
  const normalized = (value || "").trim()
  const match = normalized.match(/^(\d+)\s*[-:]\s*(\d+)$/)
  if (!match) return null
  return {
    home: Number(match[1]),
    away: Number(match[2]),
  }
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
    } catch {
      // Keep fallback value when selection payload is invalid JSON.
    }
  }

  return selection
}

type EventRow = {
  id: number
  status: string | null
  home_score: number | null
  away_score: number | null
  home_team: string | null
  away_team: string | null
}

export async function POST(request: NextRequest) {
  const authorizedBySecret = hasValidResolveSecret(request)
  let decidedBy = "system"

  if (!authorizedBySecret) {
    const auth = await requireBackofficeAdmin(request)
    if (!auth.authorized) {
      return auth.response
    }
    decidedBy = auth.userId || "system"
  }

  const supabase = createAdminSupabaseClient()

  try {
    const body = await request.json().catch(() => ({}))
    const eventId = Number(body?.event_id)
    const hasEventFilter = Number.isFinite(eventId) && eventId > 0
    const dryRun = Boolean(body?.dry_run)

    let query = supabase
      .from("bets")
      .select("id, event_id, creator_id, acceptor_id, amount, multiplier, status, type, bet_type, creator_selection, selection, event:events(id, status, home_score, away_score, home_team, away_team)")
      .eq("bet_type", "exact_score")
      .in("status", ["taken", "disputed"])
      .limit(2000)

    if (hasEventFilter) {
      query = query.eq("event_id", eventId)
    }

    const { data: bets, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const results: Array<Record<string, unknown>> = []
    let scanned = 0
    let eligible = 0
    let resolved = 0
    let skipped = 0
    let failed = 0

    for (const bet of bets || []) {
      scanned += 1
      const eventRow = (Array.isArray((bet as any).event)
        ? (bet as any).event[0]
        : (bet as any).event) as EventRow | null

      if (!eventRow) {
        skipped += 1
        continue
      }

      const isFinished = (eventRow.status || "").toLowerCase() === "finished"
      if (!isFinished || eventRow.home_score === null || eventRow.away_score === null) {
        skipped += 1
        continue
      }

      eligible += 1
      const creatorSelection = extractCreatorSelection({
        creator_selection: (bet as any).creator_selection,
        selection: (bet as any).selection,
      })
      const parsedSelection = parseExactScore(creatorSelection)

      if (!parsedSelection) {
        skipped += 1
        results.push({
          bet_id: (bet as any).id,
          event_id: (bet as any).event_id,
          status: "skipped",
          reason: `creator_selection invalida: ${creatorSelection || "(vacía)"}`,
        })
        continue
      }

      const creatorMatch = eventRow.home_score === parsedSelection.home && eventRow.away_score === parsedSelection.away
      const winnerId = creatorMatch ? (bet as any).creator_id : (bet as any).acceptor_id

      if (!winnerId) {
        failed += 1
        results.push({
          bet_id: (bet as any).id,
          event_id: (bet as any).event_id,
          status: "failed",
          reason: "No se pudo determinar winner_id",
        })
        continue
      }

      const totalPrize = Number((bet as any).amount || 0) * Number((bet as any).multiplier || 0) + Number((bet as any).amount || 0)

      if (dryRun) {
        resolved += 1
        results.push({
          bet_id: (bet as any).id,
          event_id: (bet as any).event_id,
          status: "would_resolve",
          winner_id: winnerId,
          creator_selection: creatorSelection,
          final_score: `${eventRow.home_score}-${eventRow.away_score}`,
          total_prize: totalPrize,
        })
        continue
      }

      const { data: updatedBet, error: updateError } = await supabase
        .from("bets")
        .update({
          status: "resolved",
          winner_id: winnerId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", (bet as any).id)
        .in("status", ["taken", "disputed"])
        .is("resolved_at", null)
        .select("id")
        .single()

      if (updateError || !updatedBet) {
        failed += 1
        results.push({
          bet_id: (bet as any).id,
          event_id: (bet as any).event_id,
          status: "failed",
          reason: updateError?.message || "No se pudo actualizar apuesta",
        })
        continue
      }

      const { data: winnerWallet } = await supabase
        .from("wallets")
        .select("balance_fantasy")
        .eq("user_id", winnerId)
        .single()

      if (!winnerWallet) {
        failed += 1
        results.push({
          bet_id: (bet as any).id,
          event_id: (bet as any).event_id,
          status: "failed",
          reason: "Wallet del ganador no encontrada",
        })
        continue
      }

      await supabase
        .from("wallets")
        .update({ balance_fantasy: Number(winnerWallet.balance_fantasy || 0) + totalPrize })
        .eq("user_id", winnerId)

      await supabase.from("transactions").insert({
        user_id: winnerId,
        token_type: "fantasy",
        amount: totalPrize,
        operation: "bet_won_auto_resolved_bulk_exact_score",
        reference_id: (bet as any).id,
      })

      await supabase.from("arbitration_decisions").insert({
        bet_id: (bet as any).id,
        action: "auto_resolve_finished_exact_score",
        previous_status: (bet as any).status,
        new_status: "resolved",
        decided_winner_id: winnerId,
        reason: `Resolucion automatica exact_score al finalizar evento (${eventRow.home_score}-${eventRow.away_score})`,
        details: {
          creator_selection: creatorSelection,
          final_score: `${eventRow.home_score}-${eventRow.away_score}`,
          event_id: (bet as any).event_id,
          event_home_team: eventRow.home_team,
          event_away_team: eventRow.away_team,
          mode: "bulk_exact_score_finished",
        },
        decided_by: decidedBy,
        source: "system",
      })

      resolved += 1
      results.push({
        bet_id: (bet as any).id,
        event_id: (bet as any).event_id,
        status: "resolved",
        winner_id: winnerId,
        creator_selection: creatorSelection,
        final_score: `${eventRow.home_score}-${eventRow.away_score}`,
        total_prize: totalPrize,
      })
    }

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      scanned,
      eligible,
      resolved,
      skipped,
      failed,
      results,
    })
  } catch (error: any) {
    console.error("Bulk auto-resolve exact_score error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}