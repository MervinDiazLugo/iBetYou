# Checklist para Deployment

## ✅ Antes de hacer commit a GitHub

- [ ] `.env.local` NO está committeado (revisa .gitignore)
- [ ] Correr `npm run build` exitosamente
- [ ] Correr `npm run lint` sin errores
- [ ] Las dependencias están up to date: `npm install`
- [ ] El proyecto funciona localmente: `npm run dev`

## ✅ Pasos para Push a GitHub

```bash
# 1. Ver qué cambios hay
git status

# 2. Verificar que .env.local NO está en la lista
git status | grep ".env.local"
# (NO debería mostrar nada)

# 3. Añadir cambios
git add .

# 4. Commit
git commit -m "Descripción del cambio"

# 5. Push
git push origin main
```

## ✅ Setup en Vercel

### 1. Conectar repositorio
- Ve a [vercel.com/new](https://vercel.com/new)
- Conecta tu cuenta de GitHub
- Selecciona el repositorio `p2pbets`
- Click en "Import"

### 2. Configurar variables de entorno
En "Environment Variables", añade:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_APP_API_KEY=your_key
API_FOOTBALL_KEY=your_key
API_FOOTBALL_URL=https://v3.football.api-sports.io
API_BASKETBALL_URL=https://v3.basketball.api-sports.io
API_BASEBALL_URL=https://v1.baseball.api-sports.io
RESEND_API_KEY=re_xxx
RESEND_FROM=noreply@yourdomain.com
```

### 3. Selecciona el root del proyecto
- Root Directory: `app/` (porque el código está dentro de app/)

### 4. Deploy
- Click en "Deploy"
- Espera a que termine (2-5 minutos)
- Tu sitio estará disponible en `https://yourdomain.vercel.app`

## ✅ Después del primer deployment

- [ ] Verifica que el sitio funciona
- [ ] Prueba login/registro
- [ ] Verifica que se cargan los eventos
- [ ] Prueba crear una apuesta

## ✅ Auto-deployment

Una vez configurado:
- Cada push a `main` dispara automáticamente un deployment
- Los cambios van en vivo en minutos
- Vercel crea previsualizaciones automáticas para PRs

## 🆘 Troubleshooting

### "Build error: NEXT_PUBLIC_SUPABASE_URL is not defined"
- Verifica que las variables estén en Vercel settings
- Espera 5 minutos y reintentar

### "Cannot read properties of undefined (reading 'eq')"
- Probablemente SUPABASE_SERVICE_ROLE_KEY falta
- Verifica en Vercel settings

### El sitio funciona pero se ve roto
- Limpia la caché del navegador: Ctrl+Shift+Del
- Verifica los estilos de Tailwind en la consola

## 📚 Documentación

- [Deploy Guide - Vercel](https://vercel.com/docs/concepts/git)
- [GitHub + Vercel Integration](https://vercel.com/docs/concepts/git/github)
