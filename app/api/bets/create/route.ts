import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { createNotification } from "@/lib/notifications"
import { canCountryUseRealMoney } from "@/lib/country-access"

export async function POST(request: NextRequest) {
  try {
    const { userId, eventId, betType, selection, amount, multiplier, mode: rawMode } = await request.json()
    // Fee is always recalculated server-side — never trust the client-provided value
    const fee = amount * 0.03
    if (rawMode !== "real" && rawMode !== "fantasy" && rawMode !== undefined && rawMode !== null) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
    }
    const betMode = rawMode === "real" ? "real" : "fantasy"
    const footballOnlyBetTypes = new Set(["half_time", "first_scorer"])

    const authHeader = request.headers.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const token = authHeader.slice(7)
    const serverSupabase = createServerSupabaseClient()
    const {
      data: { user },
      error: authError,
    } = await serverSupabase.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    if (!userId || !eventId || !betType || !selection || !amount) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    if (betType === "exact_score" && multiplier !== undefined) {
      const parsedMultiplier = Number(multiplier)
      if (!Number.isFinite(parsedMultiplier) || parsedMultiplier < 1 || parsedMultiplier > 100) {
        return NextResponse.json({ error: "El multiplicador debe estar entre 1 y 100" }, { status: 400 })
      }
    }

    if (userId !== user.id) {
      return NextResponse.json(
        { error: "Unauthorized user scope" },
        { status: 403 }
      )
    }

    const supabase = createAdminSupabaseClient()

    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select("id, sport")
      .eq("id", eventId)
      .single()

    if (eventError || !eventRow) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      )
    }

    if (footballOnlyBetTypes.has(betType) && eventRow.sport !== "football") {
      return NextResponse.json(
        { error: "Este tipo de apuesta solo esta disponible para futbol" },
        { status: 400 }
      )
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, is_banned, role, betting_blocked_until, country")
      .eq("id", user.id)
      .single()

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

    // Get user wallet and validate balance — route by mode
    const totalNeeded = amount + fee
    let currentBalance: number
    if (betMode === "real") {
      const { data: ibcWallet, error: ibcErr } = await supabase
        .from("iby_wallets")
        .select("balance, balance_blocked")
        .eq("user_id", user.id)
        .single()
      if (ibcErr || !ibcWallet) {
        return NextResponse.json({ error: "IBC wallet not found" }, { status: 404 })
      }
      const available = Number(ibcWallet.balance) - Number(ibcWallet.balance_blocked)
      if (available < totalNeeded) {
        return NextResponse.json({ error: "Insufficient IBC balance" }, { status: 400 })
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
      if (wallet.balance_fantasy < totalNeeded) {
        return NextResponse.json({ error: "Insufficient balance" }, { status: 400 })
      }
      currentBalance = wallet.balance_fantasy
    }

    // Deduct from wallet — payment ordering invariant: update wallet before creating bet
    if (betMode === "real") {
      const { error: walletUpdateError } = await supabase
        .from("iby_wallets")
        .update({ balance: currentBalance - totalNeeded })
        .eq("user_id", user.id)
      if (walletUpdateError) {
        return NextResponse.json({ error: "Failed to update IBC wallet" }, { status: 400 })
      }
    } else {
      const { error: walletUpdateError } = await supabase
        .from("wallets")
        .update({ balance_fantasy: currentBalance - totalNeeded })
        .eq("user_id", user.id)
      if (walletUpdateError) {
        return NextResponse.json({ error: "Failed to update wallet" }, { status: 400 })
      }
    }

    // Create bet after confirmed deduction
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
      })
      .select()
      .single()

    if (betError) {
      // Rollback wallet deduction
      if (betMode === "real") {
        await supabase.from("iby_wallets").update({ balance: currentBalance }).eq("user_id", user.id)
      } else {
        await supabase.from("wallets").update({ balance_fantasy: currentBalance }).eq("user_id", user.id)
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
        token_type: betMode === "real" ? "ibc" : "fantasy",
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
      body: `Tu apuesta de ${amount} Fantasy Tokens fue publicada exitosamente.`,
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
