FROM node:22.17-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/internal-identity-contract/package.json packages/internal-identity-contract/package.json
COPY packages/connector-runtime-contract/package.json packages/connector-runtime-contract/package.json
RUN npm ci
COPY packages/connector-runtime-contract/tsconfig.json packages/connector-runtime-contract/tsconfig.json
COPY packages/connector-runtime-contract/src packages/connector-runtime-contract/src
RUN npm --prefix packages/connector-runtime-contract run build
COPY apps/identity-bridge/package.json apps/identity-bridge/nest-cli.json apps/identity-bridge/tsconfig.json ./apps/identity-bridge/
COPY apps/identity-bridge/src ./apps/identity-bridge/src
RUN npm --prefix apps/identity-bridge run build

FROM node:22.17-alpine AS runtime-dependencies
WORKDIR /repo/apps/identity-bridge
COPY apps/identity-bridge/package.json apps/identity-bridge/package-lock.json ./
COPY packages/connector-runtime-contract/package.json /repo/packages/connector-runtime-contract/package.json
COPY --from=build /repo/packages/connector-runtime-contract/dist /repo/packages/connector-runtime-contract/dist
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.17-alpine AS runtime
WORKDIR /repo/apps/identity-bridge
ENV NODE_ENV=production PORT=3000
COPY --from=runtime-dependencies --chown=node:node /repo/apps/identity-bridge/node_modules ./node_modules
COPY --from=runtime-dependencies --chown=node:node /repo/packages/connector-runtime-contract /repo/packages/connector-runtime-contract
COPY --from=build --chown=node:node /repo/apps/identity-bridge/dist ./dist
COPY --chown=node:node apps/identity-bridge/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/ready').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(b=>{if(b.status!=='ready'||b.productionReady!==true)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
