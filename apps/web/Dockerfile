# ANANDA web (Next.js standalone). Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @ananda/web... --filter @ananda/shared
COPY packages/shared packages/shared
COPY apps/web apps/web
# Rewrites are fixed at build time: /api/* is proxied to this address inside the Docker network.
ARG API_URL=http://api:4010
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @ananda/shared build && pnpm --filter @ananda/web build

FROM node:24-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
