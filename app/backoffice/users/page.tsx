"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Users, ShieldCheck, Ban, Clock, Search, UserPlus, AlertTriangle } from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase"

interface AdminUser {
  id: string
  nickname: string
  avatar_url?: string | null
  role: "app_user" | "backoffice_admin"
  is_banned: boolean
  betting_blocked_until?: string | null
  false_claim_count?: number | null
  created_at: string
}

export default function BackofficeUsersPage() {
  const supabase = createBrowserSupabaseClient()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [roleFilter, setRoleFilter] = useState<"all" | "app_user" | "backoffice_admin">("all")
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [showCreateAdmin, setShowCreateAdmin] = useState(false)
  const [newAdminEmail, setNewAdminEmail] = useState("")
  const [newAdminPassword, setNewAdminPassword] = useState("")
  const [newAdminNickname, setNewAdminNickname] = useState("")
  const [createAdminError, setCreateAdminError] = useState("")
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)

  async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) {
      headers.set("Authorization", `Bearer ${session.access_token}`)
    }

    return fetch(input, {
      ...init,
      headers,
    })
  }

  async function fetchUsers() {
    setLoading(true)
    try {
      const roleParam = roleFilter === "all" ? "" : `?role=${roleFilter}`
      const res = await authFetch(`/api/admin/users${roleParam}`)
      const data = await res.json()
      setUsers(data.users || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [roleFilter])

  async function runAction(payload: Record<string, unknown>, userId?: string) {
    setActionLoadingId(userId || "promote")
    try {
      const res = await authFetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || "No se pudo completar la acción")
        return
      }
      fetchUsers()
    } finally {
      setActionLoadingId(null)
    }
  }

  const filtered = users.filter((u) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return u.nickname.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)
  })

  const totalApp = users.filter((u) => u.role === "app_user").length
  const totalBackoffice = users.filter((u) => u.role === "backoffice_admin").length
  const totalBanned = users.filter((u) => u.is_banned).length
  const totalBlocked = users.filter((u) => u.betting_blocked_until && new Date(u.betting_blocked_until) > new Date()).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Administra cuentas de la app y del backoffice</p>
        </div>
        <Button
          size="sm"
          onClick={() => { setShowCreateAdmin((v) => !v); setCreateAdminError("") }}
          className="gap-2"
        >
          <UserPlus className="w-4 h-4" />
          Nuevo admin
        </Button>
      </div>

      {/* Create admin modal */}
      {showCreateAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-base">Crear cuenta de administrador</p>
                <p className="text-xs text-muted-foreground mt-0.5">Se creará una cuenta nueva exclusiva para el backoffice.</p>
              </div>
              <button
                onClick={() => { setShowCreateAdmin(false); setCreateAdminError("") }}
                className="text-muted-foreground hover:text-foreground transition-colors ml-4 mt-0.5"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <Input
                  placeholder="admin@ibetyou.com"
                  type="email"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Contraseña</label>
                <Input
                  placeholder="Mínimo 8 caracteres"
                  type="password"
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Nickname <span className="text-muted-foreground font-normal">(opcional)</span></label>
                <Input
                  placeholder="ej. TheAdmin2"
                  value={newAdminNickname}
                  onChange={(e) => setNewAdminNickname(e.target.value)}
                />
              </div>
            </div>

            {createAdminError && (
              <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{createAdminError}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => { setShowCreateAdmin(false); setCreateAdminError("") }}>
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={!newAdminEmail || !newAdminPassword || actionLoadingId === "create_admin"}
                onClick={async () => {
                  setActionLoadingId("create_admin")
                  setCreateAdminError("")
                  try {
                    const res = await authFetch("/api/admin/users", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "create_admin",
                        email: newAdminEmail,
                        password: newAdminPassword,
                        nickname: newAdminNickname || undefined,
                      }),
                    })
                    const data = await res.json()
                    if (!res.ok) { setCreateAdminError(data.error || "Error al crear admin"); return }
                    setNewAdminEmail(""); setNewAdminPassword(""); setNewAdminNickname("")
                    setShowCreateAdmin(false)
                    fetchUsers()
                  } finally {
                    setActionLoadingId(null)
                  }
                }}
              >
                {actionLoadingId === "create_admin" ? "Creando..." : "Crear admin"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Usuarios app", value: totalApp, icon: Users, color: "text-blue-500" },
          { label: "Backoffice", value: totalBackoffice, icon: ShieldCheck, color: "text-emerald-500" },
          { label: "Baneados", value: totalBanned, icon: Ban, color: "text-red-500" },
          { label: "Bloqueados apuesta", value: totalBlocked, icon: Clock, color: "text-amber-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3 flex items-center gap-3">
            <Icon className={`w-5 h-5 shrink-0 ${color}`} />
            <div>
              <div className="text-xl font-bold leading-none">{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8"
            placeholder="Buscar por nickname o ID..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="flex rounded-lg border overflow-hidden shrink-0">
          {(["all", "app_user", "backoffice_admin"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setRoleFilter(v)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                roleFilter === v
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted text-muted-foreground"
              }`}
            >
              {v === "all" ? "Todos" : v === "app_user" ? "App" : "Backoffice"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Usuario</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">ID</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Rol</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Estado</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Registro</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-muted-foreground">
                  Cargando usuarios...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-muted-foreground">
                  No hay usuarios que coincidan.
                </td>
              </tr>
            ) : (
              filtered.map((user, i) => {
                const isBlocked =
                  user.betting_blocked_until && new Date(user.betting_blocked_until) > new Date()
                const isLoading = actionLoadingId === user.id
                return (
                  <tr
                    key={user.id}
                    className={`border-b last:border-0 transition-colors hover:bg-muted/30 ${
                      i % 2 === 0 ? "" : "bg-muted/10"
                    }`}
                  >
                    {/* Nickname */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {user.nickname?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <span className="font-medium">{user.nickname}</span>
                      </div>
                    </td>

                    {/* ID */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="font-mono text-xs text-muted-foreground">{user.id.slice(0, 8)}…</span>
                    </td>

                    {/* Rol */}
                    <td className="px-4 py-3">
                      {user.role === "backoffice_admin" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-400">
                          <ShieldCheck className="w-3 h-3" /> Backoffice
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-400">
                          <Users className="w-3 h-3" /> App
                        </span>
                      )}
                    </td>

                    {/* Estado */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1 items-center">
                        {user.is_banned && (
                          <Badge variant="destructive" className="text-xs">Baneado</Badge>
                        )}
                        {isBlocked && (
                          <span
                            title={`Bloqueado hasta ${new Date(user.betting_blocked_until!).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400 cursor-help"
                          >
                            <Clock className="w-3 h-3" />
                            Bloq. temp.
                          </span>
                        )}
                        {(user.false_claim_count ?? 0) > 0 && !isBlocked && (
                          <span
                            title={`${user.false_claim_count} amonestación${(user.false_claim_count ?? 0) > 1 ? "es" : ""} acumulada${(user.false_claim_count ?? 0) > 1 ? "s" : ""}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5 dark:bg-orange-950 dark:border-orange-800 dark:text-orange-400 cursor-help"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {user.false_claim_count} amon.
                          </span>
                        )}
                        {!user.is_banned && !isBlocked && !(user.false_claim_count ?? 0) && (
                          <span className="text-xs text-muted-foreground">Activo</span>
                        )}
                      </div>
                    </td>

                    {/* Registro */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {new Date(user.created_at).toLocaleDateString("es-ES", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {user.role === "app_user" && !user.is_banned && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs px-2"
                            onClick={() => setBanTarget(user)}
                            disabled={isLoading}
                          >
                            Banear
                          </Button>
                        )}
                        {user.role === "app_user" && user.is_banned && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2 border-green-400 text-green-600 hover:bg-green-50"
                            onClick={() => runAction({ action: "unban", user_id: user.id }, user.id)}
                            disabled={isLoading}
                          >
                            Desbanear
                          </Button>
                        )}
                        {user.role === "backoffice_admin" && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs px-2"
                            onClick={() => setDeleteTarget(user)}
                            disabled={isLoading}
                          >
                            Eliminar
                          </Button>
                        )}
                        {isLoading && (
                          <span className="text-xs text-muted-foreground animate-pulse ml-1">...</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {filtered.length} de {users.length} usuarios
        </p>
      )}

      {/* Delete admin confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border rounded-xl shadow-xl w-[min(92vw,26rem)] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center shrink-0">
                <Ban className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold">¿Eliminar a {deleteTarget.nickname}?</p>
                <p className="text-sm text-muted-foreground">Se eliminará la cuenta de backoffice permanentemente.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={actionLoadingId === deleteTarget.id}
                onClick={() => {
                  runAction({ action: "delete", user_id: deleteTarget.id }, deleteTarget.id)
                  setDeleteTarget(null)
                }}
              >
                Confirmar eliminación
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Ban confirmation modal */}
      {banTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border rounded-xl shadow-xl w-[min(92vw,26rem)] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center shrink-0">
                <Ban className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold">¿Banear a {banTarget.nickname}?</p>
                <p className="text-sm text-muted-foreground">Esta acción bloqueará el acceso del usuario a la plataforma.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setBanTarget(null)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={actionLoadingId === banTarget.id}
                onClick={() => {
                  runAction({ action: "ban", user_id: banTarget.id }, banTarget.id)
                  setBanTarget(null)
                }}
              >
                {actionLoadingId === banTarget.id ? "Procesando..." : "Confirmar baneo"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
