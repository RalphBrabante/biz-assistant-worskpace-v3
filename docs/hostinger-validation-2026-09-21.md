# Hostinger deployment preparation validation — 2026-09-21

This validates the generated release locally, not a deployment inside a Hostinger account.

- Built the API and Angular production application through the root `npm run build` using Node.js 22.23.2.
- Ran 73 regression/deployment tests under Node.js 22: all passed. These cover expense calculations, invoice organization relationships, schema indexes, dashboard/message/UI behavior, environment validation, and combined frontend/API routing.
- Started the generated `dist/server.js` against the existing local MySQL database twice, with Redis, RabbitMQ, and license-expiry housekeeping disabled for the smoke check.
- Verified there were no pending migrations before allowing the startup migration runner to execute. Both executions reported that the database was already up to date.
- Verified HTTP readiness, direct dashboard navigation, API authentication, the production-only restriction on development cache inspection, missing-upload responses, and Socket.IO polling handshakes.
- Verified a fixture file in a temporary persistent upload directory remained available after restarting the generated release. The fixture was removed afterward.
- Compared expense-record hashes before and after the smoke check: unchanged.
- Confirmed all previously tracked API/client files are retained in the ordinary source directories. Original nested Git metadata was preserved locally; no remote repositories were modified.
- Completed missing esbuild platform entries in the frontend lockfile without changing existing package versions. Hostinger still needs to run its own Linux build as part of first deployment.

The first Hostinger deployment must validate actual account paths/permissions, imported MySQL schema and triggers, environment variables, SSL, email, and real notification delivery. GitHub account connection, domain/DNS setup, database/file migration, and live deployment remain account-specific setup steps described in [README-HOSTINGER.md](../README-HOSTINGER.md).
