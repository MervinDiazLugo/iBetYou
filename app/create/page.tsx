"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CreateBetForm } from "@/components/create-bet-form"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { AlertCircle } from "lucide-react"

function CreateBetFormWithParams() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const cloneBetId = searchParams.get("clone")
  const supabase = createBrowserSupabaseClient()
  const [checkingRole, setCheckingRole] = useState(true)
  const [isBackofficeAdmin, setIsBackofficeAdmin] = useState(false)

  useEffect(() => {
    async function checkRole() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token

        if (!token) {
          setCheckingRole(false)
          return
        }

        const res = await fetch("/api/user/info", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        const data = await res.json().catch(() => null)
        setIsBackofficeAdmin(data?.user?.role === "backoffice_admin")
      } finally {
        setCheckingRole(false)
      }
    }

    checkRole()
  }, [supabase])

  if (checkingRole) {
    return <div>Cargando...</div>
  }

  if (isBackofficeAdmin) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center space-y-3">
        <AlertCircle className="h-10 w-10 mx-auto text-amber-500" />
        <h2 className="text-lg font-semibold">Acción no disponible para cuentas backoffice</h2>
        <p className="text-sm text-muted-foreground">
          Las cuentas de administración no pueden crear, tomar ni clonar apuestas en el marketplace.
        </p>
        <Button onClick={() => router.push("/backoffice")}>
          Ir al Backoffice
        </Button>
      </div>
    )
  }

  return (
    <CreateBetForm 
      onClose={() => router.push("/")} 
      cloneBetId={cloneBetId}
    />
  )
}

export default function CreateBetPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Card>
          <CardContent className="py-6">
            <Suspense fallback={<div>Cargando...</div>}>
              <CreateBetFormWithParams />
            </Suspense>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}