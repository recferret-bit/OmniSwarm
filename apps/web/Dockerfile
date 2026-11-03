# @omniswarm/web image: the Next.js app built with `output: 'standalone'`.
# Build context is the repository root:
#   docker build -f apps/web/Dockerfile .
#
# Layout assumption (checked by the build step below): in this npm-workspaces
# monorepo Next traces from the repository root (the root package-lock.json,
# or `outputFileTracingRoot` set to it), so the standalone server lands at
# .next/standalone/apps/web/server.js. If the web package changes that, the
# `test -f` fails the build instead of shipping an image that cannot start.

FROM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/schemas/package.json packages/schemas/
COPY packages/guard/package.json packages/guard/
RUN npm ci --ignore-scripts --no-audit --no-fund --workspace @omniswarm/web \
 && npm cache clean --force

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages/schemas ./packages/schemas
COPY apps/web ./apps/web
RUN npm run build --workspace @omniswarm/web \
 && test -f apps/web/.next/standalone/apps/web/server.js \
 && mkdir -p apps/web/public

FROM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
