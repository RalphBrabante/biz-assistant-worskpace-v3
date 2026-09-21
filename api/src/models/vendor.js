const { DataTypes, Model } = require('sequelize');

class Vendor extends Model {}

function initVendorModel(sequelize) {
  Vendor.init(
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
      name: {
        type: DataTypes.STRING(180),
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
      category: {
        type: DataTypes.ENUM('goods', 'operations', 'others'),
        allowNull: false,
        defaultValue: 'others',
      },
      contactPerson: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      contactEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        set(value) {
          this.setDataValue('contactEmail', typeof value === 'string' ? value.trim() || null : value);
        },
        validate: {
          isEmail: true,
        },
      },
      phone: {
        type: DataTypes.STRING(50),
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
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      state: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      barangay: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      province: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      postalCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      paymentTerms: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'blocked'),
        allowNull: false,
        defaultValue: 'active',
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
      modelName: 'Vendor',
      tableName: 'vendors',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['organization_id', 'tax_id'], name: 'vendors_organization_id_tax_id_unique' },
        { fields: ['organization_id'] },
        { fields: ['name'] },
        { fields: ['contact_email'] },
        { fields: ['status'] },
        { fields: ['category'] },
        { fields: ['created_by'] },
        { fields: ['updated_by'] },
      ],
    }
  );

  return Vendor;
}

module.exports = {
  Vendor,
  initVendorModel,
};
