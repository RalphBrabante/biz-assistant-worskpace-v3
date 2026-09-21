const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const { getOrganizationCurrency } = require('../services/organization-currency');
const { sendOrderCreatedEmail } = require('../services/email-service');
const {
  createOrganizationMessage,
  getActorDisplayName,
} = require('../services/message-service');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  getScopedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');
const {
  isPercentageTaxType,
  isVatTaxType,
} = require('../services/tax-calculation');

function buildOrderPreviewUrl(orderId) {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  return `${appBaseUrl.replace(/\/+$/, '')}/orders/${encodeURIComponent(orderId)}`;
}

function hasRoleCode(user, roleCodes = [], membershipRole = '') {
  const allowed = roleCodes.map((value) => String(value || '').toLowerCase());
  const primaryRole = String(user?.role || '').toLowerCase();
  if (primaryRole && allowed.includes(primaryRole)) {
    return true;
  }
  const orgMembershipRole = String(membershipRole || '').toLowerCase();
  if (orgMembershipRole && allowed.includes(orgMembershipRole)) {
    return true;
  }
  const memberships = Array.isArray(user?.roles) ? user.roles : [];
  return memberships.some((role) =>
    allowed.includes(String(role?.code || '').toLowerCase())
  );
}

async function notifyOrderCreated(models, order) {
  if (!models?.Organization || !models?.Role || !models?.User || !order?.organizationId || !order?.id) {
    return;
  }

  const organization = await models.Organization.findByPk(order.organizationId);
  if (!organization) {
    return;
  }

  const orgUsers = await organization.getUsers({
    attributes: ['id', 'email', 'firstName', 'lastName', 'role', 'isActive'],
    through: {
      where: { isActive: true },
      attributes: ['role', 'isActive'],
    },
    include: [
      {
        model: models.Role,
        as: 'roles',
        through: { attributes: [] },
        required: false,
      },
    ],
  });

  // Some legacy/current records are scoped only by users.organizationId and may not exist in organization_users.
  // Include them so notifications still reach eligible roles.
  const primaryUsers = await models.User.findAll({
    where: {
      organizationId: order.organizationId,
      isActive: true,
    },
    attributes: ['id', 'email', 'firstName', 'lastName', 'role', 'isActive'],
    include: [
      {
        model: models.Role,
        as: 'roles',
        through: { attributes: [] },
        required: false,
      },
    ],
  });

  const recipients = [];
  const seenEmails = new Set();
  const candidates = [...(orgUsers || []), ...(primaryUsers || [])];
  for (const user of candidates) {
    const email = String(user?.email || '').toLowerCase().trim();
    if (!user?.isActive || !email || seenEmails.has(email)) {
      continue;
    }
    const membershipRole = String(user?.OrganizationUser?.role || '').toLowerCase();
    if (!hasRoleCode(user, ['administrator', 'inventorymanager', 'inventory_manager'], membershipRole)) {
      continue;
    }
    seenEmails.add(email);
    recipients.push({
      email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || email,
    });
  }

  if (recipients.length === 0) {
    console.warn(
      'Order created notification skipped: no recipients matched administrator/inventorymanager roles.',
      { organizationId: order.organizationId, orderId: order.id }
    );
    return;
  }

  const orderUrl = buildOrderPreviewUrl(order.id);
  const organizationName = organization.name || organization.legalName || 'your organization';
  const orderNumber = order.orderNumber || order.id;

  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      sendOrderCreatedEmail({
        toEmail: recipient.email,
        toName: recipient.name,
        organizationName,
        orderNumber,
        orderUrl,
      })
    )
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.error('Order created email notifications had failures:', {
      organizationId: order.organizationId,
      orderId: order.id,
      attempted: recipients.length,
      failed: failures.length,
      reasons: failures.map((result) => String(result.reason?.message || result.reason || 'unknown')),
    });
  }
}

function getOrderModel() {
  const models = getModels();
  if (!models || !models.Order) {
    return null;
  }
  return models.Order;
}

function pickOrderPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    orderNumber: body.orderNumber,
    userId: body.userId,
    customerId: body.customerId,
    source: body.source,
    status: body.status,
    paymentStatus: body.paymentStatus,
    fulfillmentStatus: body.fulfillmentStatus,
    orderDate: body.orderDate,
    dueDate: body.dueDate,
    currency: body.currency,
    subtotalAmount: body.subtotalAmount,
    taxAmount: body.taxAmount,
    withHoldingTaxAmount: body.withHoldingTaxAmount,
    withholdingTaxTypeId: body.withholdingTaxTypeId,
    discountAmount: body.discountAmount,
    shippingAmount: body.shippingAmount,
    totalAmount: body.totalAmount,
    billingAddress: body.billingAddress,
    shippingAddress: body.shippingAddress,
    notes: body.notes,
    paidAt: body.paidAt,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
  };
}

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toFixed2(value) {
  return Number(normalizeNumber(value).toFixed(2));
}

function toFixed3(value) {
  return Number(normalizeNumber(value).toFixed(3));
}

function buildSnapshotFromItem(item, orderedItem = {}, taxType = {}) {
  // Snapshot rows preserve pricing/tax values at order time so historical orders stay immutable.
  const quantity = toFixed3(orderedItem.quantity || 1);
  const unitPrice = toFixed2(item.price);
  const discountedUnitPrice =
    item.discountedPrice === null || item.discountedPrice === undefined
      ? null
      : toFixed2(item.discountedPrice);
  const effectiveUnitPrice =
    discountedUnitPrice !== null ? discountedUnitPrice : unitPrice;
  const taxRate = isVatTaxType(taxType) ? toFixed2(taxType.percentage || 0) : 0;
  const lineSubtotal = toFixed2(unitPrice * quantity);
  const lineDiscount = toFixed2((unitPrice - effectiveUnitPrice) * quantity);
  const lineGross = toFixed2(effectiveUnitPrice * quantity);
  const lineTaxableAmount = taxRate > 0
    ? toFixed2(lineGross / (1 + taxRate / 100))
    : lineGross;
  const lineTax = taxRate > 0
    ? toFixed2(lineTaxableAmount * (taxRate / 100))
    : 0;
  const lineTotal = lineGross;

  return {
    itemId: item.id,
    sku: item.sku || null,
    name: item.name,
    description: item.description || null,
    type: item.type,
    unit: item.unit,
    currency: item.currency,
    unitPrice,
    discountedUnitPrice,
    taxRate,
    quantity,
    lineSubtotal,
    lineDiscount,
    lineTax,
    lineTotal,
    metadata: orderedItem.metadata || null,
  };
}

function computeOrderTotals(snapshotRows = [], shippingAmount = 0, taxType = {}) {
  // Order totals are computed from snapshot lines, not current item rows.
  // This prevents historical totals from drifting when item prices are changed later.
  const subtotalAmount = toFixed2(
    snapshotRows.reduce((sum, row) => sum + normalizeNumber(row.lineTotal), 0)
  );
  const discountAmount = toFixed2(
    snapshotRows.reduce((sum, row) => sum + normalizeNumber(row.lineDiscount), 0)
  );
  const vatRate = isVatTaxType(taxType) ? Number(taxType.percentage || 0) : 0;
  const taxableAmount = vatRate > 0
    ? toFixed2(subtotalAmount / (1 + vatRate / 100))
    : subtotalAmount;
  const taxAmount = vatRate > 0
    ? toFixed2(taxableAmount * (vatRate / 100))
    : 0;
  const safeShipping = toFixed2(shippingAmount);
  const totalAmount = toFixed2(subtotalAmount + safeShipping);

  return {
    subtotalAmount,
    taxableAmount,
    taxAmount,
    discountAmount,
    shippingAmount: safeShipping,
    totalAmount,
  };
}

async function resolveWithholdingRate({
  requestedWithholdingTaxTypeId = null,
  organizationId,
  WithholdingTaxType,
  transaction,
}) {
  // Withholding tax selection is optional. When omitted, we treat rate as 0.
  const withholdingTaxTypeId = String(requestedWithholdingTaxTypeId || '').trim();
  if (!withholdingTaxTypeId) {
    return { withholdingTaxTypeId: null, withholdingPercentage: 0 };
  }

  const withholdingTaxType = await WithholdingTaxType.findOne({
    where: {
      id: withholdingTaxTypeId,
      organizationId,
      isActive: true,
    },
    transaction,
  });

  if (!withholdingTaxType) {
    throw new Error('withholdingTaxTypeId is invalid for this organization.');
  }

  return {
    withholdingTaxTypeId: withholdingTaxType.id,
    withholdingPercentage: Number(withholdingTaxType.percentage || 0),
  };
}

function buildStockDemand(entries = [], itemById = new Map()) {
  const demandByItemId = new Map();

  for (const entry of entries) {
    const item = itemById.get(entry.itemId);
    if (!item) {
      continue;
    }

    // Services do not consume inventory.
    if (item.type !== 'product') {
      continue;
    }

    const quantity = toFixed3(entry.quantity || 1);
    demandByItemId.set(item.id, toFixed3((demandByItemId.get(item.id) || 0) + quantity));
  }

  return demandByItemId;
}

function ensureStockAvailable(itemById = new Map(), demandByItemId = new Map()) {
  for (const [itemId, quantity] of demandByItemId.entries()) {
    const item = itemById.get(itemId);
    if (!item) {
      throw new Error('Item was not found while validating stock.');
    }

    const availableStock = Number(item.stock ?? 0);
    if (quantity > availableStock) {
      throw new Error(`Requested quantity for item ${item.name} exceeds available stock (${availableStock}).`);
    }
  }
}

async function applyStockDeduction(itemById = new Map(), demandByItemId = new Map(), transaction) {
  for (const [itemId, quantity] of demandByItemId.entries()) {
    const item = itemById.get(itemId);
    if (!item) {
      continue;
    }

    const availableStock = Number(item.stock ?? 0);
    const nextStock = availableStock - Number(quantity);
    if (nextStock < 0) {
      throw new Error(`Requested quantity for item ${item.name} exceeds available stock (${availableStock}).`);
    }

    await item.update({ stock: Math.floor(nextStock) }, { transaction });
  }
}

function isStockValidationError(err) {
  return (
    Boolean(err?.message) &&
    String(err.message).toLowerCase().includes('exceeds available stock')
  );
}

function pushActivityEvent(events, event) {
  if (!event || !event.actionType || !event.title) {
    return;
  }
  events.push({
    actionType: String(event.actionType),
    title: String(event.title),
    description: event.description ? String(event.description) : null,
    changedFields: Array.isArray(event.changedFields) ? event.changedFields : null,
    metadata: event.metadata || null,
  });
}

async function persistOrderActivities({
  OrderActivity,
  orderId,
  organizationId,
  actorUserId,
  events,
  transaction,
}) {
  if (!OrderActivity || !orderId || !organizationId || !Array.isArray(events) || events.length === 0) {
    return;
  }

  await OrderActivity.bulkCreate(
    events.map((event) => ({
      orderId,
      organizationId,
      userId: actorUserId || null,
      actionType: event.actionType,
      title: event.title,
      description: event.description || null,
      changedFields: event.changedFields || null,
      metadata: event.metadata || null,
    })),
    { transaction }
  );
}

async function createOrder(req, res) {
  try {
    const models = getModels();
    if (
      !models ||
      !models.Order ||
      !models.OrderItemSnapshot ||
      !models.OrderActivity ||
      !models.Item ||
      !models.Customer ||
      !models.Organization ||
      !models.WithholdingTaxType
    ) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const {
      Order,
      OrderItemSnapshot,
      OrderActivity,
      Item,
      Customer,
      Organization,
      WithholdingTaxType,
      User,
    } = models;
    const payload = cleanUndefined(pickOrderPayload(req.body));
    delete payload.withHoldingTaxAmount;
    const orderedItems = Array.isArray(req.body.orderedItems)
      ? req.body.orderedItems
      : [];
    const authUser = req.auth?.user || null;
    const authUserId = authUser?.id || null;
    const actorName = getActorDisplayName(authUser);
    const requestedOrganizationId = String(req.body?.organizationId || '').trim() || null;
    const organizationId = getScopedOrganizationId(req, requestedOrganizationId) || getAuthenticatedOrganizationId(req);

    payload.organizationId = organizationId;
    payload.userId = authUserId;
    payload.createdBy = authUserId;
    payload.updatedBy = authUserId;

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'Logged in user has no organization assigned.' });
    }
    if (!payload.orderNumber) {
      return res.status(400).json({ ok: false, message: 'orderNumber is required.' });
    }
    if (!payload.customerId) {
      return res.status(400).json({ ok: false, message: 'customerId is required.' });
    }
    if (orderedItems.length === 0) {
      return res.status(400).json({ ok: false, message: 'orderedItems is required and must not be empty.' });
    }
    payload.currency = await getOrganizationCurrency(payload.organizationId);

    const itemIds = orderedItems.map((entry) => entry.itemId).filter(Boolean);
    if (itemIds.length !== orderedItems.length) {
      return res.status(400).json({ ok: false, message: 'Each ordered item must include itemId.' });
    }
    const uniqueItemIds = [...new Set(itemIds)];

    const transaction = await Order.sequelize.transaction();

    try {
      const customer = await Customer.findOne({
        where: {
          id: payload.customerId,
          organizationId: payload.organizationId,
          isActive: true,
        },
        transaction,
      });
      if (!customer) {
        await transaction.rollback();
        return res.status(400).json({
          ok: false,
          message: 'Selected customer is invalid for this organization.',
        });
      }

      const items = await Item.findAll({
        where: {
          id: uniqueItemIds,
          organizationId: payload.organizationId,
        },
        transaction,
      });

      if (items.length !== uniqueItemIds.length) {
        await transaction.rollback();
        return res.status(400).json({
          ok: false,
          message: 'One or more items are invalid for this organization.',
        });
      }

      const itemById = new Map(items.map((item) => [item.id, item]));
      const organization = await Organization.findByPk(payload.organizationId, {
        include: [
          {
            association: 'taxType',
            attributes: ['id', 'code', 'name', 'percentage', 'isActive'],
            required: false,
          },
        ],
        transaction,
      });
      if (!organization || !organization.taxTypeId || !organization.taxType || organization.taxType.isActive === false) {
        await transaction.rollback();
        return res.status(400).json({
          ok: false,
          message: 'Organization tax type is required and must be active before creating orders.',
        });
      }
      const organizationTaxType = organization.taxType;
      let withholdingRate = 0;
      try {
        const withholding = await resolveWithholdingRate({
          requestedWithholdingTaxTypeId: payload.withholdingTaxTypeId,
          organizationId: payload.organizationId,
          WithholdingTaxType,
          transaction,
        });
        payload.withholdingTaxTypeId = withholding.withholdingTaxTypeId;
        withholdingRate = withholding.withholdingPercentage;
      } catch (withholdingErr) {
        await transaction.rollback();
        return res.status(400).json({
          ok: false,
          message: withholdingErr.message || 'withholdingTaxTypeId is invalid.',
        });
      }

      const snapshotRows = orderedItems.map((entry) =>
        buildSnapshotFromItem(itemById.get(entry.itemId), entry, organizationTaxType)
      );
      const stockDemand = buildStockDemand(orderedItems, itemById);
      ensureStockAvailable(itemById, stockDemand);

      const computedTotals = computeOrderTotals(snapshotRows, payload.shippingAmount || 0, organizationTaxType);
      // Withholding is applied on taxable base and deducted from payable total.
      const withholdingAmount = toFixed2(computedTotals.taxableAmount * (withholdingRate / 100));
      payload.subtotalAmount = computedTotals.subtotalAmount;
      payload.taxAmount = computedTotals.taxAmount;
      payload.withHoldingTaxAmount = withholdingAmount;
      payload.discountAmount = computedTotals.discountAmount;
      payload.shippingAmount = computedTotals.shippingAmount;
      payload.totalAmount = toFixed2(
        Math.max(computedTotals.subtotalAmount + computedTotals.shippingAmount - withholdingAmount, 0)
      );
      if (isPercentageTaxType(organizationTaxType)) {
        payload.taxAmount = 0;
      }

      const order = await Order.create(payload, { transaction });

      await OrderItemSnapshot.bulkCreate(
        snapshotRows.map((row) => ({
          ...row,
          orderId: order.id,
        })),
        { transaction }
      );

      if (payload.status === 'confirmed') {
        await applyStockDeduction(itemById, stockDemand, transaction);
      }

      const createEvents = [];
      pushActivityEvent(createEvents, {
        actionType: 'order_created',
        title: 'Order created',
        description: `Order ${order.orderNumber} was created.`,
        changedFields: ['orderNumber', 'status', 'customerId', 'totalAmount'],
        metadata: {
          status: order.status,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          itemCount: snapshotRows.length,
          customerId: order.customerId,
        },
      });
      if (payload.status === 'confirmed') {
        pushActivityEvent(createEvents, {
          actionType: 'order_confirmed',
          title: 'Order confirmed',
          description: 'Order was created in confirmed status and stock was deducted.',
          changedFields: ['status'],
          metadata: {
            deductedProductCount: stockDemand.size,
          },
        });
      }
      await persistOrderActivities({
        OrderActivity,
        orderId: order.id,
        organizationId: order.organizationId,
        actorUserId: authUserId,
        events: createEvents,
        transaction,
      });

      await createOrganizationMessage({
        organizationId: order.organizationId,
        entityType: 'order',
        entityId: order.id,
        title: 'New order added',
        message: `${actorName} just created order "${order.orderNumber}".`,
        createdBy: authUserId,
        metadata: {
          customerId: order.customerId,
          totalAmount: order.totalAmount || 0,
          currency: order.currency || null,
        },
        transaction,
      });

      await transaction.commit();

      const createdOrder = await Order.findByPk(order.id, {
        include: [
          {
            model: Customer,
            as: 'customer',
            attributes: ['id', 'name', 'taxId'],
          },
          {
            model: OrderItemSnapshot,
            as: 'orderedItemSnapshots',
          },
          {
            model: WithholdingTaxType,
            as: 'withholdingTaxType',
            attributes: ['id', 'code', 'name', 'percentage', 'appliesTo'],
            required: false,
          },
          {
            model: OrderActivity,
            as: 'activities',
            separate: true,
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            include: [
              {
                model: User,
                as: 'actor',
                attributes: ['id', 'firstName', 'lastName', 'email'],
                required: false,
              },
            ],
          },
        ],
      });

      try {
        await notifyOrderCreated(models, createdOrder || order);
      } catch (notifyErr) {
        console.error('Order created email notification failed:', notifyErr);
      }

      return res.status(201).json({ ok: true, data: createdOrder });
    } catch (txErr) {
      await transaction.rollback();
      if (isStockValidationError(txErr)) {
        return res.status(400).json({ ok: false, message: txErr.message });
      }
      throw txErr;
    }
  } catch (err) {
    console.error('Create order error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create order.' });
  }
}

async function listOrders(req, res) {
  try {
    const models = getModels();
    if (!models || !models.Order || !models.OrderItemSnapshot || !models.Customer || !models.Organization || !models.WithholdingTaxType) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Order, OrderItemSnapshot, Customer, Organization, WithholdingTaxType } = models;

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};

    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.userId) where.userId = req.query.userId;
    if (req.query.customerId) where.customerId = req.query.customerId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
    if (req.query.fulfillmentStatus) where.fulfillmentStatus = req.query.fulfillmentStatus;
    if (req.query.source) where.source = req.query.source;

    if (req.query.q) {
      where[Op.or] = [{ orderNumber: { [Op.like]: `%${req.query.q}%` } }];
    }

    const { rows, count } = await Order.findAndCountAll({
      where,
      limit,
      offset,
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'name', 'taxId'],
        },
        {
          model: OrderItemSnapshot,
          as: 'orderedItemSnapshots',
        },
        {
          model: WithholdingTaxType,
          as: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage', 'appliesTo'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
    });

    return res.status(200).json({
      ok: true,
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error('List orders error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch orders.' });
  }
}

async function getOrderById(req, res) {
  try {
    const models = getModels();
    if (
      !models ||
      !models.Order ||
      !models.OrderItemSnapshot ||
      !models.OrderActivity ||
      !models.Customer ||
      !models.WithholdingTaxType
    ) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Order, OrderItemSnapshot, OrderActivity, Customer, WithholdingTaxType, User } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Order not found.' });
      }
    }

    const order = await Order.findOne({
      where,
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'name', 'taxId'],
        },
        {
          model: OrderItemSnapshot,
          as: 'orderedItemSnapshots',
        },
        {
          model: WithholdingTaxType,
          as: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage', 'appliesTo'],
          required: false,
        },
        {
          model: OrderActivity,
          as: 'activities',
          separate: true,
          order: [['createdAt', 'DESC'], ['id', 'DESC']],
          include: [
            {
              model: User,
              as: 'actor',
              attributes: ['id', 'firstName', 'lastName', 'email'],
              required: false,
            },
          ],
        },
      ],
    });
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found.' });
    }

    return res.status(200).json({ ok: true, data: order });
  } catch (err) {
    console.error('Get order error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch order.' });
  }
}

async function updateOrder(req, res) {
  try {
    const models = getModels();
    if (
      !models ||
      !models.Order ||
      !models.Customer ||
      !models.OrderItemSnapshot ||
      !models.OrderActivity ||
      !models.Item ||
      !models.SalesInvoice ||
      !models.Organization ||
      !models.WithholdingTaxType
    ) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const {
      Order,
      Customer,
      OrderItemSnapshot,
      OrderActivity,
      Item,
      SalesInvoice,
      Organization,
      WithholdingTaxType,
      User,
    } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Order not found.' });
      }
    }
    const order = await Order.findOne({ where });
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found.' });
    }
    if (order.status === 'completed') {
      return res.status(400).json({
        ok: false,
        message: 'Completed orders are locked and can no longer be edited.',
      });
    }

    const payload = cleanUndefined(pickOrderPayload(req.body));
    delete payload.withHoldingTaxAmount;
    const requestedWithholdingTaxTypeId =
      Object.prototype.hasOwnProperty.call(req.body || {}, 'withholdingTaxTypeId')
        ? req.body.withholdingTaxTypeId
        : undefined;
    delete payload.withholdingTaxTypeId;
    const orderedItems = Array.isArray(req.body.orderedItems) ? req.body.orderedItems : null;
    if (!isPrivilegedRequest(req)) {
      delete payload.organizationId;
      delete payload.userId;
    }

    if (payload.orderNumber !== undefined) {
      return res.status(400).json({ ok: false, message: 'orderNumber is immutable and cannot be updated.' });
    }
    if (payload.customerId) {
      const customer = await Customer.findOne({
        where: {
          id: payload.customerId,
          organizationId: order.organizationId,
        },
      });
      if (!customer) {
        return res.status(400).json({
          ok: false,
          message: 'Selected customer is invalid for this organization.',
        });
      }
    }

    const authUser = req.auth?.user || null;
    const authUserId = authUser?.id || null;
    const actorName = getActorDisplayName(authUser);
    const beforeState = {
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      customerId: order.customerId,
      shippingAmount: Number(order.shippingAmount || 0),
      totalAmount: Number(order.totalAmount || 0),
      withholdingTaxTypeId: order.withholdingTaxTypeId || null,
    };
    const hasFieldUpdates = Object.keys(payload).length > 0;
    const hasOrderedItemsUpdate = orderedItems !== null;
    const nextStatus = payload.status !== undefined ? payload.status : order.status;
    const isTransitioningToCompleted =
      order.status !== 'completed' &&
      nextStatus === 'completed';
    const shouldApplyStockOnConfirm =
      order.status !== 'confirmed' &&
      order.status !== 'completed' &&
      nextStatus === 'confirmed';
    // Any item/shipping/withholding change must trigger full total recomputation.
    const shouldRecomputeTotals =
      hasOrderedItemsUpdate ||
      payload.shippingAmount !== undefined ||
      requestedWithholdingTaxTypeId !== undefined;
    const salesInvoiceId = String(req.body?.salesInvoiceId || '').trim();
    const salesInvoiceIssueDate = String(
      req.body?.salesInvoiceIssueDate || new Date().toISOString().slice(0, 10)
    ).trim();

    if (!hasFieldUpdates && !hasOrderedItemsUpdate && requestedWithholdingTaxTypeId === undefined) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }
    if (isTransitioningToCompleted && !salesInvoiceId) {
      return res.status(400).json({
        ok: false,
        message: 'salesInvoiceId is required when marking order as completed.',
      });
    }
    if (
      isTransitioningToCompleted &&
      !/^\d{4}-\d{2}-\d{2}$/.test(salesInvoiceIssueDate)
    ) {
      return res.status(400).json({
        ok: false,
        message: 'salesInvoiceIssueDate must be in YYYY-MM-DD format.',
      });
    }

    const transaction = await Order.sequelize.transaction();
    try {
      const activityEvents = [];

      if (hasFieldUpdates || authUserId) {
        const updatePayload = hasFieldUpdates ? { ...payload } : {};
        if (authUserId) {
          updatePayload.updatedBy = authUserId;
        }
        if (Object.keys(updatePayload).length > 0) {
          await order.update(updatePayload, { transaction });
        }
      }

      if (requestedWithholdingTaxTypeId !== undefined) {
        // Persist explicit withholding tax selection (or clear it when null/empty).
        try {
          const withholding = await resolveWithholdingRate({
            requestedWithholdingTaxTypeId,
            organizationId: order.organizationId,
            WithholdingTaxType,
            transaction,
          });
          await order.update({ withholdingTaxTypeId: withholding.withholdingTaxTypeId }, { transaction });
        } catch (withholdingErr) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: withholdingErr.message || 'withholdingTaxTypeId is invalid.',
          });
        }
      }

      if (hasOrderedItemsUpdate) {
        // Rebuild snapshots from the submitted item list, then recompute totals atomically.
        if (!Array.isArray(orderedItems) || orderedItems.length === 0) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'orderedItems must be a non-empty array when provided.',
          });
        }

        const itemIds = orderedItems.map((entry) => entry.itemId).filter(Boolean);
        if (itemIds.length !== orderedItems.length) {
          await transaction.rollback();
          return res.status(400).json({ ok: false, message: 'Each ordered item must include itemId.' });
        }
        const uniqueItemIds = [...new Set(itemIds)];

        const items = await Item.findAll({
          where: {
            id: uniqueItemIds,
            organizationId: order.organizationId,
          },
          transaction,
        });
        if (items.length !== uniqueItemIds.length) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'One or more items are invalid for this organization.',
          });
        }

        const organization = await Organization.findByPk(order.organizationId, {
          include: [
            {
              association: 'taxType',
              attributes: ['id', 'code', 'name', 'percentage', 'isActive'],
              required: false,
            },
          ],
          transaction,
        });
        if (!organization || !organization.taxTypeId || !organization.taxType || organization.taxType.isActive === false) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'Organization tax type is required and must be active before updating orders.',
          });
        }
        const organizationTaxType = organization.taxType;
        let withholdingRate = 0;
        try {
          const withholding = await resolveWithholdingRate({
            requestedWithholdingTaxTypeId: order.withholdingTaxTypeId,
            organizationId: order.organizationId,
            WithholdingTaxType,
            transaction,
          });
          if (order.withholdingTaxTypeId !== withholding.withholdingTaxTypeId) {
            await order.update({ withholdingTaxTypeId: withholding.withholdingTaxTypeId }, { transaction });
          }
          withholdingRate = withholding.withholdingPercentage;
        } catch (withholdingErr) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: withholdingErr.message || 'withholdingTaxTypeId is invalid.',
          });
        }

        const itemById = new Map(items.map((item) => [item.id, item]));
        const snapshotRows = orderedItems.map((entry) =>
          buildSnapshotFromItem(itemById.get(entry.itemId), entry, organizationTaxType)
        );
        const stockDemand = buildStockDemand(orderedItems, itemById);
        ensureStockAvailable(itemById, stockDemand);

        const computedTotals = computeOrderTotals(
          snapshotRows,
          payload.shippingAmount !== undefined ? payload.shippingAmount : order.shippingAmount,
          organizationTaxType
        );
        await order.update(
          {
            subtotalAmount: computedTotals.subtotalAmount,
            taxAmount: isPercentageTaxType(organizationTaxType) ? 0 : computedTotals.taxAmount,
            withHoldingTaxAmount: toFixed2(computedTotals.taxableAmount * (withholdingRate / 100)),
            discountAmount: computedTotals.discountAmount,
            shippingAmount: computedTotals.shippingAmount,
            totalAmount: toFixed2(
              Math.max(
                computedTotals.subtotalAmount +
                  computedTotals.shippingAmount -
                  toFixed2(computedTotals.taxableAmount * (withholdingRate / 100)),
                0
              )
            ),
          },
          { transaction }
        );

        await OrderItemSnapshot.destroy({
          where: { orderId: order.id },
          transaction,
        });

        await OrderItemSnapshot.bulkCreate(
          snapshotRows.map((row) => ({
            ...row,
            orderId: order.id,
          })),
          { transaction }
        );

        if (shouldApplyStockOnConfirm) {
          await applyStockDeduction(itemById, stockDemand, transaction);
        }
      } else if (shouldRecomputeTotals) {
        // Recompute using existing snapshots when only non-item fields changed.
        const organization = await Organization.findByPk(order.organizationId, {
          include: [
            {
              association: 'taxType',
              attributes: ['id', 'code', 'name', 'percentage', 'isActive'],
              required: false,
            },
          ],
          transaction,
        });
        if (!organization || !organization.taxTypeId || !organization.taxType || organization.taxType.isActive === false) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'Organization tax type is required and must be active before updating orders.',
          });
        }
        const organizationTaxType = organization.taxType;
        let withholdingRate = 0;
        try {
          const withholding = await resolveWithholdingRate({
            requestedWithholdingTaxTypeId: order.withholdingTaxTypeId,
            organizationId: order.organizationId,
            WithholdingTaxType,
            transaction,
          });
          if (order.withholdingTaxTypeId !== withholding.withholdingTaxTypeId) {
            await order.update({ withholdingTaxTypeId: withholding.withholdingTaxTypeId }, { transaction });
          }
          withholdingRate = withholding.withholdingPercentage;
        } catch (withholdingErr) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: withholdingErr.message || 'withholdingTaxTypeId is invalid.',
          });
        }
        const existingSnapshots = await OrderItemSnapshot.findAll({
          where: { orderId: order.id },
          transaction,
        });
        const computedTotals = computeOrderTotals(
          existingSnapshots.map((row) => row.toJSON()),
          payload.shippingAmount !== undefined ? payload.shippingAmount : order.shippingAmount,
          organizationTaxType
        );
        const withholdingAmount = toFixed2(computedTotals.taxableAmount * (withholdingRate / 100));
        await order.update(
          {
            subtotalAmount: computedTotals.subtotalAmount,
            taxAmount: isPercentageTaxType(organizationTaxType) ? 0 : computedTotals.taxAmount,
            withHoldingTaxAmount: withholdingAmount,
            discountAmount: computedTotals.discountAmount,
            shippingAmount: computedTotals.shippingAmount,
            totalAmount: toFixed2(
              Math.max(computedTotals.subtotalAmount + computedTotals.shippingAmount - withholdingAmount, 0)
            ),
          },
          { transaction }
        );
      } else if (shouldApplyStockOnConfirm) {
        const currentSnapshots = await OrderItemSnapshot.findAll({
          where: { orderId: order.id },
          attributes: ['itemId', 'quantity'],
          transaction,
        });
        if (!currentSnapshots.length) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'Cannot confirm order without ordered items.',
          });
        }

        const currentEntries = currentSnapshots
          .filter((row) => row.itemId)
          .map((row) => ({
            itemId: row.itemId,
            quantity: row.quantity,
          }));
        const itemIds = [...new Set(currentEntries.map((entry) => entry.itemId))];
        const items = await Item.findAll({
          where: {
            id: itemIds,
            organizationId: order.organizationId,
          },
          transaction,
        });
        if (items.length !== itemIds.length) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'One or more order items are invalid for this organization.',
          });
        }

        const itemById = new Map(items.map((item) => [item.id, item]));
        const stockDemand = buildStockDemand(currentEntries, itemById);
        ensureStockAvailable(itemById, stockDemand);
        await applyStockDeduction(itemById, stockDemand, transaction);
      }

      if (isTransitioningToCompleted) {
        const existingSalesInvoice = await SalesInvoice.findOne({
          where: { orderId: order.id },
          transaction,
        });
        if (existingSalesInvoice) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'A sales invoice already exists for this order.',
          });
        }

        const createdSalesInvoice = await SalesInvoice.create(
          {
            organizationId: order.organizationId,
            orderId: order.id,
            invoiceNumber: salesInvoiceId,
            issueDate: salesInvoiceIssueDate,
            dueDate: order.dueDate || null,
            status: 'issued',
            paymentStatus: order.paymentStatus || 'unpaid',
            currency: await getOrganizationCurrency(order.organizationId, order.currency || 'USD'),
            amount: order.subtotalAmount || 0,
            taxableAmount: Math.max(
              Number(order.subtotalAmount || 0) - Number(order.taxAmount || 0),
              0
            ),
            withHoldingTaxAmount: order.withHoldingTaxAmount || 0,
            subtotalAmount: order.subtotalAmount || 0,
            taxAmount: order.taxAmount || 0,
            discountAmount: order.discountAmount || 0,
            totalAmount: order.totalAmount || 0,
            notes: order.notes || null,
            createdBy: authUser?.id || order.updatedBy || order.userId || null,
            updatedBy: authUser?.id || order.updatedBy || order.userId || null,
          },
          { transaction }
        );

        await createOrganizationMessage({
          organizationId: order.organizationId,
          entityType: 'sales_invoice',
          entityId: createdSalesInvoice.id,
          title: 'New sales invoice added',
          message: `${actorName} just created sales invoice "${salesInvoiceId}".`,
          createdBy: authUser?.id || order.updatedBy || order.userId || null,
          metadata: {
            orderId: order.id,
            totalAmount: createdSalesInvoice.totalAmount || 0,
            currency: createdSalesInvoice.currency || null,
          },
          transaction,
        });

        pushActivityEvent(activityEvents, {
          actionType: 'sales_invoice_created',
          title: 'Sales invoice created',
          description: `Sales invoice ${salesInvoiceId} was generated on order completion.`,
          changedFields: ['status'],
          metadata: {
            salesInvoiceId,
            issueDate: salesInvoiceIssueDate,
          },
        });
      }

      const changedFields = [];
      if (beforeState.status !== order.status) changedFields.push('status');
      if (beforeState.paymentStatus !== order.paymentStatus) changedFields.push('paymentStatus');
      if (beforeState.fulfillmentStatus !== order.fulfillmentStatus) changedFields.push('fulfillmentStatus');
      if (beforeState.customerId !== order.customerId) changedFields.push('customerId');
      if (beforeState.shippingAmount !== Number(order.shippingAmount || 0)) changedFields.push('shippingAmount');
      if (beforeState.withholdingTaxTypeId !== (order.withholdingTaxTypeId || null)) changedFields.push('withholdingTaxTypeId');
      if (beforeState.totalAmount !== Number(order.totalAmount || 0)) changedFields.push('totalAmount');
      if (hasOrderedItemsUpdate) changedFields.push('orderedItems');

      if (changedFields.length > 0) {
        pushActivityEvent(activityEvents, {
          actionType: 'order_updated',
          title: 'Order updated',
          description: `Updated fields: ${changedFields.join(', ')}.`,
          changedFields,
          metadata: {
            fromStatus: beforeState.status,
            toStatus: order.status,
            fromTotal: beforeState.totalAmount,
            toTotal: Number(order.totalAmount || 0),
          },
        });
      }

      if (beforeState.status !== order.status) {
        pushActivityEvent(activityEvents, {
          actionType: 'status_changed',
          title: 'Order status changed',
          description: `Status changed from ${beforeState.status} to ${order.status}.`,
          changedFields: ['status'],
          metadata: {
            from: beforeState.status,
            to: order.status,
          },
        });
      }

      if (shouldApplyStockOnConfirm) {
        pushActivityEvent(activityEvents, {
          actionType: 'inventory_deducted',
          title: 'Inventory adjusted',
          description: 'Stock quantities were deducted when the order was confirmed.',
          changedFields: ['status'],
          metadata: {
            triggerStatus: order.status,
          },
        });
      }

      await persistOrderActivities({
        OrderActivity,
        orderId: order.id,
        organizationId: order.organizationId,
        actorUserId: authUserId || order.updatedBy || order.userId || null,
        events: activityEvents,
        transaction,
      });

      await transaction.commit();

      const updatedOrder = await Order.findByPk(order.id, {
        include: [
          {
            model: Customer,
            as: 'customer',
            attributes: ['id', 'name', 'taxId'],
          },
          {
            model: OrderItemSnapshot,
            as: 'orderedItemSnapshots',
          },
          {
            model: WithholdingTaxType,
            as: 'withholdingTaxType',
            attributes: ['id', 'code', 'name', 'percentage', 'appliesTo'],
            required: false,
          },
          {
            model: OrderActivity,
            as: 'activities',
            separate: true,
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            include: [
              {
                model: User,
                as: 'actor',
                attributes: ['id', 'firstName', 'lastName', 'email'],
                required: false,
              },
            ],
          },
        ],
      });

      return res.status(200).json({ ok: true, data: updatedOrder || order });
    } catch (txErr) {
      await transaction.rollback();
      if (isStockValidationError(txErr)) {
        return res.status(400).json({ ok: false, message: txErr.message });
      }
      if (txErr?.name === 'SequelizeUniqueConstraintError') {
        return res.status(400).json({
          ok: false,
          message: 'salesInvoiceId already exists. Please use a different sales invoice id.',
        });
      }
      throw txErr;
    }
  } catch (err) {
    console.error('Update order error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update order.' });
  }
}

async function deleteOrder(req, res) {
  try {
    const Order = getOrderModel();
    if (!Order) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Order not found.' });
      }
    }
    const order = await Order.findOne({ where });
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found.' });
    }

    await order.destroy();
    return res.status(200).json({ ok: true, message: 'Order deleted successfully.' });
  } catch (err) {
    console.error('Delete order error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete order.' });
  }
}

module.exports = {
  createOrder,
  listOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
};
