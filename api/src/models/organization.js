const { DataTypes, Model } = require('sequelize');

class Organization extends Model {}

function initOrganizationModel(sequelize) {
  Organization.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      legalName: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      taxId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      addressLine1: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      addressLine2: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      state: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      postalCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'United States',
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'PHP',
      },
      taxTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      taxpayerClassification: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      deductionMethod: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'itemized',
      },
      incomeTaxRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
      },
      isIncomeTaxExempt: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      contactEmail: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          isEmail: true,
        },
      },
      phone: {
        type: DataTypes.STRING(30),
        allowNull: false,
      },
      website: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
          isUrl: true,
        },
      },
      contactName: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      industry: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      employeeCount: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'Organization',
      tableName: 'organizations',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['name'] },
        { fields: ['contact_email'] },
        { fields: ['tax_type_id'] },
        { fields: ['taxpayer_classification'] },
      ],
    }
  );

  return Organization;
}

module.exports = {
  Organization,
  initOrganizationModel,
};
