FROM node:20-bookworm-slim AS deps

WORKDIR /usr/src/app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Local development (docker-compose.yml targets this stage and bind-mounts the source)
FROM deps AS development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY . .
RUN npm run build \
  && npm prune --omit=dev \
  && mkdir -p uploads

# Default (last) stage, used by CI for staging/production: no compilers or dev dependencies,
# and the app does not run as root
FROM node:20-bookworm-slim AS production

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY --from=build --chown=node:node /usr/src/app ./

USER node

EXPOSE 3000

CMD ["npm", "run", "start"]
