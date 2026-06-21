import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { createNotification } from "@/lib/notifications"
import { canCountryUseRealMoney } from "@/lib/country-access"
import { payoutToMode } from "@/lib/wallet-utils"
import { PRE_MATCH_ONLY_BET_TYPES } from "@/lib/bet-constants"

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

    // Parse body after JWT is validated — user.id from JWT is authoritative, userId from body is ignored
    const { eventId, betType, selection, amount: rawAmount, multiplier, mode: rawMode, group_id } = await request.json()

    if (rawMode !== "real" && rawMode !== "fantasy" && rawMode !== undefined && rawMode !== null) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
    }
    const isGroupBet = typeof group_id === "string" && group_id.length > 0
    const betMode = isGroupBet ? "fantasy" : (rawMode === "real" ? "real" : "fantasy")
    const footballOnlyBetTypes = new Set(["half_time", "first_scorer"])

    if (!eventId || !betType || !selection || rawAmount === undefined || rawAmount === null) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const amount = Number(rawAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "El monto debe ser un número positivo" }, { status: 400 })
    }

    if (betType === "exact_score" && multiplier !== undefined) {
      const parsedMultiplier = Number(multiplier)
      if (!Number.isFinite(parsedMultiplier) || parsedMultiplier < 1 || parsedMultiplier > 100) {
        return NextResponse.json({ error: "El multiplicador debe estar entre 1 y 100" }, { status: 400 })
      }
    }

    const supabase = createAdminSupabaseClient()

    // Check max_bet_amount setting
    const { data: maxBetSetting } = await supabase
      .from("iby_settings")
      .select("value")
      .eq("key", "max_bet_amount")
      .maybeSingle()
    if (maxBetSetting?.value) {
      const maxBet = Number(maxBetSetting.value)
      if (Number.isFinite(maxBet) && maxBet > 0 && amount > maxBet) {
        return NextResponse.json({ error: `El monto máximo por apuesta es ${maxBet.toLocaleString("es-ES")}` }, { status: 400 })
      }
    }

    const [
      { data: eventRow, error: eventError },
      { data: profile, error: profileError },
    ] = await Promise.all([
      supabase.from("events").select("id, sport, status, start_time").eq("id", eventId).single(),
      supabase.from("profiles").select("id, is_banned, role, betting_blocked_until, country, real_betting_enabled").eq("id", user.id).single(),
    ])

    if (eventError || !eventRow) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      )
    }

    if (eventRow.status === "postponed") {
      return NextResponse.json({ error: "Este evento fue pospuesto y no acepta nuevas apuestas" }, { status: 400 })
    }

    if (footballOnlyBetTypes.has(betType) && eventRow.sport !== "football") {
      return NextResponse.json(
        { error: "Este tipo de apuesta solo esta disponible para futbol" },
        { status: 400 }
      )
    }

    if (PRE_MATCH_ONLY_BET_TYPES.has(betType) && eventRow.start_time) {
      if (new Date(eventRow.start_time) <= new Date()) {
        return NextResponse.json(
          { error: `Las apuestas de tipo "${betType === "first_scorer" ? "Primer Anotador" : "Medio Tiempo"}" solo se pueden crear antes de que empiece el partido` },
          { status: 400 }
        )
      }
    }

    if (profileError) {
      const missingColumn = profileError.message?.includes("betting_blocked_until")
      if (!missingColumn) {
        return NextResponse.json(
          { error: "Failed to validate user profile" },
          { status: 500 }
        )
      }
    }

    if (profile?.is_banned) {
      return NextResponse.json(
        { error: "User is banned from betting" },
        { status: 403 }
      )
    }

    if (betMode === "real") {
      const allowed = await canCountryUseRealMoney(profile?.country ?? null)
      if (!allowed) {
        return NextResponse.json(
          { error: "El Modo Real no está habilitado en tu país" },
          { status: 403 }
        )
      }
      if (profile?.real_betting_enabled === false) {
        return NextResponse.json(
          { error: "Las apuestas en Modo Real están deshabilitadas para tu cuenta" },
          { status: 403 }
        )
      }
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

    // --- Group bet validation ---
    let groupRow: { id: string; sport: string | null; leagues: string[]; status: string } | null = null
    if (isGroupBet) {
      const { data: gMembership } = await supabase
        .from("group_members")
        .select("role")
        .eq("group_id", group_id)
        .eq("user_id", user.id)
        .maybeSingle()
      if (!gMembership) {
        return NextResponse.json({ error: "No eres miembro de este grupo" }, { status: 403 })
      }
      const { data: gRow } = await supabase
        .from("groups")
        .select("id, sport, leagues, status")
        .eq("id", group_id)
        .single()
      if (!gRow) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 })
      if (gRow.status === "archived") {
        return NextResponse.json({ error: "Este grupo está archivado" }, { status: 400 })
      }
      if (gRow.sport && eventRow.sport !== gRow.sport) {
        return NextResponse.json({ error: "Este evento no coincide con el deporte del grupo" }, { status: 400 })
      }
      const groupLeagues: string[] = gRow.leagues || []
      if (groupLeagues.length > 0) {
        const { data: ev } = await supabase.from("events").select("league").eq("id", eventId).single()
        if (ev && !groupLeagues.includes(ev.league)) {
          return NextResponse.json({ error: "Este evento no pertenece a los torneos del grupo" }, { status: 400 })
        }
      }
      groupRow = gRow
    }

    // --- Balance pre-check (read-only) ---
    const fee = isGroupBet ? 0 : amount * 0.03
    const totalNeeded = amount + fee

    // Read wallet balances and snapshot values for optimistic lock later
    let ibcSnapshot: { balance: number; blocked: number } | null = null
    let fantasySnapshot: number | null = null

    if (isGroupBet) {
      const { ensureDailyGrant } = await import("@/lib/group-wallet-utils")
      await ensureDailyGrant(supabase, group_id, user.id)
      // Balance check happens inside deductFromGroupWallet with optimistic lock
    } else if (betMode === "real") {
      const { data: ibcWallet, error: ibcErr } = await supabase
        .from("iby_wallets")
        .select("balance, balance_blocked")
        .eq("user_id", user.id)
        .single()
      if (ibcErr || !ibcWallet) {
        return NextResponse.json({ error: "iBY wallet not found" }, { status: 404 })
      }
      const available = Number(ibcWallet.balance) - Number(ibcWallet.balance_blocked)
      if (available < totalNeeded) {
        await supabase.from("profiles").update({ is_banned: true }).eq("id", user.id)
        return NextResponse.json({ error: "Saldo insuficiente. Tu cuenta fue suspendida.", banned: true }, { status: 403 })
      }
      ibcSnapshot = { balance: Number(ibcWallet.balance), blocked: Number(ibcWallet.balance_blocked) }
    } else {
      const { data: wallet, error: walletError } = await supabase
        .from("wallets")
        .select("balance_fantasy")
        .eq("user_id", user.id)
        .single()
      if (walletError || !wallet) {
        return NextResponse.json({ error: "Wallet not found" }, { status: 404 })
      }
      if (wallet.balance_fantasy < totalNeeded) {
        await supabase.from("profiles").update({ is_banned: true }).eq("id", user.id)
        return NextResponse.json({ error: "Saldo insuficiente. Tu cuenta fue suspendida.", banned: true }, { status: 403 })
      }
      fantasySnapshot = wallet.balance_fantasy
    }

    // 1. Insert bet FIRST (payment ordering invariant: record exists before money moves)
    const isAsymmetric = betType === "exact_score"

    const { data: bet, error: betError } = await supabase
      .from("bets")
      .insert({
        event_id: eventId,
        creator_id: user.id,
        type: isAsymmetric ? "asymmetric" : "symmetric",
        bet_type: betType,
        selection: JSON.stringify(selection),
        amount,
        multiplier: isAsymmetric ? (multiplier || 1) : 1,
        fee_amount: fee,
        creator_selection: selection.selection || "",
        status: "open",
        mode: betMode,
        group_id: isGroupBet ? group_id : null,
      })
      .select()
      .single()

    if (betError) {
      return NextResponse.json({ error: `Failed to create bet: ${betError.message}` }, { status: 400 })
    }

    // Helper: cancel the bet if wallet deduction fails below
    async function cancelBetOnFailure() {
      await supabase.from("bets").update({ status: "cancelled" }).eq("id", bet.id).eq("status", "open")
    }

    // 2. Deduct wallet — bet record already exists
    if (isGroupBet) {
      const { deductFromGroupWallet } = await import("@/lib/group-wallet-utils")
      try {
        await deductFromGroupWallet(supabase, group_id, user.id, totalNeeded)
      } catch (err: any) {
        await cancelBetOnFailure()
        if (err.message === "Saldo de grupo insuficiente") {
          await supabase.from("profiles").update({ is_banned: true }).eq("id", user.id)
          return NextResponse.json({ error: "Saldo insuficiente. Tu cuenta fue suspendida.", banned: true }, { status: 403 })
        }
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
    } else if (betMode === "real" && ibcSnapshot) {
      const { data: ibcUpdated, error: walletUpdateError } = await supabase
        .from("iby_wallets")
        .update({ balance: ibcSnapshot.balance - totalNeeded })
        .eq("user_id", user.id)
        .eq("balance", ibcSnapshot.balance)
        .eq("balance_blocked", ibcSnapshot.blocked)
        .select("user_id")
      if (walletUpdateError || !ibcUpdated || ibcUpdated.length === 0) {
        await cancelBetOnFailure()
        return NextResponse.json({ error: "Tu saldo cambió. Recarga e intenta de nuevo." }, { status: 409 })
      }
    } else if (fantasySnapshot !== null) {
      const { data: fantasyUpdated, error: walletUpdateError } = await supabase
        .from("wallets")
        .update({ balance_fantasy: fantasySnapshot - totalNeeded })
        .eq("user_id", user.id)
        .eq("balance_fantasy", fantasySnapshot)
        .select("user_id")
      if (walletUpdateError || !fantasyUpdated || fantasyUpdated.length === 0) {
        await cancelBetOnFailure()
        return NextResponse.json({ error: "Tu saldo cambió. Recarga e intenta de nuevo." }, { status: 409 })
      }
    }

    // Record transaction
    const { error: transactionError } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        token_type: isGroupBet ? "group_fantasy" : (betMode === "real" ? "iBY" : "fantasy"),
        amount: -totalNeeded,
        operation: "bet_created",
        reference_id: bet.id,
      })

    if (transactionError) {
      console.error("Transaction recording error:", transactionError)
    }

    await createNotification({
      userId: user.id,
      type: "bet_created",
      title: "Apuesta creada",
      body: `Tu apuesta de ${amount} ${betMode === "real" ? "iBYC" : "Fantasy Tokens"} fue publicada exitosamente.`,
      betId: bet.id,
    }, supabase)

    return NextResponse.json({
      success: true,
      bet: {
        id: bet.id,
        status: bet.status,
      },
    })
  } catch (error) {
    console.error("Create bet error:", error)
    return NextResponse.json(
      { error: "Failed to create bet" },
      { status: 500 }
    )
  }
}
