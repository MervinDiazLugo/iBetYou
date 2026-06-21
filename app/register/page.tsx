"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createBrowserSupabaseClient } from "@/lib/supabase"

const LATAM_COUNTRIES = [
  "Venezuela",
  "Argentina",
  "Colombia",
  "Chile",
  "México",
  "Perú",
  "Uruguay",
  "Bolivia",
  "Ecuador",
  "Paraguay",
  "Brasil",
  "Costa Rica",
  "Panamá",
  "Honduras",
  "El Salvador",
  "Guatemala",
  "Nicaragua",
  "República Dominicana",
  "Cuba",
]

const OTHER_COUNTRIES = [
  "España",
  "Estados Unidos",
  "Otro",
]

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createBrowserSupabaseClient()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [nickname, setNickname] = useState("")
  const [country, setCountry] = useState("")
  const [referralCode, setReferralCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)

  useEffect(() => {
    const ref = searchParams.get("ref")
    if (ref) setReferralCode(ref.toUpperCase())
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    if (!nickname.trim()) {
      setError("El apodo es requerido")
      setLoading(false)
      return
    }

    if (!country) {
      setError("El país es requerido")
      setLoading(false)
      return
    }

    if (!ageConfirmed || !termsAccepted) {
      setError("Debes confirmar que eres mayor de edad y aceptar los términos para continuar")
      setLoading(false)
      return
    }

    // Set referral cookie before signUp so auth callback picks it up
    const trimmedCode = referralCode.trim()
    if (trimmedCode && /^[a-zA-Z0-9_-]{6,16}$/.test(trimmedCode)) {
      const existing = document.cookie.split(";").some((c) => c.trim().startsWith("iby_ref="))
      if (!existing) {
        document.cookie = `iby_ref=${trimmedCode}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
      }
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nickname: nickname.trim(), country: country.trim() },
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    if (data.user) {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (session?.access_token) {
          // Email confirmation OFF — session exists immediately, update profile now
          const res = await fetch("/api/auth/register/nickname", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ userId: data.user.id, nickname, country }),
          })

          if (!res.ok) {
            const nicknameData = await res.json()
            setError(nicknameData.error || "Error al guardar el perfil")
            setLoading(false)
            return
          }
        }
        // If no session: email confirmation ON — nickname/country were passed as metadata
        // and will be applied in /api/auth/callback when user confirms their email

        setSuccess(true)
        setTimeout(() => {
          router.push("/login")
        }, 2000)
      } catch (err: any) {
        setError(err.message || "Error al guardar el perfil")
        setLoading(false)
      }
    }

    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-green-500">¡Cuenta creada!</CardTitle>
            <CardDescription>Ahora initiate sesión para obtener tus $50 de Fantasy Tokens</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button onClick={() => router.push("/login")}>
              Ir a Iniciar Sesión
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="flex justify-center mb-4">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded bg-primary text-primary-foreground font-extrabold tracking-tight text-2xl leading-none">
                iBetYou
              </span>
            </div>
          </Link>
          <CardTitle className="text-2xl">Crear Cuenta</CardTitle>
          <CardDescription>Únete y empieza a apostar</CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="nickname" className="text-sm font-medium">
                Nickname
              </label>
              <Input
                id="nickname"
                type="text"
                placeholder="Tu apodo"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
                minLength={3}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Contraseña
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="country" className="text-sm font-medium">
                País
              </label>
              <select
                id="country"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                required
              >
                <option value="">Selecciona tu país...</option>
                {LATAM_COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option disabled>──────────</option>
                {OTHER_COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="referralCode" className="text-sm font-medium">
                Código de referido <span className="text-muted-foreground font-normal">(opcional)</span>
              </label>
              <Input
                id="referralCode"
                type="text"
                placeholder="Ej: A1B2C3D4"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                maxLength={16}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Al registrarte recibirás 10,000 Fantasy Tokens para comenzar a apostar
            </p>

            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1">
              <p className="font-semibold">⚠️ Sitio de predicciones de fantasía</p>
              <p>iBetYou es una plataforma de entretenimiento con dinero <strong>ficticio (Fantasy Tokens)</strong>. No existe ninguna transacción con dinero real, ni premios en efectivo. Todos los resultados son virtuales y no tienen validez económica.</p>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  checked={ageConfirmed}
                  onChange={(e) => setAgeConfirmed(e.target.checked)}
                />
                <span className="text-sm">
                  Confirmo que soy <strong>mayor de 18 años</strong> y tengo la capacidad legal para registrarme en esta plataforma.
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                />
                <span className="text-sm">
                  Entiendo que iBetYou es una plataforma de <strong>entretenimiento fantasy</strong>, sin dinero real, y acepto los términos de uso.
                </span>
              </label>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={loading || !ageConfirmed || !termsAccepted}>
              {loading ? "Creando cuenta..." : "Registrarse"}
            </Button>

            <p className="text-sm text-center text-muted-foreground">
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Inicia sesión
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <RegisterForm />
    </Suspense>
  )
}
