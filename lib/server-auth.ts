import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase"

function extractSupabaseAccessTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null

  const match = cookieHeader.match(/(?:^|;\s*)(sb-[^=]+-auth-token)=([^;]+)/)
  if (!match) return null

  let cookieValue = match[2]
  try {
    cookieValue = decodeURIComponent(cookieValue)
  } catch {
    // Keep raw value if decoding fails.
  }

  if (!cookieValue.startsWith("base64-")) return null

  try {
    const decoded = Buffer.from(cookieValue.slice(7), "base64").toString("utf-8")
    const parsed = JSON.parse(decoded) as any

    if (typeof parsed?.access_token === "string") return parsed.access_token
    if (typeof parsed?.currentSession?.access_token === "string") return parsed.currentSession.access_token
    if (typeof parsed?.session?.access_token === "string") return parsed.session.access_token
    if (Array.isArray(parsed) && typeof parsed[0]?.access_token === "string") return parsed[0].access_token
  } catch {
    return null
  }

  return null
}

export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get("authorization")
  let token: string | null = null

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7)
  }

  if (!token) {
    token = extractSupabaseAccessTokenFromCookie(request.headers.get("cookie"))
  }

  if (!token) return null

  const serverSupabase = createServerSupabaseClient()
  const {
    data: { user },
    error,
  } = await serverSupabase.auth.getUser(token)

  if (error || !user) return null
  return user.id
}

export async function requireBackofficeAdmin(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const adminSupabase = createAdminSupabaseClient()
  const { data: profile, error } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()

  if (error || profile?.role !== "backoffice_admin") {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }
  }

  return {
    authorized: true,
    userId,
  }
}