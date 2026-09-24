'use strict';
module.exports = {
  async up(q, S) {
    await q.addColumn('gmail_mailboxes', 'provider', {type: S.STRING(20), allowNull: false, defaultValue: 'gmail'});
    await q.addColumn('gmail_mailboxes', 'encrypted_password', {type: S.TEXT, allowNull: true});
    await q.addColumn('gmail_mailboxes', 'imap_state', {type: S.JSON, allowNull: true});
    await q.addColumn('email_tickets', 'external_thread_key', {type: S.STRING(100), allowNull: true});
    await q.addIndex('email_tickets', ['mailbox_id', 'external_thread_key'], {unique: true, name: 'tickets_external_thread'});
    await q.addColumn('ticket_messages', 'mailbox_id', {type: S.UUID, allowNull: true, references: {model: 'gmail_mailboxes', key: 'id'}, onDelete: 'SET NULL', onUpdate: 'CASCADE'});
    await q.addColumn('ticket_messages', 'external_message_key', {type: S.STRING(100), allowNull: true});
    await q.addIndex('ticket_messages', ['mailbox_id', 'external_message_key'], {unique: true, name: 'messages_external_identity'});
  },
  async down(q) {
    const [rows] = await q.sequelize.query("SELECT COUNT(*) AS total FROM gmail_mailboxes WHERE provider <> 'gmail'");
    if (Number(rows[0].total)) throw new Error('Export and remove Hostinger mailbox history before reverting Hostinger support.');
    await q.removeIndex('ticket_messages', 'messages_external_identity');
    await q.removeColumn('ticket_messages', 'external_message_key');
    await q.removeColumn('ticket_messages', 'mailbox_id');
    await q.removeIndex('email_tickets', 'tickets_external_thread');
    await q.removeColumn('email_tickets', 'external_thread_key');
    await q.removeColumn('gmail_mailboxes', 'imap_state');
    await q.removeColumn('gmail_mailboxes', 'encrypted_password');
    await q.removeColumn('gmail_mailboxes', 'provider');
  },
};
