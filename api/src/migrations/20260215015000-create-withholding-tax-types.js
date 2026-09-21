'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('withholding_tax_types', {
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
      code: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      percentage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      applies_to: {
        type: Sequelize.ENUM('expense', 'invoice', 'both'),
        allowNull: false,
        defaultValue: 'expense',
      },
      minimum_base_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      updated_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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

    await queryInterface.addIndex('withholding_tax_types', ['organization_id', 'code'], {
      name: 'withholding_tax_types_organization_id_code_uq',
      unique: true,
    });
    await queryInterface.addIndex('withholding_tax_types', ['organization_id'], {
      name: 'withholding_tax_types_organization_id',
    });
    await queryInterface.addIndex('withholding_tax_types', ['name'], {
      name: 'withholding_tax_types_name',
    });
    await queryInterface.addIndex('withholding_tax_types', ['percentage'], {
      name: 'withholding_tax_types_percentage',
    });
    await queryInterface.addIndex('withholding_tax_types', ['applies_to'], {
      name: 'withholding_tax_types_applies_to',
    });
    await queryInterface.addIndex('withholding_tax_types', ['is_active'], {
      name: 'withholding_tax_types_is_active',
    });
    await queryInterface.addIndex('withholding_tax_types', ['created_by'], {
      name: 'withholding_tax_types_created_by',
    });
    await queryInterface.addIndex('withholding_tax_types', ['updated_by'], {
      name: 'withholding_tax_types_updated_by',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('withholding_tax_types');
  },
};
