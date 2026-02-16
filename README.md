# Biz Assistant Workspace v3

Dockerized full-stack workspace for Biz Assistant with:

- Angular client
- Node.js/Express API
- MySQL, Redis, RabbitMQ
- Nginx reverse proxy
- Optional phpMyAdmin in development

This README includes a full production deployment guide for a DigitalOcean Ubuntu instance.

## Repository Scope

This repository is the orchestration workspace:

- `api/` submodule: `git@github.com:RalphBrabante/biz-assistant-api-service-v3.git`
- `client/` submodule: `git@github.com:RalphBrabante/biz-assistant-client-v3.git`
- root repo: `git@github.com:RalphBrabante/biz-assistant-worskpace-v3.git`

## Stack

- Client: Angular 18 (standalone/component-based), Bootstrap 5
- API: Node.js, Express, Sequelize
- Database: MySQL 8.4
- Cache: Redis 7
- Queue: RabbitMQ 3
- Reverse proxy: Nginx 1.27

## Architecture

- Public traffic goes to Nginx on `80/443`.
- Nginx routes:
  - `/` -> client
  - `/api/*` -> API
  - `/uploads/*` -> API uploads
  - `/db/` -> phpMyAdmin (dev compose only)
- In production compose:
  - only Nginx publishes ports
  - Redis/RabbitMQ/API stay internal on Docker networks
  - API connects to an external managed MySQL database via `DB_*` env vars

## Quick Start (Local Dev)

```bash
git clone git@github.com:RalphBrabante/biz-assistant-worskpace-v3.git
cd biz-assistant-worskpace-v3
git submodule update --init --recursive
cp .env.example .env
docker compose up --build
```

Dev mode with phpMyAdmin:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Production Mode

Production env filename:

- Use `.env.production` (in the workspace root).
- Start from template: `cp .env.production.example .env.production`

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Production profile includes:

- lower memory/CPU service limits for small instances
- external managed database support (no local MySQL container)
- Redis memory/eviction config (`redis/redis.conf`)
- RabbitMQ memory/disk guardrails via config file (`rabbitmq/rabbitmq.conf`)
- API production startup (`npm run start`)
- backend network isolation

## Full DigitalOcean Deployment Guide

### 1) Create the Droplet

Recommended minimum:

- Ubuntu 24.04 LTS
- 2 GB RAM / 1 vCPU (1 GB can work but is tight)
- 50+ GB SSD
- Region close to users
- Add your SSH public key during create

### 2) Point Domain/DNS

If using Cloudflare:

- Add an `A` record to your droplet public IP.
- Keep proxy enabled (orange cloud) if you want Cloudflare protection.

### 3) SSH and Base Server Hardening

```bash
ssh root@<your_server_ip>
apt update && apt upgrade -y
timedatectl set-timezone Asia/Manila
```

Create deploy user:

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Switch user:

```bash
su - deploy
```

### 4) Configure Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

Do not expose MySQL/Redis/RabbitMQ ports publicly in production.

### 5) Install Docker + Compose Plugin

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

### 6) Clone Workspace and Submodules

If your repos are private, add a deploy SSH key first (`~/.ssh/id_ed25519`) and add it in GitHub.

```bash
cd ~
git clone git@github.com:RalphBrabante/biz-assistant-worskpace-v3.git
cd biz-assistant-worskpace-v3
git submodule update --init --recursive
```

### 7) Configure Environment

```bash
cp .env.example .env
nano .env
```

At minimum, change:

- `RABBITMQ_DEFAULT_USER`
- `RABBITMQ_DEFAULT_PASS`

For production on DigitalOcean, use a dedicated file:

```bash
cp .env.production.example .env.production
nano .env.production
```

Set real secure values at minimum:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `RABBITMQ_DEFAULT_USER`
- `RABBITMQ_DEFAULT_PASS`

Password reset/email variables (required for real email delivery):

- `APP_BASE_URL` (example: `https://your-domain.com`)
- `RESET_PASSWORD_PATH` (default: `/reset-password`)
- `PASSWORD_RESET_EXPIRES_MINUTES` (default: `30`)
- `VERIFY_EMAIL_PATH` (default: `/verify-email`)
- `VERIFY_EMAIL_EXPIRES_MINUTES` (default: `60`)
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM_NAME`
- `SMTP_FROM_EMAIL`
- `SMTP2GO_API_KEY`
- `SMTP2GO_API_URL` (default: `https://api.smtp2go.com/v3/email/send`)

SMTP2GO quick setup:

- Set `SMTP2GO_API_KEY` to your SMTP2GO API key.
- Keep `SMTP_FROM_EMAIL` as a verified sender/domain in SMTP2GO.
- In production (`NODE_ENV=production`), SMTP2GO API key is required and SMTP fallback is disabled.
- In non-production environments, SMTP fallback remains available when `SMTP2GO_API_KEY` is empty.

### 8) Configure Cloudflare Origin SSL (Recommended)

Generate Origin Certificate in Cloudflare dashboard, then save:

- `nginx/certs/fullchain.pem`
- `nginx/certs/privkey.pem`

These are mounted to nginx and used by `nginx/default.ssl.conf`.

In Cloudflare SSL/TLS:

- Set mode to **Full (strict)**.

### 9) Start Production Stack

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f nginx
```

### 10) Seed System Data

Run seeders explicitly (safe to rerun; they are idempotent):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api npx sequelize-cli db:seed --seed src/seeders/20260215016000-seed-rbac-and-default-user.js
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api npx sequelize-cli db:seed --seed src/seeders/20260216007000-seed-tax-types.js
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api npx sequelize-cli db:seed --seed src/seeders/20260216009000-seed-withholding-tax-types.js
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api npx sequelize-cli db:seed --seed src/seeders/20260216024000-seed-ralph-superuser.js
```

Notes:

- Withholding tax seed requires organizations to exist.
- Roles/permissions and seeded tax records are marked system data and protected from deletion.
- Your external DB user must have schema/table migration and DML privileges.

### 11) Validate Deployment

```bash
curl -I http://<your-domain>
curl -I https://<your-domain>
curl -s https://<your-domain>/api/v1/health
```

If Cloudflare is enabled, verify HTTPS and redirects from HTTP.

### 12) Routine Update Procedure

```bash
cd ~/biz-assistant-worskpace-v3
git pull
git submodule sync --recursive
git submodule update --init --recursive --remote
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

### 13) Backups (Recommended)

Use your managed database provider backup/snapshot tooling for DB backups.
For app-side persistence, back up docker volumes such as `rabbitmq_data`, `redis_data`, and uploaded files.

### 14) Optional: Auto-start on Reboot

Docker restart policies are already `unless-stopped`. Also enable docker:

```bash
sudo systemctl enable docker
```

## Service Access

Development mode:

- App: `http://localhost`
- API direct: `http://localhost:3000`
- RabbitMQ UI: `http://localhost:15672`
- phpMyAdmin: `http://localhost/db/` (dev compose only)

Production mode:

- Public app/API entrypoint: `https://<your-domain>` via nginx
- Internal services are not publicly exposed

## Useful Commands

Start/stop:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

Logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f nginx
```

Run migrations manually:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api npm run db:migrate
```

Use `.env.production` in production to keep credentials/environment separated.

## Postman

- `postman/gimo-api.postman_collection.json`

## Troubleshooting

### Database connection issues in production

Verify external DB settings in `.env.production`:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSL` / `DB_SSL_REJECT_UNAUTHORIZED` (if provider requires TLS)

### SSL certificate not loading

- Confirm files exist:
  - `nginx/certs/fullchain.pem`
  - `nginx/certs/privkey.pem`
- Check nginx logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f nginx
```

### API reports `Database models are not ready yet`

- Confirm external DB is reachable from droplet and credentials are valid.
- Check:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
```

## Repository Layout

```text
.
├── api/                     # API submodule
├── client/                  # Client submodule
├── mysql/                   # MySQL config (used by local/dev compose)
├── redis/                   # Redis production tuning config
├── nginx/                   # Nginx configs + cert mount path
├── postman/                 # Postman collection
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.prod.yml
└── .env.example
```
