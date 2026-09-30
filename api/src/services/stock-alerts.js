const { getSocketServer } = require('./socket-service');

function stockStatus(item) {
  if (item.type !== 'product' || item.isActive === false) return 'normal';
  const stock = Number(item.stock);
  if (stock <= 0) return 'out';
  const threshold = Number(item.reorderLevel || 0);
  return threshold > 0 && stock <= threshold ? 'low' : 'normal';
}

// Called inside the same transaction as the inventory write. State transitions
// prevent repeated warnings while an item stays low; restocking rearms alerts.
async function notifyStockChange(item, options = {}) {
  const state = stockStatus(item);
  const before = options.stockCreated ? 'normal' : stockStatus(item._previousDataValues);
  if (state === 'normal' || state === before) return;
  const Message = item.sequelize.models.Message;
  if (!Message) throw new Error('Stock notification storage is unavailable.');
  const out = state === 'out';
  const message = await Message.create({
    organizationId: item.organizationId,
    entityType: 'item', entityId: item.id,
    title: out ? 'Item out of stock' : 'Item running low',
    message: `${item.name}${item.sku ? ` (${item.sku})` : ''}: ${Number(item.stock)} ${item.unit || 'units'} remaining. Low-stock threshold: ${Number(item.reorderLevel || 0)}.`,
    // No actor exclusion: stock warnings concern every organization member.
    createdBy: null,
    metadata: { kind: 'stock_alert', status: state, stock: Number(item.stock), threshold: Number(item.reorderLevel || 0), sku: item.sku || null },
  }, { transaction: options.transaction });
  const broadcast = () => {
    try { getSocketServer()?.to(`org:${item.organizationId}`).emit('message.created', message.toJSON()); }
    catch (error) { console.error('Stock alert broadcast failed:', error.message); }
  };
  if (options.transaction) options.transaction.afterCommit(broadcast);
  else broadcast();
}

function validateInventory(item) {
  for (const [field, maximum] of [['stock', 999999999], ['reorderLevel', 2147483647]]) {
    const raw = item[field], value = Number(raw);
    if (raw === null || (typeof raw !== 'number' && typeof raw !== 'string') || String(raw).trim() === '' || typeof raw === 'boolean' || !Number.isFinite(value) || value < 0 || value > maximum || !Number.isInteger(value)) {
      const error = new Error(field === 'stock' ? 'Stock must be a non-negative whole number (maximum 999999999).' : 'Low-stock threshold must be a non-negative whole number.');
      error.status = 400;
      throw error;
    }
  }
}
module.exports = { stockStatus, notifyStockChange, validateInventory };
