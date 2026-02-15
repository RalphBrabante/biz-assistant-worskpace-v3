# Docker Workspace Scaffold

This workspace includes the following services:
- MySQL
- Node.js + Express API
- RabbitMQ (AMQP)
- Redis
- Angular client
- Nginx reverse proxy

## Quick Start

1. Copy env file:

```bash
cp .env.example .env
```

2. Build and start all services:

```bash
docker compose up --build
```

Dev mode with phpMyAdmin at `/db`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

3. Access services:
- App via Nginx: http://localhost
- phpMyAdmin via Nginx (dev override): http://localhost/db/
- API direct: http://localhost:3000
- API health: http://localhost:3000/health
- RabbitMQ management: http://localhost:15672
- MySQL: localhost:3306
- Redis: localhost:6379

## Notes
- Nginx proxies `/` to Angular (`client:4200`) and `/api/*` to Express (`api:3000`).
- Angular is configured for containerized dev mode (`ng serve --host 0.0.0.0`).
