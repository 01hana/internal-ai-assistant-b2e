FROM node:22.17-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/internal-identity-contract/package.json packages/internal-identity-contract/package.json
COPY packages/connector-runtime-contract/package.json packages/connector-runtime-contract/package.json
RUN npm ci

FROM node:22.17-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run prisma:generate \
    && npm run build:identity-contract \
    && npm --prefix packages/connector-runtime-contract run build \
    && npm run build

FROM node:22.17-alpine AS runtime-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/internal-identity-contract/package.json packages/internal-identity-contract/package.json
COPY packages/connector-runtime-contract/package.json packages/connector-runtime-contract/package.json
COPY --from=build /app/packages/internal-identity-contract/dist ./packages/internal-identity-contract/dist
COPY --from=build /app/packages/connector-runtime-contract/dist ./packages/connector-runtime-contract/dist
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22.17-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=build /app/packages/internal-identity-contract/package.json ./packages/internal-identity-contract/package.json
COPY --from=build /app/packages/internal-identity-contract/dist ./packages/internal-identity-contract/dist
COPY --from=build /app/packages/connector-runtime-contract/package.json ./packages/connector-runtime-contract/package.json
COPY --from=build /app/packages/connector-runtime-contract/dist ./packages/connector-runtime-contract/dist
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY --chmod=0444 customers/shinmone/capability-packs ./customer-capability-packs
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
