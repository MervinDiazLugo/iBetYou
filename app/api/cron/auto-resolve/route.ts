import { NextRequest, NextResponse } from "next/server"

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000"

  try {
    const res = await fetch(`${baseUrl}/api/admin/bets/auto-resolve-finished`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auto-resolve-secret": CRON_SECRET,
      },
      body: JSON.stringify({}),
    })

    const data = await res.json()
    console.log("[cron/auto-resolve]", data)
    return NextResponse.json({ success: true, ...data })
  } catch (e: any) {
    console.error("[cron/auto-resolve] error:", e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
