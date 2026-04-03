"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createBrowserSupabaseClient } from "@/lib/supabase"

export default function BackofficeLoginPage() {
  const router = useRouter()
  const supabase = createBrowserSupabaseClient()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    async function checkExistingSession() {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return

      const res = await fetch("/api/user/info", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const info = await res.json().catch(() => null)
      if (res.ok && info?.user?.role === "backoffice_admin") {
        router.push("/backoffice")
      }
    }

    checkExistingSession()
  }, [router, supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError || !data.user) {
      setError(signInError?.message || "No se pudo iniciar sesión")
      setLoading(false)
      return
    }

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    if (!token) {
      setError("No se pudo validar sesión")
      setLoading(false)
      return
    }

    const res = await fetch("/api/user/info", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const info = await res.json().catch(() => null)
    if (!res.ok || info?.user?.role !== "backoffice_admin") {
      await supabase.auth.signOut()
      setError("Esta cuenta no tiene permisos de backoffice")
      setLoading(false)
      return
    }

    router.push("/backoffice")
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Backoffice Login</CardTitle>
          <CardDescription>Acceso exclusivo para administradores</CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">Email</label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">Contraseña</label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? "Ingresando..." : "Entrar a Backoffice"}
            </Button>
            <Link href="/" className="text-sm text-muted-foreground hover:underline">
              Volver al aplicativo
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
