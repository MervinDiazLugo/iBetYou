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
  calcGoalsOverUnderOdds,
  calcBothTeamsScoreOdds,
  oddsForOutcome,
  MAX_DIRECT_EXPOSURE,
  MAX_EXACT_EXPOSURE,
  MAX_DIRECT_BET_PROBABILITY,
  DirectOutcome,
} from "@/lib/house-odds"
import { houseWalletDebit, houseWalletCredit } from "@/lib/house-wallet"

const MAX_STAKE = 100_000

export async function POST(request: NextRequest) {
  try {
    // Validate JWT before touching body — user.id from token is source of truth
    const authHeader = request.headers.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const token = authHeader.slice(7)
    const serverSupabase = createServerSupabaseClient()
    const { data: { user }, error: authError } = await serverSupabase.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Parse body after JWT is validated
    const { userId, eventId, betType, selection, amount: rawAmount, mode: rawMode } = await request.json()
    if (userId && userId !== user.id) {
      return NextResponse.json({ error: "Unauthorized user scope" }, { status: 403 })
    }

    const betMode: "fantasy" | "real" = rawMode === "real" ? "real" : "fantasy"

    // Validate required fields
    if (!eventId || !betType || !selection || rawAmount === undefined || rawAmount === null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const supabase = createAdminSupabaseClient()

    // Fetch event
    const numericEventId = Number(eventId)
    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select("id, sport, status, featured, is_demo, metadata, league")
      .eq("id", numericEventId)
      .maybeSingle()

    if (eventError || !eventRow) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 })
    }

    // Validate event is featured or demo
    if (!eventRow.featured && !(eventRow as any).is_demo) {
      return NextResponse.json(
        { error: "Las apuestas contra la casa solo están disponibles para eventos destacados" },
        { status: 400 }
      )
    }

    // Demo events self-heal: if finished/cancelled, reset to scheduled so bets can continue.
    // demo-refresh cron generates synthetic results and re-activates regardless of current status.
    if ((eventRow as any).is_demo && ["finished", "cancelled", "postponed"].includes(eventRow.status)) {
      const newStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      await supabase.from("events").update({
        status: "scheduled",
        start_time: newStart,
        home_score: null,
        away_score: null,
      }).eq("id", numericEventId)
      eventRow.status = "scheduled"
    }

    // Validate event is not finished/cancelled/postponed
    const blockedStatuses = ["finished", "cancelled", "postponed"]
    if (blockedStatuses.includes(eventRow.status)) {
      return NextResponse.json(
        { error: "Este evento no acepta nuevas apuestas" },
        { status: 400 }
      )
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
      allowedBetTypes = ["direct", "exact_score", "cards_over_under", "goals_over_under", "both_teams_score"]
    } else if (sport === "basketball") {
      allowedBetTypes = ["direct", "score_margin"]
    } else if (sport === "baseball") {
      allowedBetTypes = isMLBLeague
        ? ["direct", "exact_score", "run_line", "total_runs"]
        : ["direct", "exact_score", "total_runs"]
    } else {
      allowedBetTypes = ["direct"]
    }

    if (!allowedBetTypes.includes(betType)) {
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
    const { data: maxHouseSetting } = await supabase.from("iby_settings").select("value").eq("key", "max_bet_amount_house").maybeSingle()
    const maxHouseStake = maxHouseSetting?.value ? Number(maxHouseSetting.value) : MAX_STAKE
    if (Number.isFinite(maxHouseStake) && maxHouseStake > 0 && stake > maxHouseStake) {
      return NextResponse.json(
        { error: `El monto máximo por apuesta contra la casa es ${maxHouseStake.toLocaleString("es-ES")}` },
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
      const homeProb = parseFloat(String(percent.home).replace("%", "")) / 100
      const awayProb = parseFloat(String(percent.away).replace("%", "")) / 100
      if (Math.max(homeProb, awayProb) > MAX_DIRECT_BET_PROBABILITY) {
        return NextResponse.json(
          { error: "Las apuestas directas no están disponibles para este evento: la diferencia de probabilidades es demasiado alta" },
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
    } else if (betType === "goals_over_under") {
      houseOdds = calcGoalsOverUnderOdds(String(selection))
      if (houseOdds === null) {
        return NextResponse.json(
          { error: "Selección inválida para goles over/under" },
          { status: 400 }
        )
      }
    } else if (betType === "both_teams_score") {
      houseOdds = calcBothTeamsScoreOdds(String(selection))
      if (houseOdds === null) {
        return NextResponse.json(
          { error: "Selección inválida para ambos equipos anotan (debe ser 'yes' o 'no')" },
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
    let currentBalanceBlocked: number = 0
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
        await supabase.from("profiles").update({ is_banned: true }).eq("id", user.id)
        return NextResponse.json({ error: "Saldo insuficiente. Tu cuenta fue suspendida.", banned: true }, { status: 403 })
      }
      currentBalance = Number(ibcWallet.balance)
      currentBalanceBlocked = Number(ibcWallet.balance_blocked)
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
        await supabase.from("profiles").update({ is_banned: true }).eq("id", user.id)
        return NextResponse.json({ error: "Saldo insuficiente. Tu cuenta fue suspendida.", banned: true }, { status: 403 })
      }
      currentBalance = wallet.balance_fantasy
    }

    // 1. Insert bet FIRST (payment ordering invariant: status before money)
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
      return NextResponse.json({ error: `Failed to create bet: ${betError.message}` }, { status: 400 })
    }

    // 2. Deduct user balance with optimistic lock
    if (betMode === "real") {
      const { data: ibcUpdated, error: walletUpdateError } = await supabase
        .from("iby_wallets")
        .update({ balance: currentBalance - stake })
        .eq("user_id", user.id)
        .eq("balance", currentBalance)
        .eq("balance_blocked", currentBalanceBlocked)
        .select("user_id")
      if (walletUpdateError || !ibcUpdated || ibcUpdated.length === 0) {
        await supabase.from("bets").update({ status: "cancelled" }).eq("id", bet.id)
        const msg = (!ibcUpdated || ibcUpdated.length === 0)
          ? "Tu saldo cambió. Recarga e intenta de nuevo."
          : "Failed to update iBY wallet"
        return NextResponse.json({ error: msg }, { status: 409 })
      }
    } else {
      const { data: fantasyUpdated, error: walletUpdateError } = await supabase
        .from("wallets")
        .update({ balance_fantasy: currentBalance - stake })
        .eq("user_id", user.id)
        .eq("balance_fantasy", currentBalance)
        .select("user_id")
      if (walletUpdateError || !fantasyUpdated || fantasyUpdated.length === 0) {
        await supabase.from("bets").update({ status: "cancelled" }).eq("id", bet.id)
        const msg = (!fantasyUpdated || fantasyUpdated.length === 0)
          ? "Tu saldo cambió. Recarga e intenta de nuevo."
          : "Failed to update wallet"
        return NextResponse.json({ error: msg }, { status: 409 })
      }
    }

    // 3. Reserve house liability
    try {
      await houseWalletDebit(supabase, houseRisk, betMode)
    } catch (houseDebitErr) {
      await payoutToMode(supabase, user.id, stake, betMode)
      await supabase.from("bets").update({ status: "cancelled" }).eq("id", bet.id)
      return NextResponse.json(
        { error: "La casa no tiene fondos disponibles para esta apuesta" },
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
