# Setup para Nuevos Desarrolladores

## 1️⃣ Setup Inicial del Proyecto

```bash
# Clonar el repositorio
git clone https://github.com/yourusername/p2pbets.git
cd p2pbets/app

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env.local
# Edita .env.local con tus credenciales
```

## 2️⃣ Configuración de Supabase

### Crear proyecto en Supabase
1. Ve a [supabase.com](https://supabase.com)
2. Crea un nuevo proyecto
3. Espera a que esté listo

### Obtener credenciales
- URL del proyecto: Settings → API → Project URL
- Anon Key: Settings → API → Project API keys (Anon)
- Service Role Key: Settings → API → Project API keys (Service Role)

Actualiza `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Ejecutar migraciones
1. Ve al SQL Editor en Supabase
2. Ejecuta los scripts en orden:
   - `supabase/migrations/schema.sql` - Crear esquema
   - `supabase/policies/proper-rls.sql` - Configurar RLS

## 3️⃣ Configuración de API Keys

### API Sports (eventos deportivos)
1. Ve a [api-sports.io](https://api-sports.io)
2. Regístrate y obtén una API key
3. Actualiza `.env.local`:
```env
API_FOOTBALL_KEY=your_key_here
```

### Resend (emails)
1. Ve a [resend.com](https://resend.com)
2. Crea una cuenta
3. Obtén tu API key
4. Actualiza `.env.local`:
```env
RESEND_API_KEY=re_xxx
RESEND_FROM=noreply@yourdomain.com
```

## 4️⃣ Ejecutar el Proyecto

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000)

## 📝 Notas Importantes

- **NUNCA** commits `.env.local` (está en .gitignore)
- Usa `.env.example` como referencia de variables
- En development, puedes usar valores de test
- En production (Vercel), configura las variables en los settings del proyecto

## 🆘 Troubleshooting

### "NEXT_PUBLIC_SUPABASE_URL not found"
- Verifica que `.env.local` exista
- Reinicia el servidor: `ctrl+c` y `npm run dev`

### Error de autenticación en Supabase
- Verifica que ANON_KEY sea correcta (no SERVICE_ROLE_KEY)
- Asegúrate de que RLS esté configurado correctamente

### Eventos no se cargan
- Verifica que API_FOOTBALL_KEY sea válida
- Revisa la consola del navegador para ver qué error devuelve la API

## 🚀 Próximos Pasos

1. Familiarízate con [REGLAS_APUESTAS.md](../../docs/REGLAS_APUESTAS.md)
2. Entiende la estructura del proyecto en [README.md](../../README.md)
3. Revisa el código en `app/api/` para ver cómo funcionan los endpoints
