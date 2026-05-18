import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from("withdrawal_methods")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ methods: data || [] })
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()
  const body = await request.json()
  const { type, label, details } = body

  if (!type || !["binance", "bank", "cbu_cvu"].includes(type)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 })
  }
  if (!label?.trim()) {
    return NextResponse.json({ error: "Etiqueta requerida" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("withdrawal_methods")
    .insert({ user_id: userId, type, label: label.trim(), details: details || {} })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ method: data })
}

export async function DELETE(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const supabase = createAdminSupabaseClient()
  const { error } = await supabase
    .from("withdrawal_methods")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
