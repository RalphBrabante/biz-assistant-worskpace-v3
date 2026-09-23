'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('bug_report_columns')) {
      await queryInterface.createTable('bug_report_columns', {
        id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        organization_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'organizations', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
        name: { type: Sequelize.STRING(60), allowNull: false },
        color: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'violet' },
        created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }
    const indexes = await queryInterface.showIndex('bug_report_columns');
    if (!indexes.some(index => index.name === 'bug_report_columns_org_name')) {
      await queryInterface.addIndex('bug_report_columns', ['organization_id', 'name'], { unique: true, name: 'bug_report_columns_org_name' });
    }
    // Existing status strings and reports remain intact; custom statuses use column UUIDs.
    await queryInterface.changeColumn('bug_reports', 'status', { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'open' });
  },
  async down(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query("SELECT COUNT(*) AS total FROM bug_reports WHERE status NOT IN ('open', 'in_progress', 'resolved', 'dismissed')");
    if (Number(rows[0].total)) throw new Error('Move reports out of custom columns before reverting the bug report board migration.');
    await queryInterface.changeColumn('bug_reports', 'status', { type: Sequelize.ENUM('open', 'in_progress', 'resolved', 'dismissed'), allowNull: false, defaultValue: 'open' });
    await queryInterface.dropTable('bug_report_columns');
  },
};
