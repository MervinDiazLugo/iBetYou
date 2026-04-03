# P2P Bets - Plataforma de Apuestas Peer-to-Peer

Una plataforma moderna de apuestas deportivas P2P donde los usuarios pueden crear y aceptar apuestas directamente con otros usuarios.

## 🚀 Stack Tecnológico

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend:** Next.js API Routes
- **Base de Datos:** Supabase (PostgreSQL)
- **Autenticación:** Supabase Auth
- **UI Components:** Radix UI
- **Iconos:** Lucide React

## 📋 Requisitos Previos

- Node.js 18+
- npm o yarn
- Cuenta en Supabase
- API Key de API-Sports
- API Key de Resend (para emails)

## 🔧 Configuración Local

### 1. Clonar el repositorio
```bash
git clone https://github.com/yourusername/p2pbets.git
cd p2pbets/app
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
```bash
cp .env.example .env.local
```

Luego completa `.env.local` con tus credenciales:
- Supabase credentials
- API Keys (Football, Basketball, Baseball)
- Resend API Key
- API Security Key

### 4. Correr en desarrollo
```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

## 📁 Estructura del Proyecto

```
app/
├── api/                 # Rutas API
│   ├── admin/          # Endpoints de administración
│   ├── auth/           # Autenticación
│   ├── bets/           # Gestión de apuestas
│   ├── events/         # Gestión de eventos deportivos
│   └── wallet/         # Billetera de usuarios
├── app/                # Páginas Next.js
│   ├── backoffice/     # Panel administrativo
│   ├── bet/[id]/       # Detalle de apuesta
│   ├── create/         # Crear nueva apuesta
│   ├── login/          # Inicio de sesión
│   ├── my-bets/        # Mis apuestas
│   ├── profile/        # Perfil de usuario
│   └── register/       # Registro
├── components/         # Componentes React reutilizables
├── lib/               # Utilidades y funciones helper
├── types/             # Definiciones TypeScript
├── scripts/           # Scripts de mantenimiento
└── supabase/          # Scripts SQL y RLS
```

## 🎮 Scripts Disponibles

```bash
npm run dev      # Ejecutar servidor de desarrollo
npm run build    # Construir para producción
npm start        # Ejecutar servidor de producción
npm run lint     # Ejecutar linter
```

## 📝 Documentación

- [Reglas del Sistema de Apuestas](./docs/REGLAS_APUESTAS.md) - Lógica de negocio completa
- [Configuración de Base de Datos](./supabase/README.md) - Esquema y políticas RLS

## 🚀 Deploy en Vercel

### 1. Push a GitHub
```bash
git add .
git commit -m "Prepare for Vercel deployment"
git push origin main
```

### 2. Conectar a Vercel
- Ve a [vercel.com](https://vercel.com)
- Importa el repositorio de GitHub
- Configura las variables de entorno (igual que `.env.local`)
- Deploy

### Variables de Entorno en Vercel
Añade estas en los settings de Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_API_KEY`
- `API_FOOTBALL_KEY`
- `API_FOOTBALL_URL`
- `API_BASKETBALL_URL`
- `API_BASEBALL_URL`
- `RESEND_API_KEY`
- `RESEND_FROM`

## 🔐 Seguridad

- Las claves privadas en `.env.local` nunca se commitan (incluidas en `.gitignore`)
- Las claves públicas (`NEXT_PUBLIC_*`) se pueden exponer (son restrictas por API Key)
- No subas `.env.local` bajo ninguna circunstancia

## 🌐 API Endpoints

Ver documentación detallada en `/docs/REGLAS_APUESTAS.md` para:
- Crear apuestas
- Listar apuestas
- Aceptar apuestas
- Resolver apuestas

## 🤝 Contribuir

1. Crea una rama para tu feature: `git checkout -b feature/mi-feature`
2. Commit tus cambios: `git commit -am 'Add feature'`
3. Push a la rama: `git push origin feature/mi-feature`
4. Abre un Pull Request

## 📄 Licencia

Este proyecto es privado.
