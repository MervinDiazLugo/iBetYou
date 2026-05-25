import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Iniciar sesión",
  description: "Inicia sesión en iBetYou y comienza a apostar en eventos deportivos P2P.",
  robots: { index: false },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
