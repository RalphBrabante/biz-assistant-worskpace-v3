'use strict';
// Removes public access from expense receipts uploaded before attachments became private
// (Spaces objects with a public-read ACL, Drive files shared with "anyone with the link").
// Receipts are then only reachable through GET /api/v1/expenses/:id/attachment.
//
// Dry run (default, changes nothing):   node scripts/make-expense-attachments-private.js
// Apply:                                node scripts/make-expense-attachments-private.js --apply
// Uses the same DB_* environment as the API (run it inside the API container).
const { Op } = require('sequelize');
const { authenticateSequelize, getModels } = require('../src/sequelize');
const { makeStoredFilePrivate } = require('../src/services/storage-service');

const apply = process.argv.includes('--apply');
const batchArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const BATCH_SIZE = Math.max(1, Number(batchArg ? batchArg.split('=')[1] : 200) || 200);

async function collectAttachmentUrls(Expense) {
  // url -> set of organization ids referencing it
  const references = new Map();
  let lastId = null;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await Expense.findAll({
      where: {
        ...(lastId ? { id: { [Op.gt]: lastId } } : {}),
        [Op.or]: [{ file: { [Op.ne]: null } }, { fileCdnUrl: { [Op.ne]: null } }, { receiptUrl: { [Op.ne]: null } }],
      },
      attributes: ['id', 'organizationId', 'file', 'fileCdnUrl', 'receiptUrl'],
      order: [['id', 'ASC']],
      limit: BATCH_SIZE,
      paranoid: false, // soft-deleted expenses still own their files
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      for (const url of new Set([row.file, row.fileCdnUrl, row.receiptUrl].map((value) => String(value || '').trim()).filter(Boolean))) {
        if (!references.has(url)) references.set(url, new Set());
        references.get(url).add(row.organizationId);
      }
    }
    lastId = rows[rows.length - 1].id;
  }
  return references;
}

async function main() {
  await authenticateSequelize();
  const { Expense } = getModels();
  const references = await collectAttachmentUrls(Expense);
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${references.size} distinct attachment URL(s) referenced by expenses.\n`);

  const tally = {};
  const failures = [];
  const shared = [];
  for (const [url, organizations] of references) {
    if (organizations.size > 1) shared.push({ url, organizations: [...organizations] });
    try {
      // eslint-disable-next-line no-await-in-loop
      const { provider, status } = await makeStoredFilePrivate(url, { folder: 'expenses', dryRun: !apply });
      const label = `${provider || 'outside store'} / ${status}`;
      tally[label] = (tally[label] || 0) + 1;
    } catch (err) {
      failures.push({ url, error: err.message });
    }
  }

  console.log('Result by provider / status:');
  for (const [label, count] of Object.entries(tally).sort()) console.log(`  ${label.padEnd(36)} ${count}`);
  console.log('\nStatuses: would_make_private = public now (run with --apply); already_private = nothing to do;');
  console.log('not_found = file no longer exists; not_in_folder = external link or file outside the expense folder (left untouched).');

  if (shared.length) {
    // These rows predate server-controlled attachment URLs; the API refuses to serve them, review manually
    console.log(`\n${shared.length} file(s) are referenced by expenses in more than one organization:`);
    for (const entry of shared) console.log(`  ${entry.url}  orgs=${entry.organizations.join(',')}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} file(s) failed:`);
    for (const failure of failures) console.log(`  ${failure.url}  ${failure.error}`);
  }
  if (apply && Object.keys(tally).some((label) => label.startsWith('do_spaces / made_private'))) {
    console.log('\nSpaces objects were uploaded with "Cache-Control: public, max-age=31536000".');
    console.log('If the Spaces CDN is enabled, purge its cache so edge copies stop being served.');
  }
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await require('../src/sequelize').initSequelize().close().catch(() => {});
  });
