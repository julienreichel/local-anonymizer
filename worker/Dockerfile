# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY worker/package.json ./worker/

RUN pnpm install --frozen-lockfile

COPY shared/ ./shared/
COPY worker/ ./worker/

RUN pnpm --filter @local-anonymizer/shared run build
RUN pnpm --filter @local-anonymizer/worker run build

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY worker/package.json ./worker/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/worker/dist ./worker/dist

# Create uploads directory (will be overridden by volume mount)
RUN mkdir -p /uploads

ENV NODE_ENV=production
ENV UPLOADS_DIR=/uploads

CMD ["node", "worker/dist/index.js"]
