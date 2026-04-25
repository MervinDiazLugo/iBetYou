import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  const { data: accounts, error } = await supabase
    .from("deposit_accounts")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ accounts: accounts || [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 })

  const { type, label, details } = body

  if (!["binance", "bank", "cbu_cvu"].includes(type)) {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 })
  }
  if (!label?.trim()) {
    return NextResponse.json({ error: "Etiqueta requerida" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()

  const { data: account, error } = await supabase
    .from("deposit_accounts")
    .insert({ type, label: label.trim(), details: details || {} })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, account }, { status: 201 })
}
