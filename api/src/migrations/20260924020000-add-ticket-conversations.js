'use strict';
module.exports = {
  async up(q, S) {
    await q.addColumn('ticket_messages', 'envelope', {type: S.JSON, allowNull: true});
    const ref = table => ({type: S.UUID, allowNull: false, references: {model: table, key: 'id'}, onDelete: 'CASCADE', onUpdate: 'CASCADE'});
    await q.createTable('ticket_attachments', {
      id: {type: S.UUID, primaryKey: true, allowNull: false}, organization_id: ref('organizations'), ticket_id: ref('email_tickets'), message_id: ref('ticket_messages'),
      filename: {type: S.STRING(255), allowNull: false}, content_type: {type: S.STRING(255), allowNull: false}, size: {type: S.INTEGER.UNSIGNED, allowNull: false},
      content: {type: S.BLOB('long'), allowNull: true}, provider_attachment_id: {type: S.TEXT, allowNull: true}, unavailable: {type: S.BOOLEAN, allowNull: false, defaultValue: false},
      created_at: {type: S.DATE, allowNull: false}, updated_at: {type: S.DATE, allowNull: false},
    });
    await q.addIndex('ticket_attachments', ['organization_id', 'ticket_id', 'message_id'], {name: 'ticket_attachments_scope'});
  },
  async down(q) { await q.dropTable('ticket_attachments'); await q.removeColumn('ticket_messages', 'envelope'); },
};
