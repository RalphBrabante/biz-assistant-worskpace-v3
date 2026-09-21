# Move DigitalOcean Spaces files to local storage

“Local” means the filesystem on the server running Biz Assistant. On Hostinger, set `UPLOAD_DIR` to an absolute, persistent directory **outside build/release directories**, as described in [the deployment guide](../../README-HOSTINGER.md#3-keep-uploaded-files-outside-releases). Back up that directory together with the database. All instances of the app must use the same upload directory; separate disks on multiple instances are not supported by this workflow.

## Deploy and run

1. Deploy the updated API and client and apply `20260921020000-add-storage-migration-audit`. Hostinger startup handles this when `RUN_MIGRATIONS=true`. Otherwise run your normal controlled Sequelize migration process before using the feature. This migration adds audit tables; it does not change any historical financial data.
2. Sign in as a **superuser** and open **Settings**. Save the source Spaces endpoint, region, bucket, access key, secret, and optional custom CDN base URL. Credentials need read access to the source objects. Existing credentials are retained when switching providers.
3. Under **Move Spaces files to local storage**, select **Scan Spaces links**. Review the record counts and any unmatched external links. This preview does not copy files or change upload providers. Storage settings are locked while a preview or migration is active; close it to edit settings and scan again.
4. Select **Use local storage & migrate**. Confirm the displayed scope. The default, expense attachment, and profile image providers switch to local storage for new uploads, and existing files are copied in small batches. Originals stay in Spaces. Each historical record keeps its current URLs until all of that record’s copies are verified.
5. Keep Settings open while copying. **Pause**, leave the page, or close the browser to stop after the current request. Open Settings and **Resume migration** to continue from saved progress. If a request loses its connection, use **Refresh status** before resuming. Multiple tabs/processes cannot run a storage operation simultaneously.
6. Use **Retry failed & rescan** after resolving disk space, permissions, missing objects, or access problems. To change source credentials or paths, **Close migration**, save settings, and scan again. Closing preserves copied files, link updates, and the current provider; it does not undo work.
7. Download the audit, open several migrated receipts and profile images, and verify persistent upload backups. Allow any uploads already in flight before the switch to finish, then perform another scan. Do not remove the Spaces bucket while any required links still point there. The feature never deletes Spaces objects.

## Included records

- Expense `file`, `fileCdnUrl`, and `receiptUrl`, across **all organizations**, including purchases recorded as expenses.
- User `profileImageUrl` and `profileImageCdnUrl`.
- The separate purchase-order model currently has no attachment fields.

Only objects referenced by these fields are copied. Unlinked bucket objects, URLs embedded in free text, Google Drive links, and other external files are excluded. The scan recognizes the configured bucket’s origin URL, path-style URL, standard Spaces CDN URL, and configured custom CDN prefix. An unrecognized DigitalOcean bucket is reported as an error. Other external links are counted and left unchanged; if these belong to an older custom Spaces CDN, configure that source and run a separate scan.

## Verification and recovery

Downloads use the authenticated Spaces API, not arbitrary stored URLs. Files stream to temporary files, are checked against the reported content length, hashed with SHA-256, read back from disk, and published atomically. Identical file content within the source shares one local copy. Unexpected active formats such as HTML are stored as `.bin` downloads. Individual objects are limited to 100 MB; each record’s copy attempt has a 20-second deadline. Oversized or consistently slower objects remain linked to Spaces and require a separate controlled transfer.

The database transaction locks the record and checks that its attachment fields still match the preview. Concurrently edited or deleted records are skipped and current links are scanned again before completion. Only attachment fields change; expense amounts, taxes, organization assignments, and historical update timestamps are preserved. Failed downloads or database updates leave existing links in place. An interrupted attempt can leave an unreferenced local copy or hidden `.part` file; retries verify/reuse complete copies. Do not remove a local file just because one audit entry was skipped: another record may reference it.

Audit tables retain actor, source bucket, prior upload providers, original links, new links, per-file hashes and sizes, verification times, errors, and skipped snapshots. Credentials are not stored in the audit. The Settings download covers the latest migration; older audit records remain in `storage_migrations` and `storage_migration_items`, and superusers can retrieve a known migration ID at `GET /api/v1/settings/storage/migrations/:id/audit`.

There is no automatic rollback or deletion. Returning the provider selector to Spaces affects new uploads only; already migrated links continue to use local storage. Keep the local files available. Restoring old links requires reviewing the audit and checking for subsequent record edits first.

## Developer verification

`npm test` includes URL resolution, verified copy/failure cleanup, and authorization checks. `node api/scripts/verify-storage-migration.js` runs the opt-in MySQL integration suite using `STORAGE_TEST_HOST`, `STORAGE_TEST_PORT`, `STORAGE_TEST_USER`, and `STORAGE_TEST_PASSWORD`. It creates and removes its own `storage_migration_test_*` database and synthetic files; the account must have permission to create databases. It does not read existing business rows or contact Spaces.
