# Biz Assistant

Business operations app with an Angular 18 / Tailwind frontend, NestJS API, and MySQL database.

**Hosting on Hostinger:** follow [README-HOSTINGER.md](README-HOSTINGER.md) for the one-time setup, database/file migration, and automatic deployment on GitHub pushes.

## Repository

```text
api/                   NestJS API, Sequelize models/migrations, tests
client/                Angular / Tailwind application
scripts/               Build, startup migration, and Docker deployment helpers
server.js              Combined production application entry point
.env.hostinger.example Hostinger environment template (no real credentials)
dist/                  Generated standalone Hostinger release; ignored by Git
```

The API and client are ordinary directories in this repository. Clone and push this repository only; separate submodule checkouts are no longer needed. Previous API/client repository history remains in the original remote repositories. Existing local nested Git metadata was preserved under `.git/hostinger-submodule-backup/` during conversion.

## Build and test

Use Node.js 22 (see `.nvmrc`).

```bash
npm run build
npm test
```

The build installs dependencies from the API/client lockfiles, compiles both applications, and installs production dependencies in `dist/api`. It does not connect to a database. Do not commit `dist`, credentials, database exports, or uploads.

To run the production release locally, copy `.env.hostinger.example` to `.env.hostinger`, supply your local database connection and an absolute upload directory outside `dist`, set `APP_BASE_URL=http://localhost:3000`, and leave `RUN_MIGRATIONS=false` unless you intend to migrate that database:

```bash
node --env-file=.env.hostinger dist/server.js
```

For Docker development:

```bash
cp .env.example .env  # only on a new checkout; preserve existing settings
# Review credentials and local ports before starting.
docker compose up -d
```

The Docker/VPS deployment files remain available. See [the Docker deployment reference](docs/DEPLOYMENT-DOCKER.md). Those manually triggered GitHub workflows are separate from Hostinger's GitHub deployment integration.

## Database review

See [the schema review](api/docs/schema-review-2026-09-21.md) for relationships, query indexes, and validation. Schema migrations and data migration during a hosting move are separate steps. Import `SequelizeMeta` along with the existing database before enabling automatic migrations.
