# 📁 Estructura Detallada del Proyecto

```
p2pbets/
│
├── app/                          # Raíz del proyecto Next.js
│   │
│   ├── 📄 Archivos de configuración
│   ├── package.json             # Dependencias
│   ├── tsconfig.json            # Configuración TypeScript
│   ├── next.config.ts           # Configuración Next.js
│   ├── eslint.config.mjs        # Configuración ESLint
│   ├── postcss.config.mjs       # Configuración PostCSS
│   ├── tailwind.config.ts       # Configuración Tailwind CSS
│   │
│   ├── 🔐 Archivos de seguridad
│   ├── .env.example             # Template de variables de entorno
│   ├── .env.local               # Variables de entorno (local, NO do commit)
│   ├── .gitignore               # Archivos a ignorar por Git
│   │
│   ├── 📚 Documentación
│   ├── README.md                # README principal
│   ├── SETUP.md                 # Guía de setup para nuevos devs
│   ├── DEPLOYMENT.md            # Instrucciones de deployment
│   ├── SECURITY.md              # Checklist de seguridad
│   │
│   ├── 🌐 Next.js App
│   ├── app/                     # App Router (Next.js 13+)
│   │   ├── layout.tsx           # Layout raíz
│   │   ├── page.tsx             # Home page
│   │   ├── globals.css          # Estilos globales
│   │   │
│   │   ├── api/                 # API Routes
│   │   │   ├── admin/           # Endpoints admin
│   │   │   │   ├── bets/route.ts
│   │   │   │   ├── events/route.ts
│   │   │   │   └── wallets/route.ts
│   │   │   │
│   │   │   ├── auth/            # Autenticación
│   │   │   │   └── callback/route.ts
│   │   │   │
│   │   │   ├── bets/            # Gestión de apuestas
│   │   │   │   ├── route.ts
│   │   │   │   └── [id]/route.ts
│   │   │   │
│   │   │   ├── events/          # Eventos deportivos
│   │   │   │   ├── route.ts
│   │   │   │   ├── list/route.ts
│   │   │   │   ├── seed/route.ts
│   │   │   │   └── sync/route.ts
│   │   │   │
│   │   │   ├── my-bets/route.ts
│   │   │   ├── user/route.ts
│   │   │   ├── wallet/route.ts
│   │   │   └── cleanup/route.ts
│   │   │
│   │   ├── backoffice/          # Admin dashboard
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── bets/page.tsx
│   │   │   ├── events/page.tsx
│   │   │   └── wallets/page.tsx
│   │   │
│   │   ├── bet/[id]/            # Detalle de apuesta
│   │   │   └── page.tsx
│   │   │
│   │   ├── create/              # Crear apuesta
│   │   │   └── page.tsx
│   │   │
│   │   ├── login/               # Login
│   │   │   └── page.tsx
│   │   │
│   │   ├── my-bets/             # Mis apuestas
│   │   │   ├── hooks.ts
│   │   │   └── page.tsx
│   │   │
│   │   ├── profile/             # Perfil de usuario
│   │   │   └── page.tsx
│   │   │
│   │   └── register/            # Registro
│   │       └── page.tsx
│   │
│   ├── 🧩 Components
│   ├── components/
│   │   ├── navbar.tsx           # Barra de navegación
│   │   ├── providers.tsx        # Providers (Auth, Toast)
│   │   ├── toast.tsx            # Sistema de notificaciones
│   │   ├── countdown.tsx        # Countdown timer
│   │   ├── create-bet-form.tsx  # Formulario de crear apuesta
│   │   │
│   │   └── ui/                  # Componentes de UI
│   │       ├── badge.tsx
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── dialog.tsx
│   │       └── input.tsx
│   │
│   ├── 📦 Bibliotecas y Utilidades
│   ├── lib/
│   │   ├── api-auth.ts          # Autenticación en API
│   │   ├── supabase.ts          # Clientes de Supabase
│   │   └── utils.ts             # Funciones auxiliares
│   │
│   ├── 🏷️ Types
│   ├── types/
│   │   └── index.ts             # Definiciones TypeScript
│   │
│   ├── 🔧 Scripts
│   ├── scripts/
│   │   └── sync-events.ts       # Script para sincronizar eventos
│   │
│   ├── 🗄️ Database
│   ├── supabase/
│   │   ├── README.md            # Documentación Supabase
│   │   │
│   │   ├── migrations/          # Scripts de migración
│   │   │   └── schema.sql
│   │   │
│   │   ├── policies/            # Políticas RLS
│   │   │   └── proper-rls.sql
│   │   │
│   │   ├── schema.sql           # Esquema completo
│   │   └── ... (otros scripts SQL)
│   │
│   ├── 📚 Public
│   ├── public/                  # Archivos estáticos
│   │
│   ├── 📖 Documentación
│   ├── docs/
│   │   └── REGLAS_APUESTAS.md   # Reglas del sistema de apuestas
│   │
│   ├── 🔍 Otros
│   ├── middleware.ts            # Middleware de Next.js
│   ├── check.ts                 # Script de verificación
│   ├── cleanup.ts               # Script de limpieza
│   └── next-env.d.ts            # Tipos generados por Next.js
│
└── .git/                         # Repositorio Git
```

## 🗺️ Archivos Importantes por Función

### Setup y Configuración
- `.env.example` - Template de variables
- `.env.local` - Variables locales (NO commitear)
- `package.json` - Dependencias
- `tsconfig.json` - TypeScript

### Documentación
- `README.md` - README principal
- `SETUP.md` - Setup para nuevos devs
- `DEPLOYMENT.md` - Instrucciones de deploy
- `SECURITY.md` - Checklist de seguridad
- `docs/REGLAS_APUESTAS.md` - Reglas de negocio

### Base de Datos
- `supabase/schema.sql` - DDL de tablas
- `supabase/migrations/` - Scripts de migración
- `supabase/policies/` - Políticas RLS

### Código Fuente
- `app/page.tsx` - Home page
- `app/api/` - API endpoints
- `components/` - Componentes React
- `lib/` - Funciones auxiliares
- `types/` - Definiciones TypeScript

### Desarrollo
- `eslint.config.mjs` - Linting
- `middleware.ts` - Middleware
- `check.ts` - Checks del proyecto
- `scripts/` - Scripts de utilidad
