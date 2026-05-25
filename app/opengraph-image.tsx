import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "iBetYou – Apuestas P2P Deportivas"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 80,
            fontWeight: 800,
            color: "#22c55e",
            letterSpacing: "-2px",
            marginBottom: 16,
          }}
        >
          iBetYou
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#94a3b8",
            textAlign: "center",
            maxWidth: 800,
          }}
        >
          Apuestas deportivas P2P · Fútbol · Básquetbol · Béisbol
        </div>
        <div
          style={{
            marginTop: 40,
            background: "#22c55e",
            color: "#0f172a",
            fontSize: 22,
            fontWeight: 700,
            padding: "12px 32px",
            borderRadius: 40,
          }}
        >
          i-bet-you.vercel.app
        </div>
      </div>
    ),
    { ...size }
  )
}
