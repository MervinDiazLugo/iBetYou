import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { requireBackofficeAdmin } from "@/lib/server-auth"

/** Fetch with ONLY the x-apisports-key header — some api-sports endpoints
 *  reject requests that contain extra framework-injected headers (Accept,
 *  Accept-Encoding, User-Agent, etc.).  Using node:https directly gives us
 *  full control over what gets sent. */
function fetchApiSports(url: string, apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const { hostname, pathname, search } = new URL(url)
    const req = https.request(
      { method: "GET", hostname, path: pathname + search, headers: { "x-apisports-key": apiKey } },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
          catch (e) { reject(e) }
        })
      }
    )
    req.setTimeout(10000, () => { req.destroy(new Error("timeout")) })
    req.on("error", reject)
    req.end()
  })
}

const API_KEY = process.env.API_FOOTBALL_KEY
const API_FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const API_BASKETBALL_URL = process.env.API_BASKETBALL_URL || "https://v1.basketball.api-sports.io"
const API_BASEBALL_URL = process.env.API_BASEBALL_URL || "https://v1.baseball.api-sports.io"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const searchParams = request.nextUrl.searchParams
  const sport = searchParams.get("sport") || "football"
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  if (!from || !to) {
    return NextResponse.json({ error: 'Se requieren parámetros from y to (YYYY-MM-DD)' }, { status: 400 })
  }

  const sportApiKey = API_KEY
  if (!sportApiKey) {
    return NextResponse.json({ error: "API key no configurada (API_FOOTBALL_KEY)" }, { status: 500 })
  }

  try {
    // Generate date list in UTC to avoid local timezone shifting one day back.
    const parseDateUTC = (value: string) => {
      const [y, m, d] = value.split("-").map(Number)
      return new Date(Date.UTC(y, m - 1, d))
    }

    const formatDateUTC = (value: Date) => {
      const y = value.getUTCFullYear()
      const m = String(value.getUTCMonth() + 1).padStart(2, "0")
      const d = String(value.getUTCDate()).padStart(2, "0")
      return `${y}-${m}-${d}`
    }

    const dates: string[] = []
    const startDate = parseDateUTC(from)
    const endDate = parseDateUTC(to)

    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(formatDateUTC(d))
    }

    let allEvents: any[] = []
    const failedDates: Array<{ date: string; status?: number; reason: string }> = []

    // Fetch events for each date
    for (const date of dates) {
      let url = ""
      
      if (sport === "football") {
        url = `${API_FOOTBALL_URL}/fixtures?date=${date}`
      } else if (sport === "basketball") {
        url = `${API_BASKETBALL_URL}/games?date=${date}`
      } else if (sport === "baseball") {
        url = `${API_BASEBALL_URL}/games?date=${date}`
      }

      if (!url) continue

      try {
        const data = await fetchApiSports(url, sportApiKey)
        if (data.errors && Object.keys(data.errors).length > 0) {
          failedDates.push({ date, reason: JSON.stringify(data.errors) })
        } else if (data.response && Array.isArray(data.response)) {
          allEvents = [...allEvents, ...data.response]
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error"
        console.error(`Error fetching ${sport} ${date}:`, e)
        failedDates.push({ date, reason: msg })
      }
    }

    if (allEvents.length === 0 && failedDates.length > 0) {
      return NextResponse.json(
        {
          error: `No se pudieron obtener eventos de ${sport}`,
          details: failedDates,
        },
        { status: 502 }
      )
    }

    return NextResponse.json(allEvents)
  } catch (error) {
    console.error("Events API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
