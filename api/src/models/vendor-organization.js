const { DataTypes, Model } = require('sequelize');

class VendorOrganization extends Model {}

function initVendorOrganizationModel(sequelize) {
  VendorOrganization.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      vendorId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      isOwner: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
      modelName: 'VendorOrganization',
      tableName: 'vendor_organizations',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['vendor_id', 'organization_id'], name: 'vendor_organizations_vendor_id_organization_id_unique' },
        { fields: ['vendor_id'] },
        { fields: ['organization_id'] },
        { fields: ['is_owner'] },
      ],
    }
  );

  return VendorOrganization;
}

module.exports = {
  VendorOrganization,
  initVendorOrganizationModel,
};
