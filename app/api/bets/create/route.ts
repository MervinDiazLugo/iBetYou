import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { createNotification } from "@/lib/notifications"
import { canCountryUseRealMoney } from "@/lib/country-access"
import { payoutToMode } from "@/lib/wallet-utils"

export async function POST(request: NextRequest) {
  try {
    const { userId, eventId, betType, selection, amount: rawAmount, multiplier, mode: rawMode, group_id } = await request.json()
    if (rawMode !== "real" && rawMode !== "fantasy" && rawMode !== undefined && rawMode !== null) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
    }
    const isGroupBet = typeof group_id === "string" && group_id.length > 0
    const betMode = isGroupBet ? "fantasy" : (rawMode === "real" ? "real" : "fantasy")
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

    if (userId !== user.id) {
      return NextResponse.json(
        { error: "Unauthorized user scope" },
        { status: 403 }
      )
    }

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

    const [
      { data: eventRow, error: eventError },
      { data: profile, error: profileError },
    ] = await Promise.all([
      supabase.from("events").select("id, sport, status").eq("id", eventId).single(),
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
    let groupRow: { id: string; sport: string | null; league: string | null; status: string } | null = null
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
        .select("id, sport, league, status")
        .eq("id", group_id)
        .single()
      if (!gRow) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 })
      if (gRow.status === "archived") {
        return NextResponse.json({ error: "Este grupo está archivado" }, { status: 400 })
      }
      if (gRow.sport && eventRow.sport !== gRow.sport) {
        return NextResponse.json({ error: "Este evento no coincide con el deporte del grupo" }, { status: 400 })
      }
      groupRow = gRow
    }

    // --- Wallet operations ---
    const fee = isGroupBet ? 0 : amount * 0.03
    const totalNeeded = amount + fee

    if (isGroupBet) {
      const { ensureDailyGrant, deductFromGroupWallet } = await import("@/lib/group-wallet-utils")
      await ensureDailyGrant(supabase, group_id, user.id)
      try {
        await deductFromGroupWallet(supabase, group_id, user.id, totalNeeded)
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
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
        return NextResponse.json({ error: "Insufficient iBY balance" }, { status: 400 })
      }
      const currentBalance = Number(ibcWallet.balance)
      const currentBlocked = Number(ibcWallet.balance_blocked)
      const { data: ibcUpdated, error: walletUpdateError } = await supabase
        .from("iby_wallets")
        .update({ balance: currentBalance - totalNeeded })
        .eq("user_id", user.id)
        .eq("balance", currentBalance)
        .eq("balance_blocked", currentBlocked)
        .select("user_id")
      if (walletUpdateError) {
        return NextResponse.json({ error: "Failed to update iBY wallet" }, { status: 400 })
      }
      if (!ibcUpdated || ibcUpdated.length === 0) {
        return NextResponse.json({ error: "Tu saldo cambió. Recarga e intenta de nuevo." }, { status: 409 })
      }
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
      const currentBalance = wallet.balance_fantasy
      const { data: fantasyUpdated, error: walletUpdateError } = await supabase
        .from("wallets")
        .update({ balance_fantasy: currentBalance - totalNeeded })
        .eq("user_id", user.id)
        .eq("balance_fantasy", currentBalance)
        .select("user_id")
      if (walletUpdateError) {
        return NextResponse.json({ error: "Failed to update wallet" }, { status: 400 })
      }
      if (!fantasyUpdated || fantasyUpdated.length === 0) {
        return NextResponse.json({ error: "Tu saldo cambió. Recarga e intenta de nuevo." }, { status: 409 })
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
        group_id: isGroupBet ? group_id : null,
      })
      .select()
      .single()

    if (betError) {
      try {
        if (isGroupBet) {
          const { creditGroupWallet } = await import("@/lib/group-wallet-utils")
          await creditGroupWallet(supabase, group_id, user.id, totalNeeded)
        } else {
          await payoutToMode(supabase, user.id, totalNeeded, betMode)
        }
      } catch (rollbackErr) {
        console.error("REFUND_FAILED", { userId: user.id, amount: totalNeeded, betMode, error: rollbackErr })
      }
      return NextResponse.json({ error: `Failed to create bet: ${betError.message}` }, { status: 400 })
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
