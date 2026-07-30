FROM node:22.17-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/gateway/package.json ./apps/gateway/package.json
RUN npm ci --workspace=@internal-ai-assistant/gateway

FROM node:22.17-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/apps/gateway/package.json ./apps/gateway/package.json
COPY apps/gateway ./apps/gateway
RUN npm run build --workspace=@internal-ai-assistant/gateway

FROM node:22.17-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=build /app/apps/gateway/dist ./apps/gateway/dist
EXPOSE 4000
CMD ["npm", "run", "start", "--workspace=@internal-ai-assistant/gateway"]
