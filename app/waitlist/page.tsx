"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Button } from "@/components/ui/button"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"
import { Rocket, Coins, Trophy, Users } from "lucide-react"

export default function WaitlistPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [joined, setJoined] = useState(false)
  const [sessionToken, setSessionToken] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/login"); return }
      setSessionToken(session.access_token)
    })
  }, [router])

  async function handleJoin() {
    if (!sessionToken) return
    setLoading(true)
    try {
      const res = await fetch("/api/user/beta-signup", {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      })
      const data = await res.json()
      if (data.already_joined) {
        setJoined(true)
        showToast("Ya estás registrado en el beta", "success")
        return
      }
      if (data.success) {
        setJoined(true)
        window.dispatchEvent(new Event("wallet:updated"))
        showToast(`¡Registrado! +${data.bonus} fichas acreditadas 🚀`, "success")
      }
    } catch {
      showToast("Error al registrarse. Intenta de nuevo.", "error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-12 max-w-lg">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/15 mb-4">
            <Rocket className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Modo Real — Beta</h1>
          <p className="text-muted-foreground">
            Pronto podrás apostar con dinero real. Regístrate ahora y sé de los primeros en acceder.
          </p>
        </div>

        <div className="space-y-3 mb-8">
          {[
            { icon: Coins, text: "+2,000 fichas Fantasy por registrarte hoy" },
            { icon: Trophy, text: "Acceso anticipado cuando activemos el modo real" },
            { icon: Users, text: "Forma parte de los primeros 1,000 usuarios activos" },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <span className="text-sm">{text}</span>
            </div>
          ))}
        </div>

        {joined ? (
          <div className="text-center space-y-4">
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-green-400 text-sm">
              ¡Ya estás en la lista! Te avisaremos cuando el modo real esté activo.
            </div>
            <Button variant="outline" className="w-full" onClick={() => router.push("/")}>
              Volver al Marketplace
            </Button>
          </div>
        ) : (
          <Button className="w-full h-12 text-base font-semibold" onClick={handleJoin} disabled={loading || !sessionToken}>
            {loading ? "Registrando..." : "Quiero ser beta tester →"}
          </Button>
        )}
      </main>
    </div>
  )
}
