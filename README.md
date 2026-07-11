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
| **P3** | Trading journal (CRUD, screenshots upload/paste, captions/kind, fullscreen preview) |
| **P4** | Multi-timeframe scanner (RSI(14) + EMA(9)/WMA(45) on RSI, alignment scoring, Top 10 consensus) |
| **P5** | News + AI (CryptoPanic + Gemini) |
| **P6** | On-chain analysis (ETH + BSC + DefiLlama + Gemini) |
| **P7** | Dashboard wired to real data |

## Run it (Docker — recommended)

The whole stack — Next.js app + MySQL — comes up with one command. The
app container runs `prisma migrate deploy` on boot, so first launch
creates the schema for you.

```bash
# 1. Configure env (only needed once)
cp .env.example .env
#   openssl rand -base64 32   # paste into AUTH_SECRET
#   openssl rand -hex 32      # paste into ENCRYPTION_KEY

# 2. Build images + start everything
docker compose up -d --build
```

Visit <http://localhost:3000>. The first request redirects to `/register`
(allowed while `ALLOW_REGISTRATION=true`). After registering, set
`ALLOW_REGISTRATION=false` in `.env` and `docker compose restart app`.

```bash
docker compose logs -f app   # tail the app
docker compose ps            # see service health
docker compose stop          # pause everything (data preserved)
docker compose start         # resume
docker compose down -v       # nuke containers + DB volume (DESTRUCTIVE)
```

## Backup & restore

The `db-backup` sidecar writes a nightly `mysqldump` to `./backups/`
(kept `DB_BACKUP_KEEP_DAYS` days). To RESTORE one:

```bash
# 1. Stop the app so crons + the live Prisma client aren't writing
#    mid-restore (or restart it with CRON_DISABLED=true in .env):
docker compose stop app

# 2. Pipe the dump into the running mysql container (the dump omits
#    --databases, so the target schema must be named):
gunzip < backups/tranding-YYYYMMDD-HHMMSS.sql.gz \
  | docker exec -i tranding-mysql \
      mysql -u root -p"$MYSQL_ROOT_PASSWORD" tranding

# 3. Start the app — its entrypoint runs `prisma migrate deploy`, which
#    re-applies any migrations newer than the dump:
docker compose start app
```

Rehearse this once against a scratch database BEFORE you need it in
anger. Keep an offsite copy of `./backups` AND of `ENCRYPTION_KEY` —
without the key, restored broker credentials are unreadable.

## Run it (host pnpm dev)

Useful for fast iteration with HMR. The app talks to the dockerized
MySQL.

```bash
pnpm install
docker compose up -d mysql            # MySQL only
pnpm prisma migrate dev --name init   # first time only
pnpm dev
```

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
