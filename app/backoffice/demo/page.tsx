"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createBrowserSupabaseClient } from "@/lib/supabase"

async function authFetch(input: RequestInfo, init?: RequestInit) {
  const supabase = createBrowserSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init?.headers)
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}

export default function DemoModePage() {
  const [status, setStatus] = useState<{ active: boolean; activated_at: string | null; demo_event_count: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState("")

  const loadStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/admin/demo")
      if (res.ok) setStatus(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  async function activate() {
    setActivating(true)
    setError("")
    setResult(null)
    try {
      const res = await authFetch("/api/admin/demo", { method: "POST" })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Error al activar"); return }
      setResult(data)
      await loadStatus()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActivating(false)
    }
  }

  async function deactivate() {
    setDeactivating(true)
    setError("")
    setResult(null)
    try {
      const res = await authFetch("/api/admin/demo", { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Error al desactivar"); return }
      setResult({ deactivated: true })
      await loadStatus()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Modo Demo</h1>
        <p className="text-muted-foreground">Activa un entorno de demostración con eventos y apuestas de prueba para todos los usuarios</p>
      </div>

      {/* Status card */}
      <Card>
        <CardHeader><CardTitle className="text-base">Estado actual</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-muted-foreground">Cargando...</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Badge className={status?.active
                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                  : "bg-muted text-muted-foreground"
                }>
                  {status?.active ? "🎮 DEMO ACTIVO" : "⬛ DEMO INACTIVO"}
                </Badge>
                {status?.active && (
                  <span className="text-sm text-muted-foreground">
                    {status.demo_event_count} eventos demo · activado {status.activated_at
                      ? new Date(status.activated_at).toLocaleString("es-ES", { timeZone: "UTC" })
                      : ""}
                  </span>
                )}
              </div>

              <div className="flex gap-3">
                {!status?.active ? (
                  <Button onClick={activate} disabled={activating} className="bg-yellow-500 hover:bg-yellow-400 text-black font-semibold">
                    {activating ? "Activando..." : "🎮 Activar Demo Mode"}
                  </Button>
                ) : (
                  <Button onClick={deactivate} disabled={deactivating} variant="destructive">
                    {deactivating ? "Desactivando..." : "⬛ Desactivar Demo Mode"}
                  </Button>
                )}
                <Button variant="outline" onClick={loadStatus}>Refrescar</Button>
              </div>
            </>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </CardContent>
      </Card>

      {/* Result */}
      {result && !result.deactivated && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Resultado de activación</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Eventos demo", value: result.demo_events ?? 0 },
                { label: "Apuestas creadas", value: result.demo_bets ?? 0 },
                { label: "Eventos sin predicción", value: result.skipped ?? 0 },
                { label: "Errores", value: result.prediction_errors?.length ?? 0 },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">{label}</div>
                  <div className="text-xl font-bold">{value}</div>
                </div>
              ))}
            </div>
            {result.prediction_errors?.length > 0 && (
              <details className="text-xs text-muted-foreground mt-2">
                <summary className="cursor-pointer">Ver errores ({result.prediction_errors.length})</summary>
                <pre className="mt-1 bg-muted rounded p-2 overflow-auto">{result.prediction_errors.join("\n")}</pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}
      {result?.deactivated && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-400">
          ✅ Demo mode desactivado. Los eventos demo fueron limpiados y las apuestas abiertas canceladas.
        </div>
      )}

      {/* Info */}
      <Card>
        <CardHeader><CardTitle className="text-sm">¿Cómo funciona?</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="space-y-2">
            <p>🎯 <strong className="text-foreground">Al activar:</strong> Claude selecciona 16 eventos reales de la DB próximos, genera predicciones (api-sports + AI), crea apuestas de demostración por cada tipo de apuesta disponible por deporte, y muestra solo esos eventos en el marketplace para todos los usuarios.</p>
            <p>🎮 <strong className="text-foreground">Mientras activo:</strong> el marketplace muestra un banner amarillo y solo los eventos demo. Los usuarios apuestan con sus tokens Fantasy normales.</p>
            <p>🌅 <strong className="text-foreground">Al día siguiente (3AM UTC):</strong> el sistema genera resultados sintéticos basados en las predicciones, resuelve las apuestas, y activa 16 nuevos eventos demo automáticamente.</p>
            <p>⬛ <strong className="text-foreground">Al desactivar:</strong> se limpian los eventos demo y se cancela las apuestas abiertas. El marketplace vuelve a mostrar todos los eventos normales.</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <p className="text-xs font-medium text-foreground">Apuestas creadas por deporte:</p>
            <p className="text-xs">⚽ Fútbol: Resultado directo · Marcador exacto · Medio tiempo</p>
            <p className="text-xs">🏀 Basketball: Resultado directo · Margen de puntos</p>
            <p className="text-xs">⚾ Béisbol: Resultado directo · Run Line · Total carreras</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
