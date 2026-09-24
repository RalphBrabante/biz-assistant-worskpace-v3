'use strict';
const { randomUUID } = require('crypto');
module.exports = {
  async up(q, S) {
    const id = () => ({type: S.UUID, primaryKey: true, allowNull: false});
    const ref = (model, nullable = true) => ({type: S.UUID, allowNull: nullable, references: {model, key: 'id'}, onUpdate: 'CASCADE', onDelete: nullable ? 'SET NULL' : 'CASCADE'});
    const timestamps = () => ({created_at: {type: S.DATE, allowNull: false}, updated_at: {type: S.DATE, allowNull: false}});
    await q.createTable('gmail_mailboxes', {id: id(), organization_id: ref('organizations', false), email: {type: S.STRING(255), allowNull: false}, encrypted_refresh_token: S.TEXT, last_synced_at: S.DATE, sync_started_at: S.DATE, page_token: S.TEXT, last_error: S.STRING(500), ...timestamps()});
    await q.addIndex('gmail_mailboxes', ['organization_id'], {unique: true});
    await q.addIndex('gmail_mailboxes', ['email'], {unique: true});
    await q.createTable('gmail_oauth_states', {id: {type: S.STRING(64), primaryKey: true}, organization_id: ref('organizations', false), user_id: ref('users', false), expires_at: {type: S.DATE, allowNull: false}, ...timestamps()});
    await q.createTable('email_tickets', {id: id(), organization_id: ref('organizations', false), mailbox_id: ref('gmail_mailboxes'), gmail_thread_id: S.STRING(100), subject: {type: S.STRING(500), allowNull: false}, requester_email: {type: S.STRING(255), allowNull: false}, customer_id: ref('customers'), assignee_id: ref('users'), status: {type: S.STRING(20), defaultValue: 'open', allowNull: false}, priority: {type: S.INTEGER, defaultValue: 2, allowNull: false}, due_at: S.DATE, last_message_at: S.DATE, version: {type: S.INTEGER, defaultValue: 0, allowNull: false}, ...timestamps()});
    await q.addIndex('email_tickets', ['mailbox_id', 'gmail_thread_id'], {unique: true});
    for (const fields of [['organization_id', 'status', 'last_message_at'], ['organization_id', 'customer_id'], ['organization_id', 'assignee_id']]) await q.addIndex('email_tickets', fields);
    await q.createTable('ticket_messages', {id: id(), organization_id: ref('organizations', false), ticket_id: ref('email_tickets', false), kind: {type: S.STRING(20), allowNull: false}, body: {type: S.TEXT('medium'), allowNull: false}, sender: S.STRING(255), created_by: ref('users'), gmail_message_id: S.STRING(100), internet_message_id: S.STRING(998), request_key: S.UUID, delivery_status: S.STRING(20), sent_at: S.DATE, ...timestamps()});
    await q.addIndex('ticket_messages', ['ticket_id', 'gmail_message_id'], {unique: true});
    await q.addIndex('ticket_messages', ['ticket_id', 'request_key'], {unique: true});
    await q.addIndex('ticket_messages', ['ticket_id', 'created_at']);
    const now = new Date();
    const [existing] = await q.sequelize.query("SELECT code FROM permissions WHERE code IN ('tickets.read', 'tickets.manage', 'tickets.reply')");
    const actions = ['read', 'manage', 'reply'].filter(action => !existing.some(row => row.code === `tickets.${action}`));
    if (actions.length) await q.bulkInsert('permissions', actions.map(action => ({id: randomUUID(), name: `Tickets: ${action}`, code: `tickets.${action}`, resource: 'tickets', action, description: `Access email tickets: ${action}`, is_system: true, is_active: true, created_at: now, updated_at: now})));
  },
  async down(q) {
    // Keep system permission definitions: existing database triggers forbid deleting them.
    // A later re-application reuses these definitions and any role grants.
    for (const table of ['ticket_messages', 'email_tickets', 'gmail_oauth_states', 'gmail_mailboxes']) await q.dropTable(table);
  },
};
