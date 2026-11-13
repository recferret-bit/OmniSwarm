# @omniswarm/api image: the HTTP API and the one-shot migration runner.
# Build context is the repository root (npm workspaces need the root lockfile):
#   docker build -f apps/api/Dockerfile .
# The allow-list in apps/api/Dockerfile.dockerignore keeps engine/, bin/,
# reports/, tests and every .env out of the context.
# The review worker does NOT run from this image: it spawns ./bin/audit and the
# Docker sandbox, so it runs as a systemd unit on the host (infra/systemd/).

FROM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS deps
WORKDIR /app
# Every workspace manifest is copied so `npm ci` sees the tree the lockfile describes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/schemas/package.json packages/schemas/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace @omniswarm/api \
 && npm cache clean --force

FROM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS runtime
# production (default) refuses every test adapter. The local stack builds with
# --build-arg NODE_ENV=development and names KEY_VERIFIER=mock and GITHUB_ADAPTER=live
# explicitly, so API, migrate and the host worker all use the same adapters.
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV} \
    HOST=0.0.0.0 \
    PORT=8787 \
    npm_config_update_notifier=false
WORKDIR /app
# Everything stays root-owned and read-only for the runtime user.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/schemas ./packages/schemas
COPY apps/api ./apps/api
COPY --chmod=0755 infra/bin/exec-script.sh /usr/local/bin/exec-script
USER 1000:1000
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# `npm start -w @omniswarm/api`, exec'd so node receives SIGTERM itself.
# The compose `migrate` service runs `exec-script apps/api db:migrate` instead.
CMD ["exec-script", "apps/api", "start"]
