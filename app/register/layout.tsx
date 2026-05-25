import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Crear cuenta",
  description: "Crea tu cuenta en iBetYou gratis y empieza a apostar en fútbol, básquetbol y béisbol con tus amigos.",
  alternates: { canonical: "https://i-bet-you.vercel.app/register" },
  openGraph: {
    title: "Crear cuenta | iBetYou",
    description: "Regístrate gratis y comienza a apostar P2P en deportes.",
    url: "https://i-bet-you.vercel.app/register",
  },
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
