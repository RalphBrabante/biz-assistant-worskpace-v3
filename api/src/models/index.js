const { StorageMigration, StorageMigrationItem, initStorageMigrationModels } = require('./storage-migration');
const { initOrganizationModel, Organization } = require('./organization');
const { initUserModel, User } = require('./user');
const { initLicenseModel, License } = require('./license');
const {
  initOrganizationUserModel,
  OrganizationUser,
} = require('./organization-user');
const {
  initInvalidLoginAttemptModel,
  InvalidLoginAttempt,
} = require('./invalid-login-attempt');
const { initTokenModel, Token } = require('./token');
const { initRoleModel, Role } = require('./role');
const { initUserRoleModel, UserRole } = require('./user-role');
const { initItemModel, Item } = require('./item');
const { initPermissionModel, Permission } = require('./permission');
const { initRolePermissionModel, RolePermission } = require('./role-permission');
const {
  initPurchaseOrderModel,
  PurchaseOrder,
} = require('./purchase-order');
const { initVendorModel, Vendor } = require('./vendor');
const {
  initVendorOrganizationModel,
  VendorOrganization,
} = require('./vendor-organization');
const { initOrderModel, Order } = require('./order');
const { initOrderDocumentModel, OrderDocument } = require('./order-document');
const { initOrderDocumentUploadModel, OrderDocumentUpload } = require('./order-document-upload');
const { initSalesInvoiceModel, SalesInvoice } = require('./sales-invoice');
const { initExpenseModel, Expense } = require('./expense');
const { initCustomerModel, Customer } = require('./customer');
const {
  initWithholdingTaxTypeModel,
  WithholdingTaxType,
} = require('./withholding-tax-type');
const { initTaxTypeModel, TaxType } = require('./tax-type');
const {
  initOrderItemSnapshotModel,
  OrderItemSnapshot,
} = require('./order-item-snapshot');
const {
  initOrderActivityModel,
  OrderActivity,
} = require('./order-activity');
const {
  initQuarterlySalesReportModel,
  QuarterlySalesReport,
} = require('./quarterly-sales-report');
const {
  initQuarterlyExpenseReportModel,
  QuarterlyExpenseReport,
} = require('./quarterly-expense-report');
const { initAppSettingModel, AppSetting } = require('./app-setting');
const { initMessageModel, Message } = require('./message');
const { initBugReportModel, BugReport } = require('./bug-report');
const { initBugReportColumnModel, BugReportColumn } = require('./bug-report-column');

function initModels(sequelize) {
  initOrganizationModel(sequelize);
  initUserModel(sequelize);
  initLicenseModel(sequelize);
  initOrganizationUserModel(sequelize);
  initInvalidLoginAttemptModel(sequelize);
  initTokenModel(sequelize);
  initRoleModel(sequelize);
  initUserRoleModel(sequelize);
  initItemModel(sequelize);
  initPermissionModel(sequelize);
  initRolePermissionModel(sequelize);
  initPurchaseOrderModel(sequelize);
  initVendorModel(sequelize);
  initVendorOrganizationModel(sequelize);
  initOrderModel(sequelize);
  initOrderDocumentModel(sequelize);
  initOrderDocumentUploadModel(sequelize);
  initSalesInvoiceModel(sequelize);
  initExpenseModel(sequelize);
  initCustomerModel(sequelize);
  initWithholdingTaxTypeModel(sequelize);
  initTaxTypeModel(sequelize);
  initOrderItemSnapshotModel(sequelize);
  initOrderActivityModel(sequelize);
  initQuarterlySalesReportModel(sequelize);
  initQuarterlyExpenseReportModel(sequelize);
  initAppSettingModel(sequelize);
  initMessageModel(sequelize);
  initBugReportModel(sequelize);
  initBugReportColumnModel(sequelize);
  BugReportColumn.belongsTo(Organization, { foreignKey: 'organizationId', onDelete: 'SET NULL', onUpdate: 'CASCADE', as: 'organization' });
  BugReportColumn.belongsTo(User, { foreignKey: 'createdBy', onDelete: 'SET NULL', onUpdate: 'CASCADE', as: 'creator' });
  BugReport.belongsTo(Organization, { foreignKey: 'organizationId', onDelete: 'SET NULL', onUpdate: 'CASCADE', as: 'organization' });
  BugReport.belongsTo(User, { foreignKey: 'createdBy', onDelete: 'SET NULL', onUpdate: 'CASCADE', as: 'reporter' });
  BugReport.belongsTo(User, { foreignKey: 'updatedBy', onDelete: 'SET NULL', onUpdate: 'CASCADE', as: 'reviewer' });
  initStorageMigrationModels(sequelize);
  StorageMigration.belongsTo(User, { foreignKey: 'createdBy', onDelete: 'SET NULL', onUpdate: 'CASCADE', as: 'actor' });
  StorageMigration.hasMany(StorageMigrationItem, { foreignKey: 'migrationId', onDelete: 'CASCADE', onUpdate: 'CASCADE', as: 'items' });
  StorageMigrationItem.belongsTo(StorageMigration, { foreignKey: 'migrationId', onDelete: 'CASCADE', onUpdate: 'CASCADE', as: 'migration' });

  Organization.hasMany(User, {
    foreignKey: {
      name: 'organizationId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'primaryUsers',
  });

  User.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'primaryOrganization',
  });

  Organization.belongsToMany(User, {
    through: OrganizationUser,
    foreignKey: 'organizationId',
    otherKey: 'userId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'users',
  });

  User.belongsToMany(Organization, {
    through: OrganizationUser,
    foreignKey: 'userId',
    otherKey: 'organizationId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organizations',
  });

  Organization.hasMany(License, {
    foreignKey: {
      name: 'organizationId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'licenses',
  });

  License.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'organization',
  });

  User.hasMany(InvalidLoginAttempt, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'invalidLoginAttempts',
  });

  InvalidLoginAttempt.belongsTo(User, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'user',
  });

  User.hasMany(Token, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'tokens',
  });

  Token.belongsTo(User, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'user',
  });

  User.belongsToMany(Role, {
    through: UserRole,
    foreignKey: 'userId',
    otherKey: 'roleId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'roles',
  });

  Role.belongsToMany(User, {
    through: UserRole,
    foreignKey: 'roleId',
    otherKey: 'userId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'users',
  });

  User.hasMany(UserRole, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'userRoles',
  });

  UserRole.belongsTo(User, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'user',
  });

  Role.hasMany(UserRole, {
    foreignKey: {
      name: 'roleId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'userRoles',
  });

  UserRole.belongsTo(Role, {
    foreignKey: {
      name: 'roleId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'role',
  });

  User.hasMany(UserRole, {
    foreignKey: {
      name: 'assignedByUserId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'assignedUserRoles',
  });

  UserRole.belongsTo(User, {
    foreignKey: {
      name: 'assignedByUserId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'assignedBy',
  });

  Role.belongsToMany(Permission, {
    through: RolePermission,
    foreignKey: 'roleId',
    otherKey: 'permissionId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'permissions',
  });

  Permission.belongsToMany(Role, {
    through: RolePermission,
    foreignKey: 'permissionId',
    otherKey: 'roleId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'roles',
  });

  Role.hasMany(RolePermission, {
    foreignKey: {
      name: 'roleId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'rolePermissions',
  });

  RolePermission.belongsTo(Role, {
    foreignKey: {
      name: 'roleId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'role',
  });

  Permission.hasMany(RolePermission, {
    foreignKey: {
      name: 'permissionId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'rolePermissions',
  });

  RolePermission.belongsTo(Permission, {
    foreignKey: {
      name: 'permissionId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'permission',
  });

  User.hasMany(RolePermission, {
    foreignKey: {
      name: 'assignedByUserId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'assignedRolePermissions',
  });

  RolePermission.belongsTo(User, {
    foreignKey: {
      name: 'assignedByUserId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'assignedBy',
  });

  Organization.hasMany(Item, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'items',
  });

  Item.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  Vendor.hasMany(Item, {
    foreignKey: {
      name: 'vendorId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'items',
  });

  Item.belongsTo(Vendor, {
    foreignKey: {
      name: 'vendorId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'vendor',
  });

  User.hasMany(Item, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdItems',
  });

  Item.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Item, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedItems',
  });

  Item.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Organization.hasMany(PurchaseOrder, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'purchaseOrders',
  });

  PurchaseOrder.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(PurchaseOrder, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdPurchaseOrders',
  });

  PurchaseOrder.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(PurchaseOrder, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedPurchaseOrders',
  });

  PurchaseOrder.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  User.hasMany(PurchaseOrder, {
    foreignKey: {
      name: 'approvedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'approvedPurchaseOrders',
  });

  PurchaseOrder.belongsTo(User, {
    foreignKey: {
      name: 'approvedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'approver',
  });

  Organization.hasMany(Vendor, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'vendors',
  });

  Vendor.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  Vendor.hasMany(VendorOrganization, {
    foreignKey: {
      name: 'vendorId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organizationLinks',
  });

  VendorOrganization.belongsTo(Vendor, {
    foreignKey: {
      name: 'vendorId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'vendor',
  });

  Organization.hasMany(VendorOrganization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'vendorLinks',
  });

  VendorOrganization.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  VendorOrganization.belongsTo(User, {
    foreignKey: { name: 'createdBy', allowNull: true },
    onUpdate: 'CASCADE', onDelete: 'SET NULL', as: 'creator',
  });
  VendorOrganization.belongsTo(User, {
    foreignKey: { name: 'updatedBy', allowNull: true },
    onUpdate: 'CASCADE', onDelete: 'SET NULL', as: 'updater',
  });

  Vendor.belongsToMany(Organization, {
    through: VendorOrganization,
    foreignKey: 'vendorId',
    otherKey: 'organizationId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organizations',
  });

  Organization.belongsToMany(Vendor, {
    through: VendorOrganization,
    foreignKey: 'organizationId',
    otherKey: 'vendorId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'assignedVendors',
  });

  User.hasMany(Vendor, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdVendors',
  });

  Vendor.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Vendor, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedVendors',
  });

  Vendor.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Organization.hasMany(Order, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'orders',
  });

  Order.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(Order, {
    foreignKey: {
      name: 'userId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'orders',
  });

  Order.belongsTo(User, {
    foreignKey: {
      name: 'userId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'user',
  });

  User.hasMany(Order, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdOrders',
  });

  Order.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Order, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedOrders',
  });

  Order.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Customer.hasMany(Order, {
    foreignKey: {
      name: 'customerId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'orders',
  });

  Order.belongsTo(Customer, {
    foreignKey: {
      name: 'customerId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'customer',
  });

  WithholdingTaxType.hasMany(Order, {
    foreignKey: {
      name: 'withholdingTaxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'orders',
  });

  Order.belongsTo(WithholdingTaxType, {
    foreignKey: {
      name: 'withholdingTaxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'withholdingTaxType',
  });

  Order.hasMany(OrderItemSnapshot, {
    foreignKey: {
      name: 'orderId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'orderedItemSnapshots',
  });

  OrderItemSnapshot.belongsTo(Order, {
    foreignKey: {
      name: 'orderId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'order',
  });

  Item.hasMany(OrderItemSnapshot, {
    foreignKey: {
      name: 'itemId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'orderItemSnapshots',
  });

  OrderItemSnapshot.belongsTo(Item, {
    foreignKey: {
      name: 'itemId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'item',
  });

  Order.hasMany(OrderActivity, {
    foreignKey: {
      name: 'orderId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'activities',
  });

  OrderActivity.belongsTo(Order, {
    foreignKey: {
      name: 'orderId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'order',
  });

  Organization.hasMany(OrderActivity, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'orderActivities',
  });

  OrderActivity.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(OrderActivity, {
    foreignKey: {
      name: 'userId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'orderActivities',
  });

  OrderActivity.belongsTo(User, {
    foreignKey: {
      name: 'userId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'actor',
  });

  Organization.hasMany(SalesInvoice, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'salesInvoices',
  });

  SalesInvoice.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  Order.hasMany(SalesInvoice, {
    foreignKey: {
      name: 'orderId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'salesInvoices',
  });

  SalesInvoice.belongsTo(Order, {
    foreignKey: {
      name: 'orderId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'order',
  });

  User.hasMany(SalesInvoice, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdSalesInvoices',
  });

  SalesInvoice.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(SalesInvoice, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedSalesInvoices',
  });

  SalesInvoice.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Organization.hasMany(Expense, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'expenses',
  });

  Expense.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  Vendor.hasMany(Expense, {
    foreignKey: {
      name: 'vendorId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'expenses',
  });

  Expense.belongsTo(Vendor, {
    foreignKey: {
      name: 'vendorId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'vendor',
  });

  TaxType.hasMany(Expense, {
    foreignKey: {
      name: 'taxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'expenses',
  });

  Expense.belongsTo(TaxType, {
    foreignKey: {
      name: 'taxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'taxType',
  });

  TaxType.hasMany(Organization, {
    foreignKey: {
      name: 'taxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'organizations',
  });

  Organization.belongsTo(TaxType, {
    foreignKey: {
      name: 'taxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'taxType',
  });

  User.hasMany(Expense, {
    foreignKey: {
      name: 'approvedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'approvedExpenses',
  });

  Expense.belongsTo(User, {
    foreignKey: {
      name: 'approvedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'approver',
  });

  Organization.hasMany(Customer, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'customers',
  });

  Customer.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(Customer, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdCustomers',
  });

  Customer.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Customer, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedCustomers',
  });

  Customer.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  User.hasMany(Expense, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdExpenses',
  });

  Expense.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Expense, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedExpenses',
  });

  Expense.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Organization.hasMany(WithholdingTaxType, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'withholdingTaxTypes',
  });

  WithholdingTaxType.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(WithholdingTaxType, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdWithholdingTaxTypes',
  });

  WithholdingTaxType.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(WithholdingTaxType, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedWithholdingTaxTypes',
  });

  WithholdingTaxType.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  WithholdingTaxType.hasMany(Expense, {
    foreignKey: {
      name: 'withholdingTaxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'expenses',
  });

  Expense.belongsTo(WithholdingTaxType, {
    foreignKey: {
      name: 'withholdingTaxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'withholdingTaxType',
  });

  WithholdingTaxType.hasMany(SalesInvoice, {
    foreignKey: {
      name: 'withholdingTaxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'salesInvoices',
  });

  SalesInvoice.belongsTo(WithholdingTaxType, {
    foreignKey: {
      name: 'withholdingTaxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'withholdingTaxType',
  });

  Organization.hasMany(QuarterlySalesReport, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'quarterlySalesReports',
  });

  QuarterlySalesReport.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(QuarterlySalesReport, {
    foreignKey: {
      name: 'generatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'generatedQuarterlySalesReports',
  });

  QuarterlySalesReport.belongsTo(User, {
    foreignKey: {
      name: 'generatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'generatedByUser',
  });

  Organization.hasMany(QuarterlyExpenseReport, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'quarterlyExpenseReports',
  });

  QuarterlyExpenseReport.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(QuarterlyExpenseReport, {
    foreignKey: {
      name: 'generatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'generatedQuarterlyExpenseReports',
  });

  QuarterlyExpenseReport.belongsTo(User, {
    foreignKey: {
      name: 'generatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'generatedByUser',
  });

  User.hasMany(AppSetting, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedAppSettings',
  });

  AppSetting.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedByUser',
  });

  Organization.hasMany(Message, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'messages',
  });

  Message.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(Message, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdMessages',
  });

  Message.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  return {
    Organization,
    User,
    License,
    OrganizationUser,
    InvalidLoginAttempt,
    Token,
    Role,
    UserRole,
    Item,
    Permission,
    RolePermission,
    PurchaseOrder,
    Vendor,
    VendorOrganization,
    Order,
    OrderDocument,
    OrderDocumentUpload,
    SalesInvoice,
    Expense,
    Customer,
    WithholdingTaxType,
    TaxType,
    OrderItemSnapshot,
    OrderActivity,
    QuarterlySalesReport,
    QuarterlyExpenseReport,
    AppSetting,
    StorageMigration,
    StorageMigrationItem,
    Message,
    BugReport,
    BugReportColumn,
  };
}

module.exports = {
  initModels,
};
