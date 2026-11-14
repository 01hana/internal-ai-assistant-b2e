FROM node:22.17-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/internal-identity-contract/package.json packages/internal-identity-contract/package.json
COPY packages/connector-runtime-contract/package.json packages/connector-runtime-contract/package.json
RUN npm ci

COPY prisma.config.ts ./prisma.config.ts
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY packages/internal-identity-contract/tsconfig.json packages/internal-identity-contract/tsconfig.json
COPY packages/internal-identity-contract/src packages/internal-identity-contract/src
COPY apps/gateway/package.json apps/gateway/nest-cli.json apps/gateway/tsconfig.json ./apps/gateway/
COPY apps/gateway/src ./apps/gateway/src
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run prisma:generate \
    && npm run build:identity-contract \
    && npm run build:gateway

FROM node:22.17-alpine AS runtime-dependencies
WORKDIR /repo/apps/gateway
COPY apps/gateway/package.json apps/gateway/package-lock.json ./
COPY packages/internal-identity-contract/package.json /repo/packages/internal-identity-contract/package.json
COPY --from=build /repo/packages/internal-identity-contract/dist /repo/packages/internal-identity-contract/dist
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.17-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production GATEWAY_PORT=4000
COPY --from=runtime-dependencies --chown=node:node /repo/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=runtime-dependencies --chown=node:node /repo/packages/internal-identity-contract ./packages/internal-identity-contract
COPY --from=build --chown=node:node /repo/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=runtime-dependencies --chown=node:node /repo/apps/gateway/package-lock.json ./apps/gateway/package-lock.json
COPY --from=build --chown=node:node /repo/apps/gateway/dist ./apps/gateway/dist
WORKDIR /repo/apps/gateway
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.GATEWAY_PORT||4000)+'/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(b=>{if(b.status!=='healthy')process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
