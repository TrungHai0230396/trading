# Tranding — Trading Cockpit

A personal trading cockpit. Position sizing, journal, multi-timeframe scanner,
AI-summarized news and on-chain analysis — in one place.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript**
- **Tailwind CSS v4 + shadcn/ui** (base-nova / base-ui)
- **Prisma ORM + MySQL 8**
- **Auth.js v5** (credentials + JWT sessions, single-user)
- **TanStack Query** for client-side data fetching
- **Recharts / lightweight-charts** for charts
- **Google Gemini** for AI summarization & on-chain narrative

## Phases

| Phase | Scope |
|-------|-------|
| **P1 — Foundation** ✅ | Scaffold, design system, MySQL, auth, app shell, route stubs |
| **P2** | Position size calculator (live FX/crypto rates) |
| **P3** | Trading journal (CRUD, screenshots, R-multiple, stats) |
| **P4** | Multi-timeframe scanner (RSI/EMA/MACD, alignment scoring) |
| **P5** | News + AI (CryptoPanic + Gemini) |
| **P6** | On-chain analysis (ETH + BSC + DefiLlama + Gemini) |
| **P7** | Dashboard wired to real data |

## Local setup

```bash
# 1. Install deps (pnpm 10+ recommended)
pnpm install

# 2. Spin up MySQL
docker compose up -d

# 3. Configure env
cp .env.example .env
# then fill in AUTH_SECRET and ENCRYPTION_KEY:
#   openssl rand -base64 32   # AUTH_SECRET
#   openssl rand -hex 32      # ENCRYPTION_KEY

# 4. Apply schema
pnpm prisma migrate dev --name init

# 5. Run
pnpm dev
```

Visit <http://localhost:3000>. The first request redirects to `/register`
(allowed once `ALLOW_REGISTRATION=true`). After registering, set
`ALLOW_REGISTRATION=false` in `.env` to lock down the app.

## Useful scripts

```bash
pnpm dev                    # Next dev server (Turbopack)
pnpm build                  # Production build
pnpm prisma studio          # GUI for the database
pnpm prisma migrate dev     # Apply schema changes
pnpm prisma generate        # Regenerate the Prisma Client
```

## Project layout

```
src/
  app/
    (app)/             # Authenticated app shell + routes
    (auth)/            # Login + register
    api/               # Route handlers (auth, register, ...)
  components/
    ui/                # shadcn primitives
    app-sidebar.tsx    # Main nav
    topbar.tsx         # In-app header
    providers.tsx      # Session, theme, query, tooltip
  lib/
    auth.ts            # Auth.js v5 config
    db.ts              # Prisma client singleton
    crypto.ts          # AES-256-GCM for API key storage
    nav.ts             # Sidebar nav definition
  generated/prisma/    # Prisma Client (gitignored)
prisma/
  schema.prisma
```

## Design system at a glance

- **Theme**: dark by default; toggle from the topbar.
- **Brand**: emerald (`oklch(0.62 0.16 159)` light / `0.78 0.17 159` dark).
- **Semantic tokens**: `bullish`, `bearish`, `warning`, `info` — use as
  Tailwind utilities (`bg-bullish`, `text-bearish`, etc.). Defined in
  `src/app/globals.css`.
- **Type**: Inter for UI, JetBrains Mono for prices/numbers
  (`.num` utility enables `tabular-nums`).
- **Components**: extend shadcn primitives in `src/components/ui/`. Add new
  ones with `pnpm dlx shadcn@latest add <component>`.
