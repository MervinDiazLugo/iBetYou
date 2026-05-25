"use client"

import { useState, useEffect } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"
import { Globe, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface CountryConfig {
  country_code: string
  country_name: string
  real_money_enabled: boolean
  house_betting_fantasy_enabled: boolean
  house_betting_real_enabled: boolean
  created_at: string
}

type ToggleField = "real_money_enabled" | "house_betting_fantasy_enabled" | "house_betting_real_enabled"

const LATAM_PRESETS = [
  { code: "Venezuela", name: "Venezuela" },
  { code: "Argentina", name: "Argentina" },
  { code: "Colombia", name: "Colombia" },
  { code: "Chile", name: "Chile" },
  { code: "México", name: "México" },
  { code: "Perú", name: "Perú" },
  { code: "Uruguay", name: "Uruguay" },
  { code: "Bolivia", name: "Bolivia" },
  { code: "Ecuador", name: "Ecuador" },
  { code: "Paraguay", name: "Paraguay" },
  { code: "Brasil", name: "Brasil" },
  { code: "España", name: "España" },
  { code: "Estados Unidos", name: "Estados Unidos" },
]

function Toggle({ enabled, onToggle, title }: { enabled: boolean; onToggle: () => void; title: string; color: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? "bg-yellow-500" : "bg-muted"}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4.5" : "translate-x-1"}`} />
    </button>
  )
}

export default function CountriesPage() {
  const { showToast } = useToast()
  const supabase = createBrowserSupabaseClient()
  const [countries, setCountries] = useState<CountryConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [addingCode, setAddingCode] = useState("")
  const [addingName, setAddingName] = useState("")
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function authFetch(input: RequestInfo, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  async function load() {
    setLoading(true)
    const res = await authFetch("/api/admin/countries")
    if (res.ok) {
      const d = await res.json()
      setCountries(d.countries || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function toggleField(country_code: string, field: ToggleField, current: boolean) {
    const res = await authFetch("/api/admin/countries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country_code, [field]: !current }),
    })
    if (res.ok) {
      setCountries(prev => prev.map(c =>
        c.country_code === country_code ? { ...c, [field]: !current } : c
      ))
      const labels: Record<ToggleField, string> = {
        real_money_enabled: "Modo Real",
        house_betting_fantasy_enabled: "Casa Fantasy",
        house_betting_real_enabled: "Casa Real",
      }
      showToast(`${labels[field]} ${!current ? "habilitado" : "deshabilitado"} para ${country_code}`, "success")
    } else {
      showToast("Error al actualizar", "error")
    }
  }

  async function addCountry(code: string, name: string) {
    if (!code.trim() || !name.trim()) { showToast("Código y nombre requeridos", "error"); return }
    setSaving(true)
    const res = await authFetch("/api/admin/countries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country_code: code.trim(), country_name: name.trim(), real_money_enabled: false }),
    })
    if (res.ok) {
      showToast(`${name} agregado`, "success")
      setAddingCode("")
      setAddingName("")
      load()
    } else {
      const d = await res.json()
      showToast(d.error || "Error al agregar", "error")
    }
    setSaving(false)
  }

  async function deleteCountry(country_code: string) {
    const res = await authFetch(`/api/admin/countries?country_code=${encodeURIComponent(country_code)}`, {
      method: "DELETE",
    })
    if (res.ok) {
      setCountries(prev => prev.filter(c => c.country_code !== country_code))
      showToast("País eliminado", "success")
    } else {
      showToast("Error al eliminar", "error")
    }
    setConfirmDelete(null)
  }

  const existingCodes = new Set(countries.map(c => c.country_code))
  const availablePresets = LATAM_PRESETS.filter(p => !existingCodes.has(p.code))

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Globe className="h-6 w-6" /> Acceso por País
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Controla el acceso por país: Modo Real (iBY) y apuestas contra la Casa (por modo). Cada feature se activa de forma independiente.
        </p>
      </div>

      {/* Country list */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-4 py-2 border-b border-border bg-secondary/30 text-xs font-medium text-muted-foreground gap-4">
          <span>País</span>
          <span className="text-center">Real (iBY)</span>
          <span className="text-center">Casa Fantasy</span>
          <span className="text-center">Casa Real</span>
          <span />
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Cargando...</div>
        ) : countries.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No hay países configurados. Agregá uno abajo.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {countries.map(c => (
              <div key={c.country_code} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-4 py-3 gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{c.country_name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{c.country_code}</div>
                </div>

                {/* Real money toggle */}
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    title={c.real_money_enabled ? "Deshabilitar Modo Real" : "Habilitar Modo Real"}
                    onClick={() => toggleField(c.country_code, "real_money_enabled", c.real_money_enabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${c.real_money_enabled ? "bg-green-500" : "bg-muted"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${c.real_money_enabled ? "translate-x-4.5" : "translate-x-1"}`} />
                  </button>
                  <Badge variant="outline" className={`text-[9px] py-0 px-1 ${c.real_money_enabled ? "bg-green-500/10 text-green-500 border-green-500/30" : "bg-secondary text-muted-foreground"}`}>
                    {c.real_money_enabled ? "ON" : "OFF"}
                  </Badge>
                </div>

                {/* Casa Fantasy toggle */}
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    title={c.house_betting_fantasy_enabled ? "Deshabilitar Casa Fantasy" : "Habilitar Casa Fantasy"}
                    onClick={() => toggleField(c.country_code, "house_betting_fantasy_enabled", c.house_betting_fantasy_enabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${c.house_betting_fantasy_enabled ? "bg-yellow-500" : "bg-muted"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${c.house_betting_fantasy_enabled ? "translate-x-4.5" : "translate-x-1"}`} />
                  </button>
                  <Badge variant="outline" className={`text-[9px] py-0 px-1 ${c.house_betting_fantasy_enabled ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" : "bg-secondary text-muted-foreground"}`}>
                    {c.house_betting_fantasy_enabled ? "ON" : "OFF"}
                  </Badge>
                </div>

                {/* Casa Real toggle */}
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    title={c.house_betting_real_enabled ? "Deshabilitar Casa Real" : "Habilitar Casa Real"}
                    onClick={() => toggleField(c.country_code, "house_betting_real_enabled", c.house_betting_real_enabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${c.house_betting_real_enabled ? "bg-orange-500" : "bg-muted"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${c.house_betting_real_enabled ? "translate-x-4.5" : "translate-x-1"}`} />
                  </button>
                  <Badge variant="outline" className={`text-[9px] py-0 px-1 ${c.house_betting_real_enabled ? "bg-orange-500/10 text-orange-600 border-orange-500/30" : "bg-secondary text-muted-foreground"}`}>
                    {c.house_betting_real_enabled ? "ON" : "OFF"}
                  </Badge>
                </div>

                {/* Delete */}
                <div>
                  {confirmDelete === c.country_code ? (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => deleteCountry(c.country_code)} className="text-xs text-red-500 hover:underline">Confirmar</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="text-xs text-muted-foreground hover:underline">Cancelar</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(c.country_code)} className="text-muted-foreground hover:text-red-500 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick-add presets */}
      {availablePresets.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">Agregar rápido</div>
          <div className="flex flex-wrap gap-2">
            {availablePresets.map(p => (
              <button
                key={p.code}
                type="button"
                onClick={() => addCountry(p.code, p.name)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-secondary transition-colors"
              >
                <Plus className="h-3 w-3" /> {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual add */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="text-sm font-medium">Agregar país manualmente</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Código (= valor en profiles.country)</label>
            <Input placeholder="Venezuela" value={addingCode} onChange={e => setAddingCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nombre visible</label>
            <Input placeholder="Venezuela" value={addingName} onChange={e => setAddingName(e.target.value)} />
          </div>
        </div>
        <Button onClick={() => addCountry(addingCode, addingName)} disabled={saving || !addingCode.trim() || !addingName.trim()} size="sm">
          {saving ? "Guardando..." : "Agregar país"}
        </Button>
        <p className="text-xs text-muted-foreground">
          El código debe coincidir exactamente con el valor guardado en <code className="font-mono">profiles.country</code> al registrarse.
        </p>
      </div>
    </div>
  )
}
