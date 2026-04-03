# Checklist de Seguridad

Antes de hacer deployment, verifica estos puntos.

## 🔐 Variables de Entorno

- [ ] `.env.local` está en `.gitignore`
- [ ] `.env.local` NO está trackeado por git
- [ ] `.env.example` existe y está trackeado
- [ ] `.env.example` tiene placeholders (no valores reales)
- [ ] Vercel tiene TODAS las variables de entorno configuradas
- [ ] SUPABASE_SERVICE_ROLE_KEY solo existe en Vercel, NO localmente en .env.example

Verificar:
```bash
git check-ignore .env.local
# Debería mostrar: .env.local

git ls-files | grep .env
# Debería mostrar solo: .env.example
```

## 🔑 Credenciales API

- [ ] API_FOOTBALL_KEY está oculta y no es la KEY de test
- [ ] SUPABASE_SERVICE_ROLE_KEY nunca está en repos públicos
- [ ] RESEND_API_KEY está configurada y activa
- [ ] NEXT_PUBLIC_SUPABASE_ANON_KEY es la ANON key, no la SERVICE key

## 🗄️ Base de Datos

- [ ] RLS (Row Level Security) está habilitado en Supabase
- [ ] Las políticas de RLS están configuradas correctamente
- [ ] No hay datos de prueba sensibles en producción
- [ ] Los backups automáticos están habilitados

Verificar en Supabase:
- Settings → Database → RLS should be ON for all tables
- Auth → Policies section has all policies applied

## 🌍 Vercel

- [ ] Project name no contiene información sensible
- [ ] Environment variables están marcadas como "sensitive" donde corresponda
- [ ] No hay secrets en el código (busca hardcoded URLs/keys)
- [ ] Preview deployments están habilitadas para testing

## 📝 Código

```bash
# Buscar por valores hardcodeados
grep -r "api_key=" app/
grep -r "NEXT_PUBLIC_SUPABASE_URL=" app/
grep -r "supabase.co" app/
# Debería estar vacío o solo mostrar archivos de config

# Buscar por console.log en archivos de producción
grep -r "console.log" app/api/
# Considerar remover logs innecesarios
```

- [ ] No hay `console.log` innecesarios en API routes
- [ ] No hay comentarios con información sensible
- [ ] Los errores se loguean pero no exponen detalles internos

## 🚀 Deployment

- [ ] El build local funciona: `npm run build`
- [ ] El linter pasa: `npm run lint`
- [ ] Todos los tests pasan (si los hay)
- [ ] Las dependencias están actualizadas: `npm audit`

## ✨ Después del Deployment

- [ ] Accede al sitio en producción
- [ ] Prueba el flujo: register → login → crear apuesta
- [ ] Verifica que los eventos se cargan desde la API
- [ ] Revisa los logs en Vercel por errores
- [ ] Prueba desde diferentes navegadores

## 📊 Monitoreo Continuo

- [ ] Monitorea los logs de Vercel regularmente
- [ ] Configura alertas para errores en Vercel
- [ ] Revisa Supabase Database para queries lentas
- [ ] Mantén actualizado: `npm update` regularmente

## 🆘 En caso de incidente

- [ ] Revierte el deployment en Vercel (Deployments → Rollback)
- [ ] Verifica los logs para entender el error
- [ ] Nunca commits credenciales incluso si las expones accidentalmente (rotatlas en los servicios)
