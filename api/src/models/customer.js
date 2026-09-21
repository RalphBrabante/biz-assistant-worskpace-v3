const { DataTypes, Model } = require('sequelize');

class Customer extends Model {}

function initCustomerModel(sequelize) {
  Customer.init(
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
      customerCode: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },
      type: {
        type: DataTypes.ENUM('individual', 'business'),
        allowNull: false,
        defaultValue: 'business',
      },
      name: {
        type: DataTypes.STRING(180),
        allowNull: false,
      },
      legalName: {
        type: DataTypes.STRING(180),
        allowNull: true,
      },
      taxId: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      contactPerson: {
        type: DataTypes.STRING(140),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
          isEmail: true,
        },
      },
      phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      mobile: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      addressLine1: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      addressLine2: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      state: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      postalCode: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      creditLimit: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
      },
      paymentTermsDays: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'blocked'),
        allowNull: false,
        defaultValue: 'active',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.UUID,
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
      modelName: 'Customer',
      tableName: 'customers',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['organization_id'] },
        { fields: ['name'] },
        { fields: ['tax_id'] },
        { fields: ['email'] },
        { fields: ['status'] },
        { fields: ['customer_code'] },
        { unique: true, fields: ['organization_id', 'tax_id'] },
      ],
    }
  );

  return Customer;
}

module.exports = {
  Customer,
  initCustomerModel,
};
