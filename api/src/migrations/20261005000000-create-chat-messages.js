'use strict';

module.exports = {
  async up(q, S) {
    await q.createTable('chat_messages', {
      id: { type: S.UUID, allowNull: false, primaryKey: true },
      organization_id: { type: S.UUID, allowNull: false, references: { model: 'organizations', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' },
      sender_user_id: { type: S.UUID, allowNull: false },
      recipient_user_id: { type: S.UUID, allowNull: false },
      client_message_id: { type: S.UUID, allowNull: false },
      body: { type: S.TEXT, allowNull: false },
      read_at: { type: S.DATE, allowNull: true },
      created_at: { type: S.DATE(3), allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP(3)') },
      updated_at: { type: S.DATE(3), allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP(3)') },
    }, { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' });
    // A user FK alone would allow participants from unrelated organizations.
    // Both participant pairs must reference the same organization's membership.
    for (const participant of ['sender', 'recipient']) {
      await q.addConstraint('chat_messages', {
        fields: ['organization_id', `${participant}_user_id`], type: 'foreign key',
        name: `chat_messages_${participant}_membership_fk`,
        references: { table: 'organization_users', fields: ['organization_id', 'user_id'] },
        onDelete: 'RESTRICT', onUpdate: 'RESTRICT',
      });
    }
    await q.addIndex('chat_messages', ['organization_id', 'sender_user_id', 'client_message_id'], { unique: true, name: 'chat_messages_retry_unique' });
    await q.addIndex('chat_messages', ['organization_id', 'sender_user_id', 'recipient_user_id', 'created_at', 'id'], { name: 'chat_messages_history' });
    await q.addIndex('chat_messages', ['organization_id', 'recipient_user_id', 'sender_user_id', 'created_at', 'id'], { name: 'chat_messages_incoming_history' });
    await q.addIndex('chat_messages', ['organization_id', 'recipient_user_id', 'read_at', 'sender_user_id'], { name: 'chat_messages_unread' });
    await q.sequelize.query('ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_distinct_users CHECK (sender_user_id <> recipient_user_id)');
    await q.sequelize.query('ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_body_length CHECK (CHAR_LENGTH(TRIM(body)) BETWEEN 1 AND 4000)');
  },
  async down(q) { await q.dropTable('chat_messages'); },
};
