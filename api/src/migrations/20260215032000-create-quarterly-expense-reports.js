'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('quarterly_expense_reports', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'organizations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      year: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      quarter: {
        type: Sequelize.TINYINT,
        allowNull: false,
      },
      period_start: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      period_end: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      expense_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      tax_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      discount_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      total_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      generated_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      generated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('quarterly_expense_reports', ['organization_id', 'year', 'quarter'], {
      name: 'quarterly_expense_reports_org_year_quarter_uq',
      unique: true,
    });
    await queryInterface.addIndex('quarterly_expense_reports', ['organization_id'], {
      name: 'quarterly_expense_reports_organization_id',
    });
    await queryInterface.addIndex('quarterly_expense_reports', ['year', 'quarter'], {
      name: 'quarterly_expense_reports_year_quarter',
    });
    await queryInterface.addIndex('quarterly_expense_reports', ['generated_by'], {
      name: 'quarterly_expense_reports_generated_by',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('quarterly_expense_reports');
  },
};
