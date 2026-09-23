'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const reference = (model) => ({
      type: Sequelize.UUID, allowNull: true, references: { model, key: 'id' },
      onUpdate: 'CASCADE', onDelete: 'SET NULL',
    });
    await queryInterface.createTable('bug_reports', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
      organization_id: reference('organizations'),
      created_by: reference('users'),
      updated_by: reference('users'),
      title: { type: Sequelize.STRING(200), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      steps: { type: Sequelize.TEXT, allowNull: true },
      expected_result: { type: Sequelize.TEXT, allowNull: true },
      page_path: { type: Sequelize.STRING(500), allowNull: false },
      status: { type: Sequelize.ENUM('open', 'in_progress', 'resolved', 'dismissed'), allowNull: false, defaultValue: 'open' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('bug_reports', ['organization_id', 'status', 'created_at'], {name: 'bug_reports_org_status_created'});
    await queryInterface.addIndex('bug_reports', ['created_at'], {name: 'bug_reports_created'});
  },
  async down(queryInterface) {
    await queryInterface.dropTable('bug_reports');
  },
};
