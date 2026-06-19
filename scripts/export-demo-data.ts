// Exporta los eventos y apuestas del demo mode actual a un archivo JSON local.
// Uso: npx tsx scripts/export-demo-data.ts
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local

import { createClient } from "@supabase/supabase-js"
import { writeFileSync } from "fs"
import { join } from "path"
// Load .env.local manually (no dotenv dependency needed)
import { readFileSync } from "fs"
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

async function main() {
  // Export demo events (is_demo=true)
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("*")
    .eq("is_demo", true)

  if (eventsError) {
    console.error("Error leyendo eventos:", eventsError.message)
    process.exit(1)
  }

  // Export demo bets (is_demo=true)
  const { data: bets, error: betsError } = await supabase
    .from("bets")
    .select("*")
    .eq("is_demo", true)

  if (betsError) {
    console.error("Error leyendo apuestas:", betsError.message)
    process.exit(1)
  }

  const snapshot = {
    exported_at: new Date().toISOString(),
    events: events ?? [],
    bets: bets ?? [],
  }

  const outPath = join(process.cwd(), "scripts", "demo-snapshot.json")
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8")

  console.log(`✓ ${snapshot.events.length} eventos, ${snapshot.bets.length} apuestas → scripts/demo-snapshot.json`)
}

main()
