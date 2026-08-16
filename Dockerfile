# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Builder - installs all dependencies and compiles the workspace.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

# Manifests first: this layer is cached until dependencies actually change,
# so source edits do not trigger a reinstall.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/api/package.json packages/api/

RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/api packages/api

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime - production dependencies and compiled output only.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime

# Signals, not a shell, as PID 1: without this the container ignores SIGTERM
# and every deploy waits for the platform's kill timeout instead of draining.
RUN apk add --no-cache tini

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/api/package.json packages/api/

RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/packages/contracts/dist packages/contracts/dist
COPY --from=builder /app/packages/api/dist packages/api/dist
# Migrations ship with the image so the deploy applies exactly the set that
# was built and tested (2.15).
COPY --from=builder /app/packages/api/drizzle packages/api/drizzle

# Safe default. Note that until P8.6 lands the application will deliberately
# refuse to start with NODE_ENV=production, because dev auth is the only auth
# available - see config/auth-mode.ts. A private staging environment must set
# NODE_ENV=development explicitly and be network-restricted.
ENV NODE_ENV=production
ENV PORT=3000

USER node
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/api/dist/main.js"]
