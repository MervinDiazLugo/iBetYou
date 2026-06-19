import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Ranking de los mejores predictores en iBetYou. ¿Quién lidera las predicciones P2P esta semana?",
  alternates: { canonical: "https://i-bet-you.vercel.app/leaderboard" },
  openGraph: {
    title: "Leaderboard | iBetYou",
    description: "Ranking de los mejores predictores en iBetYou.",
    url: "https://i-bet-you.vercel.app/leaderboard",
  },
}

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
