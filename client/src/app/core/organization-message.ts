export interface OrganizationMessage {
  id: string;
  organizationId?: string;
  entityType?: string;
  entityId?: string | null;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  isRead?: boolean;
  readAt?: string | null;
  createdAt?: string;
  creator?: { id?: string; firstName?: string; lastName?: string; email?: string };
  organization?: { id?: string; name?: string; legalName?: string };
}

export const MESSAGE_TYPES = [
  { value: 'order', label: 'Order', permission: 'orders.read', path: '/orders' },
  { value: 'sales_invoice', label: 'Sales Invoice', permission: 'sales_invoices.read', path: '/sales-invoices' },
  { value: 'expense', label: 'Expense', permission: 'expenses.read', path: '/expenses' },
  { value: 'item', label: 'Item', permission: 'items.read', path: '/items' },
  { value: 'customer', label: 'Customer', permission: 'organizations.read', path: '/customers' },
  { value: 'vendor', label: 'Vendor', permission: 'vendors.read', path: '/vendors' },
  { value: 'user', label: 'User', permission: 'users.read', path: '/users' },
  { value: 'organization', label: 'Organization', permission: 'organizations.read', path: '/organizations' },
  { value: 'license', label: 'License', permission: 'licenses.read', path: '/licenses' },
  { value: 'report', label: 'Report', permission: 'reports.*', path: '/reports' },
];

export function messageTarget(row: OrganizationMessage): { path: string; permission: string } | null {
  const type = String(row.entityType || '').trim().toLowerCase();
  const config = MESSAGE_TYPES.find((item) => item.value === type);
  if (!config) return null;
  const metadataId = (key: string) => typeof row.metadata?.[key] === 'string' ? String(row.metadata[key]).trim() : '';
  let id = String(row.entityId || '').trim();
  if (type === 'sales_invoice') {
    id ||= metadataId('salesInvoiceId');
    const orderId = metadataId('orderId');
    if (!id && orderId) return { path: `/orders/${encodeURIComponent(orderId)}`, permission: 'orders.read' };
  }
  if (type === 'report') id ||= metadataId('reportId');
  const isList = ['item', 'customer', 'vendor'].includes(type);
  const base = type === 'license' && id ? '/license' : config.path;
  return { path: id && !isList ? `${base}/${encodeURIComponent(id)}` : base, permission: config.permission };
}
