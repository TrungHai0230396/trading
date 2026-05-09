# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────
# Tranding — production container
# ─────────────────────────────────────────────────────────────────────────
# Multi-stage build. Final image keeps the full pnpm-managed node_modules
# tree so the Prisma CLI (used at boot to apply migrations) and the native
# `mariadb` driver resolve their deps correctly. Debian slim base is used
# so the prebuilt mariadb binary loads against glibc.

ARG NODE_VERSION=22-bookworm-slim

# ─── Base ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.6.5 --activate
WORKDIR /app

# ─── Install dependencies ────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ─── Build ───────────────────────────────────────────────────────────────
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="mysql://x:x@localhost:3306/x" \
    AUTH_SECRET="build-only" \
    ENCRYPTION_KEY="build-only-build-only-build-only-build-only"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

# ─── Runtime ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.6.5 --activate && \
    apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/nextjs --shell /bin/sh nextjs

# Bring over the entire built app: source/node_modules/.next/prisma/etc.
# The full tree keeps every pnpm symlink intact so the Prisma CLI can
# resolve its bundled engine at startup.
COPY --from=builder --chown=nextjs:nodejs /app ./

COPY --chown=nextjs:nodejs docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# Bypass pnpm/corepack at runtime — invoke Next directly to avoid the cache
# directory dance for the unprivileged user.
CMD ["node", "node_modules/next/dist/bin/next", "start"]
