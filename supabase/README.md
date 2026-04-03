# Supabase Configuration

Documentación sobre la configuración de la base de datos Supabase para P2P Bets.

## Estructura de Carpetas

- **migrations/** - Scripts de migración de esquema (crear tablas, índices, etc)
- **policies/** - Políticas de Row Level Security (RLS)

## 📊 Tablas Principales

### profiles
- Información del usuario
- Campos: id, email, nickname, avatar_url, kyc_status

### wallets
- Billetera de usuario (fantasy y real)
- Campos: id, user_id, balance_fantasy, balance_real, fantasy_total_accumulated

### events
- Eventos deportivos (fútbol, basketball, béisbol)
- Campos: id, sport, home_team, away_team, start_time, status, home_score, away_score

### bets
- Apuestas entre usuarios
- Campos: id, event_id, creator_id, acceptor_id, type, amount, multiplier, status, winner_id

## 🔐 Row Level Security (RLS)

Las políticas RLS aseguran que:
- Los usuarios solo puedan ver/editar sus propios datos
- Los admins tengan acceso completo
- Las apuestas sean protegidas según su estado

## 🚀 Setup Inicial

1. Conecta a tu proyecto Supabase
2. Ejecuta los scripts en este orden:
   - `migrations/schema.sql` - Crea las tablas
   - `policies/*.sql` - Configura RLS

## 📝 Scripts Disponibles

- `schema.sql` - DDL completo del esquema
- `schema-simple.sql` - Esquema simplificado
- `proper-rls.sql` - Políticas RLS correctas
- `fix-rls.sql` - Correcciones de RLS
- `clean-rls.sql` - Limpiar y recrear políticas

**Nota:** Usa `proper-rls.sql` o `fix-rls.sql` según sea necesario.
