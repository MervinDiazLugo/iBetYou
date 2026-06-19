// Sube los event templates del snapshot a app_settings.demo_event_templates
// en Supabase, para que el demo route los use sin depender de Claude AI.
// Uso: npx tsx scripts/upload-demo-templates.ts
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

// Load .env.local
try {
  const env = readFileSync(".env.local", "utf8")
  for (const line of env.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch (_) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function main() {
  const snapshot = JSON.parse(readFileSync("scripts/demo-snapshot.json", "utf8"))

  const templates = (snapshot.events as any[]).map((ev, i) => ({
    external_id: `demo_template_${String(i + 1).padStart(3, "0")}`,
    sport: ev.sport,
    league: ev.league,
    country: ev.country ?? "Unknown",
    home_team: ev.home_team,
    away_team: ev.away_team,
    home_logo: ev.home_logo ?? null,
    away_logo: ev.away_logo ?? null,
    metadata: {
      venue: ev.metadata?.venue ?? {},
      predictions: ev.metadata?.predictions ?? {},
    },
  }))

  const { error } = await supabase.from("app_settings").upsert(
    { key: "demo_event_templates", value: templates, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  )

  if (error) {
    console.error("Error:", error.message)
    process.exit(1)
  }

  console.log(`✓ ${templates.length} templates subidos a app_settings.demo_event_templates`)
  templates.forEach((t, i) =>
    console.log(`  ${i + 1}. [${t.sport}] ${t.home_team} vs ${t.away_team} (${t.league})`)
  )
}

main()
