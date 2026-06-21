import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { sendDepositApprovedEmail, sendDepositRejectedEmail } from "@/lib/email"

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { id } = await context.params
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 })

  const { action, iby_coins, rejection_reason } = body

  if (!["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()

  const { data: req, error: fetchError } = await supabase
    .from("deposit_requests")
    .select(`id, status, amount, iby_coins, user_id, profile:profiles!user_id(nickname)`)
    .eq("id", id)
    .single()

  if (fetchError || !req) {
    return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 })
  }

  if (req.status !== "pending") {
    return NextResponse.json({ error: "Esta solicitud ya fue procesada" }, { status: 409 })
  }

  // Fetch email from auth
  const { data: authUser } = await supabase.auth.admin.getUserById(req.user_id)
  const userEmail = authUser?.user?.email || null
  const profileRow = Array.isArray((req as any).profile) ? (req as any).profile[0] : (req as any).profile
  const userNickname = profileRow?.nickname || userEmail || "Usuario"

  if (action === "reject") {
    if (!rejection_reason?.trim()) {
      return NextResponse.json({ error: "Motivo de rechazo requerido" }, { status: 400 })
    }

    await supabase
      .from("deposit_requests")
      .update({
        status: "rejected",
        rejection_reason: rejection_reason.trim(),
        reviewed_by: auth.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)

    if (userEmail) {
      try {
        await sendDepositRejectedEmail({
          to: userEmail,
          nickname: userNickname,
          amount: Number(req.amount),
          reason: rejection_reason.trim(),
        })
      } catch (e) {
        console.error("Email rejected failed:", e)
      }
    }

    return NextResponse.json({ success: true, status: "rejected" })
  }

  // Approve
  const coinsToCredit = iby_coins != null ? Number(iby_coins) : Number(req.iby_coins)
  if (!coinsToCredit || coinsToCredit <= 0) {
    return NextResponse.json({ error: "Cantidad de iBYC inválida" }, { status: 400 })
  }

  // Mark approved first — payment ordering invariant; prevents double-credit if later steps fail
  const { data: approvedRows, error: approveError } = await supabase
    .from("deposit_requests")
    .update({
      status: "approved",
      iby_coins: coinsToCredit,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")

  if (approveError) {
    return NextResponse.json({ error: approveError.message }, { status: 500 })
  }
  if (!approvedRows || approvedRows.length === 0) {
    return NextResponse.json({ error: "Esta solicitud ya fue procesada" }, { status: 409 })
  }

  const { data: existingWallet } = await supabase
    .from("iby_wallets")
    .select("balance")
    .eq("user_id", req.user_id)
    .single()

  if (!existingWallet) {
    await supabase.from("iby_wallets").insert({ user_id: req.user_id, balance: coinsToCredit })
  } else {
    let credited = false
    for (let attempt = 0; attempt < 3 && !credited; attempt++) {
      const { data: w } = await supabase
        .from("iby_wallets")
        .select("balance")
        .eq("user_id", req.user_id)
        .single()
      if (!w) break
      const { data: updated } = await supabase
        .from("iby_wallets")
        .update({ balance: Number(w.balance) + coinsToCredit, updated_at: new Date().toISOString() })
        .eq("user_id", req.user_id)
        .eq("balance", Number(w.balance))
        .select("balance")
      if (updated && updated.length > 0) credited = true
    }
    if (!credited) {
      console.error("IBY_WALLET_CREDIT_FAILED after 3 attempts", { userId: req.user_id, coinsToCredit })
      return NextResponse.json({ error: "Error actualizando wallet, intenta de nuevo" }, { status: 500 })
    }
  }

  await supabase.from("iby_transactions").insert({
    user_id: req.user_id,
    amount: coinsToCredit,
    operation: "deposit_approved",
    reference_id: id,
  })

  if (userEmail) {
    try {
      await sendDepositApprovedEmail({
        to: userEmail,
        nickname: userNickname,
        ibyCoins: coinsToCredit,
        amount: Number(req.amount),
      })
    } catch (e) {
      console.error("Email approved failed:", e)
    }
  }

  return NextResponse.json({ success: true, status: "approved", iby_coins: coinsToCredit })
}
