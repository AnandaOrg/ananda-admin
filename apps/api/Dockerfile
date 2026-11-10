# ANANDA API (NestJS). Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @ananda/api... --filter @ananda/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @ananda/shared build && pnpm --filter @ananda/api build

FROM node:24-alpine
# Vercel container services receive traffic on port 80; docker-compose sets PORT=4010.
ENV NODE_ENV=production PORT=80
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/apps/api/uploads && chown -R node:node /app/apps/api/uploads
WORKDIR /app/apps/api
USER node
EXPOSE 80 4010
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
