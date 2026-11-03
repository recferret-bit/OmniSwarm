# Stand-in for the api and web images in the infra bring-up only
# (infra/compose/compose.stub.yml). Same base, user, exec wrapper and
# healthcheck shape as apps/api/Dockerfile, no dependencies.
FROM node:24.22.2-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY infra/test/stub/package.json infra/test/stub/api.mjs infra/test/stub/web.mjs ./
COPY --chmod=0755 infra/bin/exec-script.sh /usr/local/bin/exec-script
USER 1000:1000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + (process.env.PORT === '3000' ? '/' : '/api/health')).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["exec-script", "/app", "api"]
