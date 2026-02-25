# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY shared/ ./shared/
COPY server/ ./server/

# Build shared first, then server
RUN pnpm --filter @local-anonymizer/shared run build
RUN pnpm --filter @local-anonymizer/server run build

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist

EXPOSE 3001
ENV NODE_ENV=production

CMD ["node", "server/dist/index.js"]
