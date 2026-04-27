import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createNotifications } from "@/lib/notifications"

async function logDecision(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  payload: {
    bet_id: string
    action: string
    previous_status?: string | null
    new_status?: string | null
    decided_winner_id?: string | null
    reason?: string | null
    details?: Record<string, unknown>
    decided_by?: string | null
  }
) {
  try {
    await supabase.from("arbitration_decisions").insert({
      bet_id: payload.bet_id,
      action: payload.action,
      previous_status: payload.previous_status,
      new_status: payload.new_status,
      decided_winner_id: payload.decided_winner_id,
      reason: payload.reason,
      details: payload.details,
      decided_by: payload.decided_by || 'system',
      source: 'system',
    })
  } catch (error) {
    console.error('Failed to log decision:', error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()

  try {
    const body = await request.json().catch(() => ({}))
    const betId = body?.bet_id
    const dryRun = Boolean(body?.dry_run)

    let query = supabase
      .from("bets")
      .select(`
        id,
        event_id,
        creator_id,
        acceptor_id,
        bet_type,
        creator_selection,
        amount,
        multiplier,
        status,
        event:events(id, home_team, away_team, home_score, away_score, sport)
      `)
      .eq("bet_type", "direct")
      .in("status", ["disputed"])

    if (betId) {
      query = query.eq("id", betId)
    } else {
      query = query.limit(100)
    }

    const { data: bets, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const results: Array<Record<string, unknown>> = []
    let resolved = 0
    let skipped = 0
    let failed = 0

    for (const bet of bets || []) {
      const eventRow = Array.isArray((bet as any).event)
        ? (bet as any).event[0]
        : (bet as any).event

      if (!eventRow) {
        skipped += 1
        results.push({ bet_id: bet.id, status: "skipped", reason: "No event data" })
        continue
      }

      const { home_score, away_score, home_team, away_team } = eventRow
      const hasFinalScore = home_score !== null && away_score !== null

      if (!hasFinalScore) {
        skipped += 1
        results.push({ bet_id: bet.id, status: "skipped", reason: "No final score" })
        continue
      }

      const creatorSel = (bet.creator_selection || "").toLowerCase().trim()
      const homeNormalized = (home_team || "").toLowerCase().trim()
      const awayNormalized = (away_team || "").toLowerCase().trim()

      let creatorChoseHome = creatorSel === homeNormalized
      let creatorChoseAway = creatorSel === awayNormalized
      const creatorChoseDraw = ['empate', 'draw', 'tie'].includes(creatorSel)

      if (!creatorChoseHome && !creatorChoseAway && !creatorChoseDraw) {
        const homeWords = homeNormalized.split(/[\s\-_\.]/).filter((w: string) => w.length > 1)
        const awayWords = awayNormalized.split(/[\s\-_\.]/).filter((w: string) => w.length > 1)
        const creatorWords = creatorSel.split(/[\s\-_\.]/).filter((w: string) => w.length > 1)

        for (const word of creatorWords) {
          if (!word || word.length < 2) continue
          if (homeNormalized.includes(word)) { creatorChoseHome = true; break }
          if (awayNormalized.includes(word)) { creatorChoseAway = true; break }
        }

        if (!creatorChoseHome && !creatorChoseAway) {
          for (const word of homeWords) {
            if (creatorSel.includes(word)) { creatorChoseHome = true; break }
          }
          for (const word of awayWords) {
            if (creatorSel.includes(word)) { creatorChoseAway = true; break }
          }
        }
      }

      if (!creatorChoseHome && !creatorChoseAway && !creatorChoseDraw) {
        skipped += 1
        results.push({
          bet_id: bet.id,
          status: "skipped",
          reason: `creator_selection "${bet.creator_selection}" no coincide con equipos "${home_team}" vs "${away_team}" - fuzzy match failed`,
        })
        continue
      }

      const homeWon = home_score > away_score
      const awayWon = away_score > home_score
      const isTie = home_score === away_score

      let winnerId: string | null = null

      if (creatorChoseDraw) {
        // Creator predicted draw: wins if tied, loses otherwise
        winnerId = isTie ? bet.creator_id : bet.acceptor_id
      } else if (creatorChoseHome) {
        // Creator predicted home win: acceptor wins on draw or away win
        winnerId = homeWon ? bet.creator_id : bet.acceptor_id
      } else if (creatorChoseAway) {
        // Creator predicted away win: acceptor wins on draw or home win
        winnerId = awayWon ? bet.creator_id : bet.acceptor_id
      }

      if (!winnerId) {
        skipped += 1
        results.push({ bet_id: bet.id, status: "skipped", reason: "No se pudo determinar ganador" })
        continue
      }

      if (dryRun) {
        resolved += 1
        results.push({
          bet_id: bet.id,
          status: "would_resolve",
          winner_id: winnerId,
          final_score: `${home_score}-${away_score}`,
          creator_selection: bet.creator_selection,
          is_draw: isTie,
        })
        continue
      }

      const totalPrize = Number(bet.amount) * Number(bet.multiplier || 1) + Number(bet.amount)

      // Update bet first — if this fails, no money moves
      const { error: betUpdateError } = await supabase
        .from("bets")
        .update({ status: "resolved", winner_id: winnerId, resolved_at: new Date().toISOString() })
        .eq("id", bet.id)

      if (betUpdateError) {
        failed += 1
        results.push({ bet_id: bet.id, status: "failed", reason: betUpdateError.message })
        continue
      }

      // Bet confirmed — now pay winner
      const { data: winnerWallet } = await supabase
        .from("wallets")
        .select("balance_fantasy")
        .eq("user_id", winnerId)
        .single()

      if (winnerWallet) {
        const { error: walletPayError } = await supabase
          .from("wallets")
          .update({ balance_fantasy: Number(winnerWallet.balance_fantasy) + totalPrize })
          .eq("user_id", winnerId)

        if (walletPayError) {
          console.error("Wallet payout error (bet already resolved):", walletPayError, { betId: bet.id, winnerId, totalPrize })
        }

        await supabase.from("transactions").insert({
          user_id: winnerId,
          token_type: "fantasy",
          amount: totalPrize,
          operation: "bet_won_auto_resolved_disputed",
          reference_id: bet.id,
        })
      }

      await logDecision(supabase, {
        bet_id: bet.id,
        action: "auto_resolve_disputed_direct",
        previous_status: bet.status,
        new_status: "resolved",
        decided_winner_id: winnerId,
        reason: `Resolución automática basada en marcador final ${home_score}-${away_score}`,
        details: {
          final_score: `${home_score}-${away_score}`,
          creator_selection: bet.creator_selection,
          creator_chose_home: creatorChoseHome,
          creator_chose_away: creatorChoseAway,
          creator_chose_draw: creatorChoseDraw,
        },
        decided_by: auth.userId || "system",
      })

      const loserId = winnerId === bet.creator_id ? bet.acceptor_id : bet.creator_id
      await createNotifications([
        { userId: winnerId, type: "bet_resolved_win", title: "¡Ganaste la apuesta!", body: `Tu apuesta fue resuelta automáticamente. Ganaste ${totalPrize.toFixed(2)} Fantasy Tokens.`, betId: bet.id },
        { userId: loserId, type: "bet_resolved_loss", title: "Apuesta resuelta", body: "Tu apuesta fue resuelta. ¡Suerte la próxima!", betId: bet.id },
      ], supabase)

      resolved += 1
      results.push({
        bet_id: bet.id,
        status: "resolved",
        winner_id: winnerId,
        final_score: `${home_score}-${away_score}`,
      })
    }

    return NextResponse.json({
      success: true,
      resolved,
      skipped,
      failed,
      results,
      debug_info: {
        timestamp: new Date().toISOString(),
        bet_types_processed: "direct",
        statuses_filtered: ["disputed"],
      },
    })
  } catch (error: any) {
    console.error("Auto-resolve disputed bets error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}