'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('report_documents', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
      organization_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      document_code: { type: Sequelize.STRING(30), allowNull: false },
      title: { type: Sequelize.STRING(255), allowNull: false },
      year: { type: Sequelize.INTEGER, allowNull: false },
      quarter: { type: Sequelize.INTEGER, allowNull: true },
      filename: { type: Sequelize.STRING(255), allowNull: false },
      byte_length: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      sha256: { type: Sequelize.STRING(64), allowNull: false },
      source_revision: { type: Sequelize.STRING(128), allowNull: false },
      pdf_content: { type: Sequelize.BLOB('long'), allowNull: false },
      generated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      generated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('report_documents', ['organization_id', 'year', 'generated_at'], { name: 'report_documents_org_year_generated' });
  },
  async down(queryInterface) { await queryInterface.dropTable('report_documents'); },
};
