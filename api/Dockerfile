FROM node:20-bookworm-slim

WORKDIR /usr/src/app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
