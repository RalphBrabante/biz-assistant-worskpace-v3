'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pricing_requests', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      request_key_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      dedupe_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      payload_hash: { type: Sequelize.STRING(64), allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false },
      email: { type: Sequelize.STRING(254), allowNull: false },
      firm_name: { type: Sequelize.STRING(160), allowNull: true },
      marketing_consent: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      catalogue_version: { type: Sequelize.STRING(80), allowNull: false },
      selection_snapshot: { type: Sequelize.JSON, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('pricing_requests', ['created_at']);
    await queryInterface.createTable('pricing_request_limits', {
      id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
      attempts: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('pricing_request_limits', ['expires_at']);
  },
  async down(queryInterface) {
    await queryInterface.dropTable('pricing_request_limits');
    await queryInterface.dropTable('pricing_requests');
  },
};
