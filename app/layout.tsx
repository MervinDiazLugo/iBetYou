import type { Metadata } from "next"
import "./globals.css"
import { AuthProvider } from "@/components/providers"
import { ToastProvider } from "@/components/toast"
import { ModeProvider } from "@/components/mode-provider"

export const metadata: Metadata = {
  title: "iBetYou - Apuestas Fantasy entre usuarios",
  description: "Plataforma de apuestas fantasy peer-to-peer entre usuarios",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-background font-sans antialiased">
        <AuthProvider>
          <ToastProvider>
            <ModeProvider>{children}</ModeProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
