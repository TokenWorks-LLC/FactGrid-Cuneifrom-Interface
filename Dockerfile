FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build

COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN groupadd --system --gid 1001 factgrid \
  && useradd --system --uid 1001 --gid factgrid factgrid \
  && mkdir -p /data \
  && chown factgrid:factgrid /data
COPY --from=build --chown=factgrid:factgrid /app/.next ./.next
COPY --from=build --chown=factgrid:factgrid /app/node_modules ./node_modules
COPY --from=build --chown=factgrid:factgrid /app/package.json ./package.json
COPY --from=build --chown=factgrid:factgrid /app/package-lock.json ./package-lock.json
COPY --from=build --chown=factgrid:factgrid /app/public ./public

USER factgrid
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["npm", "start"]
