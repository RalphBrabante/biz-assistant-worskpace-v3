'use strict';

module.exports = {
  async up(q, S) {
    for (const field of ['reply_to_message_id', 'reply_sender_user_id', 'reply_recipient_user_id']) {
      await q.addColumn('chat_messages', field, { type: S.UUID, allowNull: true });
    }
    await q.addIndex('chat_messages', ['organization_id', 'id', 'sender_user_id', 'recipient_user_id'], {
      unique: true, name: 'chat_messages_reply_target_unique',
    });
    // The reference and check jointly enforce the same organization and pair,
    // allowing a reply to either an incoming or an outgoing message.
    await q.addConstraint('chat_messages', {
      fields: ['organization_id', 'reply_to_message_id', 'reply_sender_user_id', 'reply_recipient_user_id'],
      type: 'foreign key', name: 'chat_messages_reply_fk',
      references: { table: 'chat_messages', fields: ['organization_id', 'id', 'sender_user_id', 'recipient_user_id'] },
      onDelete: 'RESTRICT', onUpdate: 'RESTRICT',
    });
    await q.sequelize.query(`ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_reply_pair CHECK (
      (reply_to_message_id IS NULL AND reply_sender_user_id IS NULL AND reply_recipient_user_id IS NULL) OR
      (reply_to_message_id IS NOT NULL AND reply_sender_user_id IS NOT NULL AND reply_recipient_user_id IS NOT NULL AND
        ((reply_sender_user_id = sender_user_id AND reply_recipient_user_id = recipient_user_id) OR
         (reply_sender_user_id = recipient_user_id AND reply_recipient_user_id = sender_user_id))))`);
  },
  async down(q) {
    await q.sequelize.query('ALTER TABLE chat_messages DROP CHECK chat_messages_reply_pair');
    await q.removeConstraint('chat_messages', 'chat_messages_reply_fk');
    // MySQL creates the referencing index with the foreign key's name.
    await q.removeIndex('chat_messages', 'chat_messages_reply_fk');
    await q.removeIndex('chat_messages', 'chat_messages_reply_target_unique');
    for (const field of ['reply_to_message_id', 'reply_sender_user_id', 'reply_recipient_user_id']) await q.removeColumn('chat_messages', field);
  },
};
