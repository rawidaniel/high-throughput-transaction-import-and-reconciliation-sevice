# syntax=docker/dockerfile:1

# Stage 1 — dependencies
FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma


RUN npm ci

# Stage 2 — build
FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package*.json ./
COPY tsconfig*.json nest-cli.json prisma.config.ts ./ 
COPY src ./src

RUN npx prisma generate
RUN npm run build

RUN npm prune --omit=dev

# Stage 3 — runtime
FROM node:22-alpine AS runtime

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./ 
COPY --from=build --chown=node:node /app/generated ./generated
COPY --from=build --chown=node:node /app/package*.json ./
COPY --chown=node:node scripts ./scripts

RUN mkdir -p /app/storage/uploads && chown -R node:node /app/storage

USER node

EXPOSE 3000 3001

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/main"]
