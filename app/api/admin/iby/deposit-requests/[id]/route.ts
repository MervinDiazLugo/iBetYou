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
    return NextResponse.json({ error: "Cantidad de iBY coins inválida" }, { status: 400 })
  }

  const { data: wallet } = await supabase
    .from("iby_wallets")
    .select("balance")
    .eq("user_id", req.user_id)
    .single()

  if (!wallet) {
    await supabase.from("iby_wallets").insert({ user_id: req.user_id, balance: coinsToCredit })
  } else {
    await supabase
      .from("iby_wallets")
      .update({ balance: Number(wallet.balance) + coinsToCredit, updated_at: new Date().toISOString() })
      .eq("user_id", req.user_id)
  }

  await supabase.from("iby_transactions").insert({
    user_id: req.user_id,
    amount: coinsToCredit,
    operation: "deposit_approved",
    reference_id: id,
  })

  await supabase
    .from("deposit_requests")
    .update({
      status: "approved",
      iby_coins: coinsToCredit,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)

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
