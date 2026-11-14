FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/internal-identity-contract/package.json packages/internal-identity-contract/package.json
COPY packages/connector-runtime-contract/package.json packages/connector-runtime-contract/package.json
RUN npm ci

COPY packages/connector-runtime-contract/tsconfig.json packages/connector-runtime-contract/tsconfig.json
COPY packages/connector-runtime-contract/src packages/connector-runtime-contract/src
COPY apps/customer-connector-runtime/package.json apps/customer-connector-runtime/nest-cli.json apps/customer-connector-runtime/tsconfig.json ./apps/customer-connector-runtime/
COPY apps/customer-connector-runtime/src ./apps/customer-connector-runtime/src
COPY apps/customer-connector-runtime/integrations ./apps/customer-connector-runtime/integrations
RUN npm --prefix packages/connector-runtime-contract run build \
    && npm --prefix apps/customer-connector-runtime run build \
    && chmod 0444 apps/customer-connector-runtime/dist/integrations/shinmone/kpistats-six-metric.demo.manifest.json \
    && rm apps/customer-connector-runtime/dist/integrations/shinmone/work-orders.*.manifest.json

FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runtime-deps
WORKDIR /repo/apps/customer-connector-runtime
COPY apps/customer-connector-runtime/package.json apps/customer-connector-runtime/package-lock.json ./
COPY packages/connector-runtime-contract/package.json /repo/packages/connector-runtime-contract/package.json
RUN npm ci --omit=dev

FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runtime
WORKDIR /repo
ENV NODE_ENV=production PORT=3100
COPY --from=runtime-deps --chown=node:node /repo/apps/customer-connector-runtime/node_modules ./apps/customer-connector-runtime/node_modules
COPY --from=build --chown=node:node /repo/packages/connector-runtime-contract/package.json ./packages/connector-runtime-contract/package.json
COPY --from=build --chown=node:node /repo/packages/connector-runtime-contract/dist ./packages/connector-runtime-contract/dist
COPY --from=build --chown=node:node /repo/apps/customer-connector-runtime/package.json ./apps/customer-connector-runtime/package.json
COPY --from=build --chown=node:node /repo/apps/customer-connector-runtime/dist ./apps/customer-connector-runtime/dist
WORKDIR /repo/apps/customer-connector-runtime
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/ready').then(r=>r.json()).then(b=>{if(b.productionReady!==true)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/integrations/shinmone/production.main.js"]
