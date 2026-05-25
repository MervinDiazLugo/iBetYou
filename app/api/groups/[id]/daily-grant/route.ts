import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { ensureDailyGrant } from "@/lib/group-wallet-utils"

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await context.params
  const supabase = createAdminSupabaseClient()

  const { data: membership } = await supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", userId).maybeSingle()
  if (!membership) return NextResponse.json({ error: "No eres miembro de este grupo" }, { status: 403 })

  try {
    const granted = await ensureDailyGrant(supabase, groupId, userId)
    const { data: wallet } = await supabase.from("group_wallets").select("balance").eq("group_id", groupId).eq("user_id", userId).single()
    return NextResponse.json({
      success: true,
      granted,
      balance: wallet?.balance ?? 0,
      message: granted ? "+500 tokens de grupo acreditados" : "Ya recibiste tus tokens de hoy",
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
