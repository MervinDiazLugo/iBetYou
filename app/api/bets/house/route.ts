import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { createNotification } from "@/lib/notifications"
import { canCountryUseRealMoney, canCountryUseHouseBetting } from "@/lib/country-access"
import { payoutToMode } from "@/lib/wallet-utils"
import {
  calcDirectOdds,
  calcExactScoreOdds,
  calcScoreMarginOdds,
  calcRunLineOdds,
  calcTotalRunsOdds,
  oddsForOutcome,
  MAX_DIRECT_EXPOSURE,
  MAX_EXACT_EXPOSURE,
  DirectOutcome,
} from "@/lib/house-odds"
import { houseWalletDebit, houseWalletCredit } from "@/lib/house-wallet"

const MAX_STAKE = 100_000

export async function POST(request: NextRequest) {
  try {
    const { userId, eventId, betType, selection, amount: rawAmount, mode: rawMode } = await request.json()

    // Validate and normalize mode
    const betMode: "fantasy" | "real" = rawMode === "real" ? "real" : "fantasy"

    // Validate auth
    const authHeader = request.headers.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const serverSupabase = createServerSupabaseClient()
    const {
      data: { user },
      error: authError,
    } = await serverSupabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (userId !== user.id) {
      return NextResponse.json({ error: "Unauthorized user scope" }, { status: 403 })
    }

    // Validate required fields
    if (!eventId || !betType || !selection || rawAmount === undefined || rawAmount === null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const supabase = createAdminSupabaseClient()

    // Fetch event
    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select("id, sport, status, featured, metadata, updated_at, league")
      .eq("id", eventId)
      .single()

    if (eventError || !eventRow) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 })
    }

    // Validate event is featured
    if (!eventRow.featured) {
      return NextResponse.json(
        { error: "Las apuestas contra la casa solo están disponibles para eventos destacados" },
        { status: 400 }
      )
    }

    // Validate event is not finished/cancelled/postponed
    const blockedStatuses = ["finished", "cancelled", "postponed"]
    if (blockedStatuses.includes(eventRow.status)) {
      return NextResponse.json(
        { error: "Este evento no acepta nuevas apuestas" },
        { status: 400 }
      )
    }

    // Stale prediction gate (direct bets only)
    if (betType === "direct") {
      const updatedAt = new Date(eventRow.updated_at)
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)
      if (updatedAt < fortyEightHoursAgo) {
        return NextResponse.json(
          { error: "Las predicciones de este evento no están actualizadas. Intenta más tarde." },
          { status: 400 }
        )
      }
    }

    // League keyword checks
    const leagueLower = (eventRow.league ?? "").toLowerCase()
    const isMLBLeague =
      leagueLower.includes("mlb") ||
      leagueLower.includes("major league baseball") ||
      leagueLower.includes("american league") ||
      leagueLower.includes("national league")
    const isNBALeague =
      leagueLower.includes("nba") ||
      leagueLower.includes("national basketball association") ||
      leagueLower.includes("nba g league") ||
      leagueLower.includes("nba 2")

    // Allowed bet types per sport
    const sport = eventRow.sport as string
    let allowedBetTypes: string[]
    if (sport === "football") {
      allowedBetTypes = ["direct", "exact_score"]
    } else if (sport === "basketball") {
      allowedBetTypes = isNBALeague ? ["direct", "score_margin"] : ["direct"]
    } else if (sport === "baseball") {
      allowedBetTypes = isMLBLeague
        ? ["direct", "exact_score", "run_line", "total_runs"]
        : ["direct", "exact_score", "total_runs"]
    } else {
      allowedBetTypes = ["direct"]
    }

    if (!allowedBetTypes.includes(betType)) {
      if (betType === "score_margin" && sport === "basketball" && !isNBALeague) {
        return NextResponse.json(
          { error: "El tipo de apuesta 'score_margin' solo está disponible para ligas NBA" },
          { status: 400 }
        )
      }
      if (betType === "run_line" && sport === "baseball" && !isMLBLeague) {
        return NextResponse.json(
          { error: "El tipo de apuesta 'run_line' solo está disponible para ligas MLB" },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: `El tipo de apuesta '${betType}' no está disponible para este evento` },
        { status: 400 }
      )
    }

    // Validate stake
    const stake = Number(rawAmount)
    if (!Number.isFinite(stake) || stake <= 0) {
      return NextResponse.json({ error: "El monto debe ser un número positivo" }, { status: 400 })
    }
    if (stake > MAX_STAKE) {
      return NextResponse.json(
        { error: `El monto máximo por apuesta es ${MAX_STAKE.toLocaleString("es-ES")}` },
        { status: 400 }
      )
    }

    // Fetch profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, is_banned, role, betting_blocked_until, country")
      .eq("id", user.id)
      .single()

    if (profileError) {
      return NextResponse.json({ error: "Failed to validate user profile" }, { status: 500 })
    }

    if (profile?.is_banned) {
      return NextResponse.json({ error: "User is banned from betting" }, { status: 403 })
    }

    if (profile?.role === "backoffice_admin") {
      return NextResponse.json(
        { error: "Los usuarios de backoffice no pueden crear apuestas" },
        { status: 403 }
      )
    }

    if (profile?.betting_blocked_until) {
      const blockedUntil = new Date(profile.betting_blocked_until)
      if (blockedUntil > new Date()) {
        return NextResponse.json(
          {
            error: `No puedes apostar hasta ${blockedUntil.toLocaleString("es-ES")}`,
            blocked_until: profile.betting_blocked_until,
          },
          { status: 403 }
        )
      }
    }

    // Check house betting access for country
    const houseBettingAllowed = await canCountryUseHouseBetting(profile?.country ?? null, betMode)
    if (!houseBettingAllowed) {
      return NextResponse.json(
        { error: "Las apuestas contra la casa no están disponibles en tu país" },
        { status: 403 }
      )
    }

    if (betMode === "real") {
      const realMoneyAllowed = await canCountryUseRealMoney(profile?.country ?? null)
      if (!realMoneyAllowed) {
        return NextResponse.json(
          { error: "El Modo Real no está habilitado en tu país" },
          { status: 403 }
        )
      }
    }

    // Calculate odds
    const metadata = eventRow.metadata as Record<string, any> | null
    let houseOdds: number | null = null

    if (betType === "direct") {
      const percent = metadata?.predictions?.percent
      if (!percent) {
        return NextResponse.json(
          { error: "No hay predicciones disponibles para este evento" },
          { status: 400 }
        )
      }
      const oddsResult = calcDirectOdds(percent)
      if (!oddsResult) {
        return NextResponse.json(
          { error: "No se pudieron calcular las cuotas para este evento" },
          { status: 400 }
        )
      }
      houseOdds = oddsForOutcome(oddsResult, selection as DirectOutcome)
      if (houseOdds === null) {
        return NextResponse.json(
          { error: "Selección inválida para apuesta directa" },
          { status: 400 }
        )
      }
    } else if (betType === "exact_score") {
      if (!/^\d+\s*[-:]\s*\d+$/.test(String(selection))) {
        return NextResponse.json(
          { error: "El formato del marcador exacto debe ser '0-0' o '0:0'" },
          { status: 400 }
        )
      }
      houseOdds = calcExactScoreOdds(sport, String(selection), metadata ?? undefined)
      if (houseOdds === null) {
        return NextResponse.json(
          { error: "No se pueden calcular cuotas de marcador exacto para este deporte" },
          { status: 400 }
        )
      }
    } else if (betType === "score_margin") {
      houseOdds = calcScoreMarginOdds(String(selection))
      if (houseOdds === null) {
        return NextResponse.json(
          { error: "Selección inválida para apuesta de margen" },
          { status: 400 }
        )
      }
    } else if (betType === "run_line") {
      const percent = metadata?.predictions?.percent
      if (!percent) {
        return NextResponse.json({ error: "No hay predicciones disponibles para este evento" }, { status: 400 })
      }
      const homeWinProb = parseFloat(String(percent.home).replace("%", "")) / 100
      houseOdds = calcRunLineOdds(String(selection), homeWinProb)
      if (houseOdds === null) {
        return NextResponse.json(
          { error: "Selección inválida para run line (debe ser 'home_rl' o 'away_rl')" },
          { status: 400 }
        )
      }
    } else if (betType === "total_runs") {
      houseOdds = calcTotalRunsOdds(String(selection))
      if (houseOdds === null) {
        return NextResponse.json(
          { error: "Selección inválida para total de carreras" },
          { status: 400 }
        )
      }
    }

    if (houseOdds === null) {
      return NextResponse.json(
        { error: "No se pudieron calcular las cuotas" },
        { status: 400 }
      )
    }

    const potentialPayout = parseFloat((stake * houseOdds).toFixed(4))
    const houseRisk = parseFloat((potentialPayout - stake).toFixed(4))

    // Exposure check
    const exposureLimit =
      betType === "direct" || betType === "run_line" ? MAX_DIRECT_EXPOSURE : MAX_EXACT_EXPOSURE

    const { data: exposureRows } = await supabase
      .from("bets")
      .select("potential_payout, amount")
      .eq("event_id", eventId)
      .eq("creator_selection", String(selection))
      .eq("house_bet", true)
      .eq("status", "taken")

    const currentExposure = (exposureRows ?? []).reduce((sum, row) => {
      return sum + (Number(row.potential_payout) - Number(row.amount))
    }, 0)

    if (currentExposure + houseRisk > exposureLimit) {
      return NextResponse.json(
        { error: "La casa ha alcanzado el límite de exposición para esta selección" },
        { status: 400 }
      )
    }

    // Check user balance and deduct (optimistic lock)
    let currentBalance: number
    if (betMode === "real") {
      const { data: ibcWallet, error: ibcErr } = await supabase
        .from("iby_wallets")
        .select("balance, balance_blocked")
        .eq("user_id", user.id)
        .single()
      if (ibcErr || !ibcWallet) {
        return NextResponse.json({ error: "iBY wallet not found" }, { status: 404 })
      }
      const available = Number(ibcWallet.balance) - Number(ibcWallet.balance_blocked)
      if (available < stake) {
        return NextResponse.json({ error: "Insufficient iBY balance" }, { status: 400 })
      }
      currentBalance = Number(ibcWallet.balance)
    } else {
      const { data: wallet, error: walletError } = await supabase
        .from("wallets")
        .select("balance_fantasy")
        .eq("user_id", user.id)
        .single()
      if (walletError || !wallet) {
        return NextResponse.json({ error: "Wallet not found" }, { status: 404 })
      }
      if (wallet.balance_fantasy < stake) {
        return NextResponse.json({ error: "Insufficient balance" }, { status: 400 })
      }
      currentBalance = wallet.balance_fantasy
    }

    // Deduct user balance with optimistic lock
    if (betMode === "real") {
      const { data: ibcUpdated, error: walletUpdateError } = await supabase
        .from("iby_wallets")
        .update({ balance: currentBalance - stake })
        .eq("user_id", user.id)
        .eq("balance", currentBalance)
        .select("user_id")
      if (walletUpdateError) {
        return NextResponse.json({ error: "Failed to update iBY wallet" }, { status: 400 })
      }
      if (!ibcUpdated || ibcUpdated.length === 0) {
        return NextResponse.json(
          { error: "Tu saldo cambió. Recarga e intenta de nuevo." },
          { status: 409 }
        )
      }
    } else {
      const { data: fantasyUpdated, error: walletUpdateError } = await supabase
        .from("wallets")
        .update({ balance_fantasy: currentBalance - stake })
        .eq("user_id", user.id)
        .eq("balance_fantasy", currentBalance)
        .select("user_id")
      if (walletUpdateError) {
        return NextResponse.json({ error: "Failed to update wallet" }, { status: 400 })
      }
      if (!fantasyUpdated || fantasyUpdated.length === 0) {
        return NextResponse.json(
          { error: "Tu saldo cambió. Recarga e intenta de nuevo." },
          { status: 409 }
        )
      }
    }

    // Reserve house liability
    try {
      await houseWalletDebit(supabase, houseRisk, betMode)
    } catch (houseDebitErr) {
      // Rollback user deduction
      try {
        await payoutToMode(supabase, user.id, stake, betMode)
      } catch (rollbackErr) {
        console.error("ROLLBACK_FAILED after house debit error", {
          userId: user.id,
          stake,
          betMode,
          error: rollbackErr,
        })
      }
      return NextResponse.json(
        { error: "La casa no tiene fondos disponibles para esta apuesta" },
        { status: 400 }
      )
    }

    // Insert bet
    const { data: bet, error: betError } = await supabase
      .from("bets")
      .insert({
        event_id: eventId,
        creator_id: user.id,
        acceptor_id: null,
        bet_type: betType,
        selection: JSON.stringify({ selection }),
        creator_selection: String(selection),
        acceptor_selection: null,
        amount: stake,
        multiplier: betType === "exact_score" ? houseOdds : 1,
        fee_amount: 0,
        status: "taken",
        mode: betMode,
        house_bet: true,
        house_odds: houseOdds,
        potential_payout: potentialPayout,
      })
      .select()
      .single()

    if (betError) {
      // Rollback user deduction and house debit
      try {
        await payoutToMode(supabase, user.id, stake, betMode)
      } catch (rollbackErr) {
        console.error("ROLLBACK_FAILED after bet insert error (user)", {
          userId: user.id,
          stake,
          betMode,
          error: rollbackErr,
        })
      }
      try {
        await houseWalletCredit(supabase, houseRisk, betMode)
      } catch (houseRollbackErr) {
        console.error("ROLLBACK_FAILED after bet insert error (house)", {
          houseRisk,
          betMode,
          error: houseRollbackErr,
        })
      }
      return NextResponse.json(
        { error: `Failed to create bet: ${betError.message}` },
        { status: 400 }
      )
    }

    // Record transaction
    const { error: transactionError } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        token_type: betMode === "real" ? "iBY" : "fantasy",
        amount: -stake,
        operation: "house_bet_created",
        reference_id: bet.id,
      })

    if (transactionError) {
      console.error("Transaction recording error:", transactionError)
    }

    // Notify user
    await createNotification(
      {
        userId: user.id,
        type: "bet_taken",
        title: "Apuesta vs. Casa creada",
        body: `Tu apuesta de ${stake} contra la casa fue creada. Ganancia potencial: ${potentialPayout}.`,
        betId: bet.id,
      },
      supabase
    )

    return NextResponse.json({
      success: true,
      bet: {
        id: bet.id,
        status: bet.status,
        house_odds: houseOdds,
        potential_payout: potentialPayout,
      },
    })
  } catch (error) {
    console.error("House bet creation error:", error)
    return NextResponse.json({ error: "Failed to create house bet" }, { status: 500 })
  }
}
