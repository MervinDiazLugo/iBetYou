import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { generateAiPredictions } from "@/lib/ai-predictions"

const CRON_SECRET = process.env.CRON_SECRET
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const HOUSE_NICKNAME = "TheOne"
const BET_AMOUNT = 10
const FEE_RATE = 0.03
const BETS_PER_DAY = 3

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
  }

  const supabase = createAdminSupabaseClient()

  // 1. Look up TheOne
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("nickname", HOUSE_NICKNAME)
    .single()

  if (profileErr || !profile) {
    return NextResponse.json({ error: `User "${HOUSE_NICKNAME}" not found` }, { status: 404 })
  }
  const userId = profile.id

  // 2. Refresh AI predictions for featured events missing them (replaces separate 12:15 cron)
  {
    const { data: featuredForPred } = await supabase
      .from("events")
      .select("id, external_id, sport, league, home_team, away_team, metadata")
      .eq("featured", true)
      .in("status", ["scheduled", "live"])
    const needsAi = (featuredForPred || []).filter(e => !(e as any).metadata?.predictions?.percent)
    if (needsAi.length > 0) {
      try {
        const aiPreds = await generateAiPredictions(needsAi as any)
        await Promise.all(Array.from(aiPreds.entries()).map(([eventId, prediction]) => {
          const ev = needsAi.find(e => e.id === eventId)
          return supabase.from("events").update({ metadata: { ...((ev as any)?.metadata || {}), predictions: prediction } }).eq("id", eventId)
        }))
      } catch (_) {}
    }
  }

  // 2b. Get top featured upcoming events
  const minStart = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const { data: featuredEvents, error: eventsErr } = await supabase
    .from("events")
    .select("id, sport, league, home_team, away_team, start_time")
    .eq("featured", true)
    .eq("status", "scheduled")
    .gte("start_time", minStart)
    .order("start_time", { ascending: true })
    .limit(BETS_PER_DAY * 2)

  if (eventsErr) return NextResponse.json({ error: eventsErr.message }, { status: 500 })
  if (!featuredEvents || featuredEvents.length === 0) {
    return NextResponse.json({ success: true, message: "No featured events available", created: 0 })
  }

  // 3. Filter events where TheOne already has an open bet
  const eventIds = featuredEvents.map(e => e.id)
  const { data: existingBets } = await supabase
    .from("bets")
    .select("event_id")
    .eq("creator_id", userId)
    .eq("status", "open")
    .in("event_id", eventIds)

  const alreadyBet = new Set((existingBets || []).map(b => b.event_id))
  const eligibleEvents = featuredEvents.filter(e => !alreadyBet.has(e.id)).slice(0, BETS_PER_DAY)

  if (eligibleEvents.length === 0) {
    return NextResponse.json({ success: true, message: "TheOne already has open bets on all featured events", created: 0 })
  }

  // 4. Ask Claude to pick the most likely winner for each event
  const matchLines = eligibleEvents
    .map(e => `${e.id}|${e.sport}|${e.home_team} vs ${e.away_team}`)
    .join("\n")

  const prompt = `Pick the most likely winner for each match. Football: home team name, away team name, or "Empate". Basketball/baseball: home or away team name only. Favor clear favorites; if even, pick home.

${matchLines}

Reply ONLY: [{"id":123,"selection":"Team Name"},...]`

  let selections: Array<{ id: number; selection: string }> = []

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
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return NextResponse.json({ error: `Claude API error: ${res.status} ${body}` }, { status: 500 })
    }

    const data = await res.json()
    const text: string = data?.content?.[0]?.text ?? ""
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) throw new Error("No JSON array in response")
    selections = JSON.parse(match[0])
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to get selections from Claude: ${e.message}` }, { status: 500 })
  }

  const selectionMap = new Map(selections.map(s => [s.id, s.selection]))

  // 5. Ensure wallet funds and create bets
  const totalNeeded = BET_AMOUNT + BET_AMOUNT * FEE_RATE  // 10.30 per bet
  const totalForAllBets = totalNeeded * eligibleEvents.length  // e.g. 30.90 for 3 bets

  // Fantasy wallet check + top-up
  const { data: fantasyWallet } = await supabase
    .from("wallets")
    .select("balance_fantasy")
    .eq("user_id", userId)
    .single()

  if (fantasyWallet) {
    const fantasyBalance = Number(fantasyWallet.balance_fantasy)
    if (fantasyBalance < totalForAllBets) {
      const deficit = totalForAllBets - fantasyBalance
      await supabase
        .from("wallets")
        .update({ balance_fantasy: fantasyBalance + deficit })
        .eq("user_id", userId)
    }
  }

  // Real wallet check + top-up
  const { data: realWallet } = await supabase
    .from("iby_wallets")
    .select("balance, balance_blocked")
    .eq("user_id", userId)
    .single()

  if (realWallet) {
    const available = Number(realWallet.balance) - Number(realWallet.balance_blocked)
    if (available < totalForAllBets) {
      const deficit = totalForAllBets - available
      await supabase
        .from("iby_wallets")
        .update({ balance: Number(realWallet.balance) + deficit })
        .eq("user_id", userId)
    }
  }

  // 6. Create bets
  const modes: Array<"fantasy" | "real"> = ["fantasy", "real"]
  const created: Array<{ event_id: number; mode: string; selection: string; bet_id: string }> = []
  const errors: string[] = []

  for (const event of eligibleEvents) {
    const selection = selectionMap.get(event.id)
    if (!selection) {
      errors.push(`No selection returned for event ${event.id}`)
      continue
    }

    for (const mode of modes) {
      // Re-read balance to get current value after previous iterations
      let currentBalance: number

      if (mode === "real") {
        if (!realWallet) { errors.push(`Real wallet not found for ${HOUSE_NICKNAME}`); continue }
        const { data: w } = await supabase.from("iby_wallets").select("balance").eq("user_id", userId).single()
        currentBalance = Number(w?.balance ?? 0)
      } else {
        if (!fantasyWallet) { errors.push(`Fantasy wallet not found for ${HOUSE_NICKNAME}`); continue }
        const { data: w } = await supabase.from("wallets").select("balance_fantasy").eq("user_id", userId).single()
        currentBalance = Number(w?.balance_fantasy ?? 0)
      }

      // Deduct wallet first (payment ordering invariant)
      const newBalance = currentBalance - totalNeeded
      if (mode === "real") {
        const { error: walletErr } = await supabase
          .from("iby_wallets")
          .update({ balance: newBalance })
          .eq("user_id", userId)
        if (walletErr) { errors.push(`Wallet deduct failed (real) event ${event.id}: ${walletErr.message}`); continue }
      } else {
        const { error: walletErr } = await supabase
          .from("wallets")
          .update({ balance_fantasy: newBalance })
          .eq("user_id", userId)
        if (walletErr) { errors.push(`Wallet deduct failed (fantasy) event ${event.id}: ${walletErr.message}`); continue }
      }

      // Create bet
      const { data: bet, error: betErr } = await supabase
        .from("bets")
        .insert({
          event_id: event.id,
          creator_id: userId,
          type: "symmetric",
          bet_type: "direct",
          selection: JSON.stringify({ selection }),
          creator_selection: selection,
          amount: BET_AMOUNT,
          multiplier: 1,
          fee_amount: BET_AMOUNT * FEE_RATE,
          status: "open",
          mode,
        })
        .select("id")
        .single()

      if (betErr) {
        // Rollback wallet deduction
        if (mode === "real") {
          await supabase.from("iby_wallets").update({ balance: currentBalance }).eq("user_id", userId)
        } else {
          await supabase.from("wallets").update({ balance_fantasy: currentBalance }).eq("user_id", userId)
        }
        errors.push(`Bet insert failed (${mode}) event ${event.id}: ${betErr.message}`)
        continue
      }

      // Record transaction
      await supabase.from("transactions").insert({
        user_id: userId,
        token_type: mode === "real" ? "iBY" : "fantasy",
        amount: -totalNeeded,
        operation: "bet_created",
        reference_id: bet.id,
      })

      created.push({ event_id: event.id, mode, selection, bet_id: bet.id })
    }
  }

  console.log("[cron/auto-bets]", { created: created.length, errors })

  return NextResponse.json({ success: true, created: created.length, bets: created, errors })
}
