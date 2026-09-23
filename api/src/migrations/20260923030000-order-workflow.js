'use strict';
const { randomUUID } = require('crypto');
module.exports = {
  async up(q, S) {
    const add = async (table, column, definition) => {
      if (!(await q.describeTable(table))[column]) await q.addColumn(table, column, definition);
    };
    await add('orders', 'workflow', { type: S.JSON, allowNull: true });
    await add('orders', 'revision', { type: S.INTEGER, allowNull: false, defaultValue: 0 });
    await add('orders', 'request_key', { type: S.UUID, allowNull: true });
    await add('orders', 'customer_po_number', { type: S.STRING(120), allowNull: true });
    await add('orders', 'promised_date', { type: S.DATEONLY, allowNull: true });
    await add('orders', 'invoicing_status', { type: S.STRING(24), allowNull: false, defaultValue: 'not_invoiced' });
    if (!(await q.showIndex('orders')).some(i => i.name === 'orders_org_request_key')) {
      await q.addIndex('orders', ['organization_id', 'request_key'], { unique: true, name: 'orders_org_request_key' });
    }
    await add('customers', 'requires_purchase_order', { type: S.BOOLEAN, allowNull: false, defaultValue: false });
    await add('organizations', 'order_workflow_settings', { type: S.JSON, allowNull: true });
    await q.changeColumn('items', 'stock', { type: S.DECIMAL(12, 3), allowNull: false, defaultValue: 0 });
    // An ordinary index must exist before removing a unique index supporting the FK.
    if (!(await q.showIndex('sales_invoices')).some(i => i.name === 'sales_invoices_order_workflow')) {
      await q.addIndex('sales_invoices', ['order_id'], { name: 'sales_invoices_order_workflow' });
    }
    for (const index of await q.showIndex('sales_invoices')) {
      if (index.unique && index.fields.length === 1 && index.fields[0].attribute === 'order_id') await q.removeIndex('sales_invoices', index.name);
    }
    if (!(await q.showAllTables()).includes('order_documents')) {
      await q.createTable('order_documents', {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        order_id: { type: S.UUID, allowNull: false, references: { model: 'orders', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        name: { type: S.STRING(180), allowNull: false }, mime_type: { type: S.STRING(80), allowNull: false },
        size: { type: S.INTEGER, allowNull: false }, content: { type: S.BLOB('medium'), allowNull: false },
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      });
    }
    for (const action of ['approve', 'verify_po', 'override_price', 'configure', 'reconcile', 'refund']) {
      const code = `orders.${action}`;
      const [existing] = await q.sequelize.query('SELECT id FROM permissions WHERE code = :code', { replacements: { code } });
      if (!existing.length) await q.bulkInsert('permissions', [{ id: randomUUID(), code, name: `Orders: ${action.replace(/_/g, ' ')}`, resource: 'orders', action, is_system: true, is_active: true, created_at: new Date(), updated_at: new Date() }]);
    }
    await q.sequelize.query("UPDATE orders o SET invoicing_status = CASE WHEN (SELECT COALESCE(SUM(i.total_amount), 0) FROM sales_invoices i WHERE i.order_id = o.id AND i.status <> 'void') >= o.total_amount AND EXISTS(SELECT 1 FROM sales_invoices i WHERE i.order_id = o.id AND i.status <> 'void') THEN 'invoiced' WHEN EXISTS(SELECT 1 FROM sales_invoices i WHERE i.order_id = o.id AND i.status <> 'void') THEN 'partially_invoiced' ELSE 'not_invoiced' END");
  },
  async down() {
    throw new Error('Order workflow stores financial and PO history. Restore a verified backup to roll back this migration.');
  },
};
