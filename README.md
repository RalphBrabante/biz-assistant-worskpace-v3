# Biz Assistant Workspace v3

Dockerized full-stack workspace for Biz Assistant with a reverse-proxied Angular client, Express API, MySQL, Redis, RabbitMQ, and optional phpMyAdmin in dev mode.

## What This Repository Contains

This repository is the **workspace/orchestration repo**.

- `api/` is a git submodule: `git@github.com:RalphBrabante/biz-assistant-api-service-v3.git`
- `client/` is a git submodule: `git@github.com:RalphBrabante/biz-assistant-client-v3.git`
- root repo (this one): `git@github.com:RalphBrabante/biz-assistant-worskpace-v3.git`

## Stack

- **Client**: Angular 18 (standalone/component-based), Bootstrap 5, Bootstrap Icons
- **API**: Node.js + Express + Sequelize + MySQL
- **Infra**: Nginx, MySQL 8.4, Redis 7, RabbitMQ 3 (management UI)
- **Dev DB UI**: phpMyAdmin (enabled via dev override compose file)

## Architecture

- Nginx listens on `http://localhost`
- Nginx routes:
  - `/` -> Angular client (`client:4200`)
  - `/api/*` -> API (`api:3000`)
  - `/db/` -> phpMyAdmin (`phpmyadmin:80`) in dev compose mode only
- API connects to:
  - MySQL (`mysql:3306`)
  - Redis (`redis:6379`)
  - RabbitMQ (`amqp:5672`)

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- Git
- Open ports: `80`, `3000`, `3306`, `6379`, `5672`, `15672`

## First-Time Setup

1. Clone workspace and submodules:

```bash
git clone git@github.com:RalphBrabante/biz-assistant-worskpace-v3.git
cd biz-assistant-worskpace-v3
git submodule update --init --recursive
```

2. Create env file:

```bash
cp .env.example .env
```

3. Start containers:

```bash
docker compose up --build
```

## Run Modes

### Standard Mode

```bash
docker compose up --build
```

### Dev Mode (with phpMyAdmin at `/db`)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### Production Mode (Optimized for 1 vCPU hosts)

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This mode applies:

- smaller Sequelize pool defaults
- MySQL low-memory tuning (`mysql/conf.d/my.cnf`)
- Redis memory cap + LRU eviction (`redis/redis.conf`)
- API production runtime (no nodemon)
- conservative CPU/memory limits per service
- Nginx gzip + timeout tuning
- internal backend network isolation:
  - MySQL, Redis, RabbitMQ, and API run on `backend` network
  - MySQL/Redis/RabbitMQ/API are **not published** to host ports
- only Nginx is exposed publicly on port `80`
- Nginx can be configured for Cloudflare Origin SSL on ports `80` and `443`

### Cloudflare Origin SSL (Production)

This workspace supports Cloudflare Origin Certificates with nginx in production compose mode.

1. In Cloudflare dashboard, generate an Origin Certificate for your domain.
2. Save the files as:
   - `nginx/certs/fullchain.pem`
   - `nginx/certs/privkey.pem`
3. Start/restart production stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build nginx
```

4. In Cloudflare SSL/TLS settings, set encryption mode to **Full (strict)**.

Notes:
- `docker-compose.prod.yml` publishes both `80` and `443`.
- Port `80` is redirected to HTTPS by nginx.
- Certificate files are git-ignored by default.

## Service URLs

- App (via Nginx): `http://localhost`
- API (direct): `http://localhost:3000`
- API health: `http://localhost:3000/health`
- RabbitMQ management: `http://localhost:15672`
- phpMyAdmin (dev mode only): `http://localhost/db/`
- MySQL host port: `localhost:3306`
- Redis host port: `localhost:6379`

## Default Credentials / Environment

From `.env.example`:

- MySQL root password: `rootpassword`
- MySQL DB: `appdb`
- MySQL user/password: `appuser` / `apppassword`
- RabbitMQ user/password: `guest` / `guest`

## Database Lifecycle

When API container starts, it runs:

1. `npm install`
2. `npm run db:create` (non-fatal if already exists)
3. `npm run db:migrate`
4. `npm run dev`

This is configured in `docker-compose.yml` under API `command`.

In production override mode (`docker-compose.prod.yml`), API starts with:

1. `npm run db:create` (non-fatal if already exists)
2. `npm run db:migrate`
3. `npm run start`

## Useful Commands

### Start / Stop

```bash
# Start (detached)
docker compose up -d --build

# Stop
docker compose down

# Stop and remove volumes (destructive)
docker compose down -v
```

### Logs

```bash
docker compose logs -f
docker compose logs -f api
docker compose logs -f client
docker compose logs -f mysql
```

### Rebuild a single service

```bash
docker compose up -d --build api
docker compose up -d --build client
```

### Execute commands inside containers

```bash
docker compose exec api sh
docker compose exec client sh
docker compose exec mysql sh
```

## Submodule Workflow

If `api` or `client` looks empty or detached:

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

To pull latest in submodules:

```bash
cd api && git pull
cd ../client && git pull
```

Then commit submodule pointer updates in root repo:

```bash
cd ..
git add api client
git commit -m "Update api/client submodule pointers"
git push
```

## Postman Collection

- Workspace collection file: `postman/gimo-api.postman_collection.json`

## Troubleshooting

### 1) MySQL fails with `Failed to initialize DD Storage Engine`

Usually a corrupted or incompatible MySQL data volume.

```bash
docker compose down -v
docker compose up --build
```

If using dev override, apply both files in commands.

### 2) `Cannot connect to /db`

Use dev compose mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### 3) API says models are not ready

Wait until MySQL healthcheck passes and migrations complete, then retry.

### 4) Client reflects stale UI

```bash
docker compose up -d --build client
```

## Repository Layout

```text
.
├── api/                     # API submodule (Express + Sequelize)
├── client/                  # Client submodule (Angular)
├── nginx/                   # Nginx configs (standard + dev)
├── postman/                 # Postman collection
├── docker-compose.yml       # Base stack
├── docker-compose.dev.yml   # Dev overrides (phpMyAdmin + dev nginx)
└── .env.example
```

## Notes

- `api/node_modules` is volume-mounted (`api_node_modules`) for faster containerized dev.
- MySQL data is persisted in Docker volume `mysql_data`.
- Redis and RabbitMQ data are also persisted via named volumes.
