# syntax=docker/dockerfile:1
#
# Toolchain split mirrors D-09: bun installs, Node runs.
#
#   deps       bun install (frozen lockfile)
#   build      npm run build (tsc), needs Node's decorator metadata emit
#   prod-deps  bun install --production, for the runtime node_modules
#   dev        used by compose.yaml; bun + hot reload over a bind mount
#   runtime    the published image — last stage, so a plain
#              `docker build` (no --target) produces this one
#
# linux/amd64 only for now [Decided by spec author]; arm64 needs QEMU/buildx
# on the CI agent and is an open question.

FROM oven/bun:1.4.0 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM oven/bun:1.4.0 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

FROM node:24-bookworm-slim AS dev
WORKDIR /app
COPY --from=oven/bun:1.4.0 /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# compose.yaml bind-mounts the repository over this image and puts an
# anonymous volume over ./node_modules, so the container's own install here
# (not the host's) is what survives at runtime.
#
# node's uid is 1000, matching a typical single-user Linux host — running as
# root here would leave build output (dist/, written through the bind mount)
# owned by root on the host, unwritable by the same host user afterwards.
USER node
CMD ["bun", "run", "dev"]

FROM node:24-bookworm-slim AS runtime
ARG VERSION=0.0.0-dev
LABEL org.opencontainers.image.source="https://github.com/AndreyBegma/smart-glitchtip-mcp" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}"
WORKDIR /app
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json LICENSE ./
USER node
EXPOSE 8080
# No curl in this image: the healthcheck is a Node script against the
# unauthenticated /healthz route.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||8080)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "dist/main.js"]
