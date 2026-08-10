# Bun image for the IPC API. Build context is the REPO ROOT (monorepo), not
# services/api — the API imports workspace packages (@ipc/contracts etc.).
#
#   docker build -f services/api/Dockerfile -t ipc-api .
#
# Bun runs TypeScript directly, so there's no compile step — the runtime stage
# just needs node_modules + the source.

# ── deps: install the workspace (cached on manifest changes) ──
FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/contracts/package.json   packages/contracts/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/domain/package.json      packages/domain/package.json
COPY services/api/package.json         services/api/package.json
COPY apps/web/package.json             apps/web/package.json
# --production drops devDeps (wrangler, vitest, vite, workers-types); the API
# runtime needs only hono + supabase-js. --frozen-lockfile pins bun.lock.
RUN bun install --frozen-lockfile --production

# ── runtime: source + node_modules, run under the unprivileged bun user ──
FROM oven/bun:1.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages ./packages
COPY services/api ./services/api
EXPOSE 8787
USER bun
CMD ["bun", "run", "services/api/src/server.ts"]
