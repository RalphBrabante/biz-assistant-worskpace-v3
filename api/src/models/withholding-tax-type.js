const { DataTypes, Model } = require('sequelize');

class WithholdingTaxType extends Model {}

function initWithholdingTaxTypeModel(sequelize) {
  WithholdingTaxType.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      percentage: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      appliesTo: {
        type: DataTypes.ENUM('expense', 'invoice', 'both'),
        allowNull: false,
        defaultValue: 'expense',
      },
      minimumBaseAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      isSystem: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'WithholdingTaxType',
      tableName: 'withholding_tax_types',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['organization_id', 'code'] },
        { fields: ['organization_id'] },
        { fields: ['name'] },
        { fields: ['percentage'] },
        { fields: ['applies_to'] },
        { fields: ['is_system'] },
        { fields: ['is_active'] },
        { fields: ['created_by'] },
        { fields: ['updated_by'] },
      ],
    }
  );

  return WithholdingTaxType;
}

module.exports = {
  WithholdingTaxType,
  initWithholdingTaxTypeModel,
};
