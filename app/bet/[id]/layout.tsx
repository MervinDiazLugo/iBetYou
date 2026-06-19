import { Metadata } from "next"
import { createAdminSupabaseClient } from "@/lib/supabase"

const BASE_URL = "https://i-bet-you.vercel.app"

const BET_TYPE_LABELS: Record<string, string> = {
  direct: "Directa",
  exact_score: "Resultado Exacto",
  run_line: "Run Line",
  total_runs: "Total Carreras",
  score_margin: "Margen",
  half_time: "Medio Tiempo",
  first_scorer: "Primer Anotador",
}

export async function generateMetadata({
  params,
}: {
  params: { id: string }
}): Promise<Metadata> {
  const supabase = createAdminSupabaseClient()

  const { data: bet } = await supabase
    .from("bets")
    .select(
      "bet_type, creator_selection, amount, house_bet, creator:profiles!creator_id(nickname), event:events(home_team, away_team, league)"
    )
    .eq("id", params.id)
    .maybeSingle()

  if (!bet) {
    return {
      title: "Predicción",
      description: "Ver detalles de esta predicción en iBetYou",
    }
  }

  const event = bet.event as any
  const creator = bet.creator as any
  const typeLabel = BET_TYPE_LABELS[bet.bet_type] ?? bet.bet_type
  const matchup = event ? `${event.home_team} vs ${event.away_team}` : "evento"
  const league = event?.league ?? ""
  const who = bet.house_bet ? "vs La Casa" : `(${typeLabel})`

  const title = `${creator?.nickname ?? "Predicción"} predice ${bet.creator_selection} en ${matchup} ${who}`
  const description = `${league ? league + " · " : ""}${matchup}. Predicción de ${bet.amount} tokens. Únete a iBetYou y compite.`
  const url = `${BASE_URL}/bet/${params.id}`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    },
  }
}

export default function BetLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
