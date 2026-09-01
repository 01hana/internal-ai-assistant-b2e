FROM node:22.17-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/internal-identity-contract/package.json packages/internal-identity-contract/package.json
RUN npm ci
COPY apps/identity-bridge/package.json apps/identity-bridge/nest-cli.json apps/identity-bridge/tsconfig.json ./apps/identity-bridge/
COPY apps/identity-bridge/src ./apps/identity-bridge/src
RUN npm --prefix apps/identity-bridge run build

FROM node:22.17-alpine AS runtime-dependencies
WORKDIR /app
COPY apps/identity-bridge/package.json apps/identity-bridge/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.17-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=runtime-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/identity-bridge/dist ./dist
COPY --chown=node:node apps/identity-bridge/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/ready').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(b=>{if(b.status!=='ready'||b.productionReady!==true)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
