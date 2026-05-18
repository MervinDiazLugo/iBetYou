import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

// Public endpoint — no auth — used by landing page to show "X te invitó"
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 })

  const supabase = createAdminSupabaseClient()
  const { data } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("referral_code", code)
    .single()

  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 })

  return NextResponse.json({ nickname: data.nickname })
}
