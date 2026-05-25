import type { Metadata } from "next"
import "./globals.css"
import { AuthProvider } from "@/components/providers"
import { ToastProvider } from "@/components/toast"
import { ModeProvider } from "@/components/mode-provider"

const BASE_URL = "https://i-bet-you.vercel.app"

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "iBetYou – Apuestas P2P Deportivas",
    template: "%s | iBetYou",
  },
  description:
    "Crea apuestas deportivas P2P con tus amigos o apuesta contra la casa. Fútbol, básquetbol y béisbol en modo fantasy o real.",
  keywords: [
    "apuestas deportivas",
    "apuestas P2P",
    "apuestas fantasy",
    "fútbol",
    "básquetbol",
    "béisbol",
    "Venezuela",
  ],
  authors: [{ name: "iBetYou" }],
  creator: "iBetYou",
  openGraph: {
    type: "website",
    locale: "es_VE",
    url: BASE_URL,
    siteName: "iBetYou",
    title: "iBetYou – Apuestas P2P Deportivas",
    description:
      "Crea apuestas deportivas P2P con tus amigos o apuesta contra la casa. Fútbol, básquetbol y béisbol.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "iBetYou – Apuestas P2P Deportivas",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "iBetYou – Apuestas P2P Deportivas",
    description:
      "Crea apuestas deportivas P2P con tus amigos o apuesta contra la casa.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: BASE_URL,
  },
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
