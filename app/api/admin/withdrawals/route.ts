import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createNotification } from "@/lib/notifications"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status") || "pending"

  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select(`
      *,
      user:profiles!withdrawal_requests_user_id_fkey(id, nickname, email, kyc_status),
      method:withdrawal_methods(type, label)
    `)
    .eq("status", status)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data || [] })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const body = await request.json()
  const { id, action, rejection_type, rejection_reason, admin_notes } = body

  if (!id || !action) return NextResponse.json({ error: "id and action required" }, { status: 400 })

  const { data: req, error: fetchErr } = await supabase
    .from("withdrawal_requests")
    .select("*")
    .eq("id", id)
    .single()

  if (fetchErr || !req) return NextResponse.json({ error: "Request not found" }, { status: 404 })

  if (req.status === "paid" || req.status === "rejected") {
    return NextResponse.json({ error: "Request already finalized" }, { status: 409 })
  }

  if (action === "approve") {
    await supabase
      .from("withdrawal_requests")
      .update({ status: "processing", admin_notes: admin_notes || null, updated_at: new Date().toISOString() })
      .eq("id", id)

  } else if (action === "complete") {
    await supabase.rpc("complete_withdrawal", {
      p_user_id: req.user_id,
      p_amount: req.amount,
    })
    await supabase.from("transactions").insert({
      user_id: req.user_id,
      token_type: "iBY",
      amount: -Number(req.amount),
      operation: "withdrawal_paid",
      reference_id: req.id,
    })
    await supabase
      .from("withdrawal_requests")
      .update({ status: "paid", admin_notes: admin_notes || null, updated_at: new Date().toISOString() })
      .eq("id", id)

    await createNotification({
      userId: req.user_id,
      type: "withdrawal_approved",
      title: "Retiro aprobado",
      body: `Tu retiro de ${Number(req.net_amount).toFixed(2)} iBYC fue procesado exitosamente.`,
      betId: null,
    }, supabase)

  } else if (action === "reject") {
    if (!rejection_type || !["refund", "forfeit"].includes(rejection_type)) {
      return NextResponse.json({ error: "rejection_type must be 'refund' or 'forfeit'" }, { status: 400 })
    }
    if (!rejection_reason?.trim()) {
      return NextResponse.json({ error: "rejection_reason required" }, { status: 400 })
    }

    if (rejection_type === "refund") {
      await supabase.rpc("refund_withdrawal", { p_user_id: req.user_id, p_amount: req.amount })
      await supabase.from("transactions").insert({
        user_id: req.user_id,
        token_type: "iBY",
        amount: Number(req.amount),
        operation: "withdrawal_refunded",
        reference_id: req.id,
      })
    } else {
      await supabase.rpc("forfeit_withdrawal", { p_user_id: req.user_id, p_amount: req.amount })
      await supabase.from("transactions").insert({
        user_id: req.user_id,
        token_type: "iBY",
        amount: -Number(req.amount),
        operation: "withdrawal_forfeited",
        reference_id: req.id,
      })
    }

    await supabase
      .from("withdrawal_requests")
      .update({
        status: "rejected",
        rejection_type,
        rejection_reason: rejection_reason.trim(),
        admin_notes: admin_notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)

    await createNotification({
      userId: req.user_id,
      type: "withdrawal_rejected",
      title: "Retiro rechazado",
      body: rejection_type === "refund"
        ? `Tu retiro fue rechazado: ${rejection_reason}. Los fondos fueron devueltos a tu saldo iBYC.`
        : `Tu retiro fue rechazado: ${rejection_reason}. Los fondos fueron retenidos.`,
      betId: null,
    }, supabase)

  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
