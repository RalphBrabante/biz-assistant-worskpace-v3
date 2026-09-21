# Deploy Biz Assistant on Hostinger Node.js

This guide targets **managed Node.js Web Apps on Hostinger Business or Cloud hosting**. If your purchase is a VPS, use the [Docker/VPS guide](docs/DEPLOYMENT-DOCKER.md) instead. After the one-time database, storage, environment, and GitHub setup below, pushing the connected branch builds and deploys the whole application.

This repository has been prepared for deployment; it has not been deployed to your Hostinger account. See the [local validation record](docs/hostinger-validation-2026-09-21.md). Validate the actual hosting environment with a database copy before changing the live domain.

## 1. How the deployment works

```text
GitHub push → Hostinger build: npm run build → dist/server.js
                                               ├─ Angular pages and static assets
                                               ├─ /api/v1/* → NestJS API → MySQL
                                               ├─ /socket.io → notifications
                                               ├─ /uploads/* → persistent UPLOAD_DIR
                                               └─ /healthz → readiness check
```

One Node process serves the API and frontend on the same domain. The browser uses relative API URLs; there is no frontend API-host setting to rebuild. Docker, a separate Nginx container, Redis, and RabbitMQ are not required for this deployment. Redis caching is optional; notifications use Socket.IO directly. The startup settings below disable both Redis and RabbitMQ.

`api/` and `client/` now belong to this repository. Hostinger needs access only to `biz-assistant-worskpace-v3`, not the two old source repositories. Make future changes and commits from this repository root. Local historical Git metadata was preserved in `.git/hostinger-submodule-backup/`; the original remote repositories are unchanged.

## 2. Prepare the database before the first deployment

1. Create a database and database user in hPanel → Databases → Management. Record the full account-prefixed database/user names and the host shown by hPanel. Use those exact values, not Docker service names.
2. Take a consistent backup of the existing MySQL database, including schema, data, **SequelizeMeta**, indexes, foreign keys, and triggers. Preserve an untouched backup. Take a separate backup of uploaded files and record the current app version.
3. Import into a **new target database** using phpMyAdmin or the migration facilities available on your account. Do not import over the only live copy. The app remains on the Sequelize `mysql` dialect; it does not use Supabase or MongoDB.
4. Check source/target database versions and SQL compatibility before importing. Existing migrations create triggers protecting system tax types, roles, permissions, and license keys. Confirm the target user has the necessary trigger/DDL privileges. Resolve source-specific `DEFINER` ownership in a working copy of the dump with your database administrator; do not remove the protections or blindly replace strings throughout a data dump. If the managed database cannot support the schema, use a compatible external MySQL database or a VPS.
5. Verify row counts, organization memberships, VAT configuration, receipt/payable totals, attachments, and migration names. The previous expense review explicitly leaves historical expense values unchanged; a hosting move must not recalculate those records.

Importing an existing database preserves accounts and password hashes. Log in using an existing active account with the appropriate organization/license. This deployment does not create default passwords or run demo seeders. For an empty installation, arrange an explicit account/bootstrap procedure before exposing the app; merely creating empty tables is not a production onboarding process.

For final cutover, pause writes on the old app, take/import the final backup, copy the final upload changes, verify, and then switch traffic. Keep the old database and server available until the new deployment is verified. Avoid accepting writes on both sites simultaneously.

Hostinger's [MySQL connection instructions](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/) describe database creation and connection variables; the host is commonly `localhost`, but use the value assigned to your account.

## 3. Keep uploaded files outside releases

Hostinger replaces release directories when deploying. Choose a stable directory owned by your hosting account **outside `hbuilds` and `public_html`**, for example:

```text
/home/YOUR_ACCOUNT/domains/app.example.com/app-data/uploads
```

Use File Manager or SSH to create it and copy the contents of the old API's `uploads/` directory there, preserving the `expenses/` and `profiles/` subdirectories. Set `UPLOAD_DIR` to its actual absolute path. The Node process must be allowed to read and write it. Do not use a symlink back into a release. Confirm the account permits this path before proceeding; if it does not, ask Hostinger for a persistent writable location outside releases.

Replace **both** the account name and domain in the example. In your deployment logs, a path such as `/home/u123456789/domains/my-app.com/hbuilds/...` identifies the account and domain directory; use `/home/u123456789/domains/my-app.com/app-data/uploads` for that example. A literal `replace_account` or `YOUR_ACCOUNT` is not a real hosting account. Update `UPLOAD_DIR` in hPanel's **Environment variables** and select **Apply changes**; changing only your local `.env` file does not update the deployed app. Create the folder using the same hosting account that runs Node, with owner read/write/traverse permissions (normally directory mode `755`).

The app creates missing subdirectories. Startup rejects a relative upload path, a path within its deployment directory, or a path containing `hbuilds`. Browser URLs remain `/uploads/expenses/...` and `/uploads/profiles/...`. Uploads are excluded from Git and the release artifact; back them up separately.

If App Settings currently use DigitalOcean Spaces or Google Drive, moving the application server does **not** move those files. Switching the provider selector to Local changes future uploads; it does not rewrite historical attachment URLs. For Spaces, use the new **Settings → Move Spaces files to local storage** workflow after setting up the persistent `UPLOAD_DIR` and applying database migrations. It previews linked records, copies and verifies each file, updates its links, and keeps a downloadable audit. Follow [the storage migration guide](api/docs/storage-migration.md). Google Drive files are not included in this workflow. A writable upload directory is still needed for upload processing even when remote storage is used.

## 4. Set environment variables in Hostinger

Use [.env.hostinger.example](.env.hostinger.example) as a template and enter the values in the Node.js app's environment settings. Do not upload a real `.env` file through Git. The application reads process environment variables; the example file is not automatically loaded by the server.

| Variable | Value / purpose |
| --- | --- |
| `NODE_ENV` | `production` (required by the deployment entry point) |
| `APP_BASE_URL` | Final HTTPS app origin, e.g. `https://app.example.com` |
| `DB_HOST`, `DB_PORT` | Assigned database host and port, usually `3306` |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Target database credentials; required |
| `DB_POOL_MAX` | `4` initially; stay within the account's connection limit |
| `DB_SSL` | `false` for a local connection if appropriate; `true` when your external DB requires TLS |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true`; use a trusted database certificate |
| `UPLOAD_DIR` | Absolute persistent path from step 3 |
| `RUN_MIGRATIONS` | `false` during initial import/verification; see next section |
| `REDIS_ENABLED` | `false` |
| `AMQP_ENABLED` | `false` |
| `LICENSE_EXPIRY_JOB_ENABLED` | `true` for the existing in-process expiry housekeeping |
| `SMTP2GO_API_KEY` | API key used by the existing mail implementation |
| `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` | Verified mail sender and display name |

Leave `PORT` to the hosting platform; the server reads it and falls back to `3000` locally. Do not hardcode a public port or configure browser API URLs to point to it. SMTP username/password variables do not enable mail here: the app currently sends through SMTP2GO's API. Test password-reset/verification email and update any Google Drive OAuth redirect allowlist to the new HTTPS domain.

If adding external Redis/RabbitMQ later, set `REDIS_ENABLED=true` with `REDIS_URL`, or `AMQP_ENABLED=true` with `AMQP_URL`. Disabled services are reported as disabled instead of making health checks fail. Enabled but failed services still produce an unhealthy result. Hostinger's [database/data-tool support guide](https://www.hostinger.com/support/which-databases-and-data-tools-are-supported-at-hostinger/) describes managed-plan restrictions; standalone Redis requires an external service or VPS.

## 5. Connect GitHub and configure the build

Commit the converted source directories, lockfiles, scripts, and documentation to the workspace repository and push the branch you intend to deploy. Review the staged files first to ensure no secrets or uploads are included. Do not push only an old API/client submodule pointer.

In Hostinger, choose Websites → Add Website → Deploy Web App → Import Git Repository, authorize the repository, and choose your release branch. Use these settings for **this project**:

| Setting | Value |
| --- | --- |
| Repository | `RalphBrabante/biz-assistant-worskpace-v3` |
| Branch | Your release branch; select `main` only once these changes are merged there |
| Framework/application type | **Other**, as a Node backend application |
| Node.js version | **22.x** |
| Project/root directory | Repository root (`.`) |
| Package manager / install command, if shown | npm / `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Entry file within the output directory | `server.js` |
| Start command, if shown | `node server.js` from `dist` (or `npm start` from the repository root) |

The build explicitly installs development dependencies needed by Angular and TypeScript even when `NODE_ENV=production`. It then assembles `dist/` with the compiled API, browser files, migration scripts, and API production dependencies, including Sequelize CLI. Build workers default to two to reduce memory pressure. No database access occurs at build time.

Do not select a static Angular-only deployment or set the output to `client/dist/angular-client/browser`: that would omit the backend. Retain Hostinger's generated backend routing; do not replace it with a static-only `.htaccess` file.

These steps use Hostinger's documented [GitHub deployment and custom Node application settings](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/). Labels may vary by dashboard version. Configure the entry relative to the output directory; the file that must execute is the generated `dist/server.js`.

## 6. Enable migrations for future pushes

After the imported database and its `SequelizeMeta` table are verified and backed up, set `RUN_MIGRATIONS=true` and deploy. Startup acquires a database advisory lock, runs pending compiled Sequelize migrations, and starts the app only if they succeed. It never creates the database, force-syncs models, seeds demo users, or runs migration undo commands.

The lock serializes migrations across simultaneous starts. It does not make MySQL DDL transactional or make incompatible schema changes safe for an older process. Use backward-compatible migrations, review them before pushing, and back up before schema changes. A migration failure blocks startup and is visible in runtime logs; fix the cause before retrying. Do not delete `SequelizeMeta` or repeatedly run rollback commands to bypass a failure.

The root build/start commands automate this because managed hosting should not depend on interactive `npm` access over SSH. When automatic migrations are disabled, apply required migrations through a controlled deployment against the intended database before starting the updated app.

## 7. Verify before switching the domain

On a staging domain/database copy:

- Confirm `/healthz` returns HTTP 200 with `{"ok":true}`. It checks database connectivity on each request and the configured service status, without exposing credentials.
- Open `/`, `/dashboard`, and a nested page directly, then refresh. Confirm JS/CSS load and API requests return JSON, not the Angular HTML page.
- Sign in as users from both companies; confirm organization selection and access boundaries, dashboard values, expenses, invoices, and VAT/non-VAT behavior.
- Create disposable test records in the staging database, upload an image, and verify it still opens after another deployment. Also check historical attachments.
- Send a test organization message using two signed-in sessions. Socket.IO starts with polling and attempts a WebSocket upgrade. Verify the proxy behavior on your actual plan; polling keeps basic delivery available if upgrades are unavailable.
- Test mail delivery, logout/login, and a restart. The hourly license-expiry housekeeping runs only while the Node process is running; license validity is also enforced when authenticating. If exact scheduled execution is required, arrange a reliable scheduler separately.
- Repeat essential smoke checks after the final import and DNS/SSL cutover. Check deployment and runtime logs for startup errors.

Use a single application instance initially. Multiple instances require a shared Socket.IO adapter and appropriate session affinity; neither is configured in this release. The lightweight health endpoint confirms connectivity, not correctness of every table, account, or integration.

## 8. Deploy subsequent changes

After local checks, commit and push to the branch connected in Hostinger:

```bash
npm run build
npm test
git add README.md README-HOSTINGER.md api client scripts tests docs package.json package-lock.json server.js .nvmrc .env.hostinger.example .gitignore .github
# Review all changes (the initial conversion also removes .gitmodules and old gitlinks).
git diff --cached --stat
git commit -m "Describe the application change"
git push
```

Use `git add -u` for tracked removals when preparing the initial conversion, and inspect `git status` before committing. Never force-push as part of a normal deployment. Push to the selected deployment branch, or merge a reviewed pull request into it.

Hostinger's GitHub connection performs deployment. `.github/workflows/validate.yml` separately builds/tests main/develop and pull requests; it does not itself upload the application or gate Hostinger's push trigger. Use a protected release branch and require passing checks before merging if that guarantee is needed. The existing Docker deployment workflows remain manual and are not needed for Hostinger.

## Troubleshooting and rollback

| Symptom | Check |
| --- | --- |
| Build cannot find source or entry | Repository root must be `.`; output must be `dist`; confirm the ordinary `api/` and `client/` files and lockfiles were committed |
| TypeScript/Angular command missing | Use the root build script; it installs build dependencies explicitly |
| `Cannot find module '@lmdb/lmdb-linux-x64'`, followed by a Python/node-gyp error | Deploy the latest corrected `client/package-lock.json`. It includes LMDB and MessagePack prebuilt platform packages; retain `--include=optional` in the build script. Keep Node.js 22. A fallback source compilation is not required. |
| Build killed for memory | Keep `NG_BUILD_MAX_WORKERS=2` (or try `1`) and check plan build limits |
| MySQL connection fails | Full hPanel database/user names, host, password, TLS settings, and connection limits |
| Migration fails | Imported `SequelizeMeta`, target SQL version, trigger/DDL permissions, and runtime logs; do not reseed |
| Upload path error or disappearing files | Absolute writable directory outside `hbuilds`, release output, and `public_html`; copy existing files there |
| `EACCES: permission denied, mkdir '/home/replace_account/...'` | `UPLOAD_DIR` still contains the example account. Replace it with the actual `/home/u.../domains/.../app-data/uploads` path, create the directory under your hosting account, and apply the updated environment variables |
| Missing older Spaces images | Original object URLs still need their storage service or a completed file/URL migration |
| API requests return HTML | Wrong static-only deployment type or frontend-only output directory |
| Health is 503 | Database connectivity or an explicitly enabled Redis/AMQP service has failed |
| Mail fails | SMTP2GO API key, verified sender, and provider delivery logs |
| Old UI remains after deployment | Reload/update the installed PWA/service worker; verify the active deployment in hPanel |

For code rollback, redeploy a known-good Git commit or use an available Hostinger release rollback. **A code rollback does not roll back the database or uploaded files.** Check schema compatibility before restarting an older release. Restore a database backup only as a deliberate recovery step, accounting for newer writes. Keep tested off-host database/upload backups and record which commit and migration set each release uses.
