# Builds the web SPA to static files and publishes them into the shared web_dist
# volume that Caddy serves. Build context = repo root (monorepo workspace).
# VITE_API_BASE_URL is baked at build time, so it comes in as a build arg.
FROM oven/bun:1.3-slim AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/contracts/package.json   packages/contracts/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/domain/package.json      packages/domain/package.json
COPY apps/web/package.json             apps/web/package.json
COPY services/api/package.json         services/api/package.json
RUN bun install --frozen-lockfile
COPY packages ./packages
COPY apps/web ./apps/web
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN bun run --filter '@ipc/web' build

# One-shot publisher: copy the built assets into the mounted volume, then exit.
FROM busybox:1.36
COPY --from=build /app/apps/web/dist /dist
CMD ["sh", "-c", "rm -rf /out/* && cp -a /dist/. /out/ && echo 'web assets published to volume'"]
