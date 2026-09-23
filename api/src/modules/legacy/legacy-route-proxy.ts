import type { NextFunction, Request, Response } from 'express';

const authRoutes = require('../../routes/auth-routes');
const systemRoutes = require('../../routes/system-routes');
const itemsRoutes = require('../../routes/items-routes');
const organizationsRoutes = require('../../routes/organizations-routes');
const ordersRoutes = require('../../routes/orders-routes');
const usersRoutes = require('../../routes/users-routes');
const rolesRoutes = require('../../routes/roles-routes');
const permissionsRoutes = require('../../routes/permissions-routes');
const licensesRoutes = require('../../routes/licenses-routes');
const salesInvoicesRoutes = require('../../routes/sales-invoices-routes');
const customersRoutes = require('../../routes/customers-routes');
const expensesRoutes = require('../../routes/expenses-routes');
const vendorsRoutes = require('../../routes/vendors-routes');
const reportsRoutes = require('../../routes/reports-routes');
const settingsRoutes = require('../../routes/settings-routes');
const taxTypesRoutes = require('../../routes/tax-types-routes');
const withholdingTaxTypesRoutes = require('../../routes/withholding-tax-types-routes');
const profileRoutes = require('../../routes/profile-routes');
const messagesRoutes = require('../../routes/messages-routes');
const dashboardRoutes = require('../../routes/dashboard-routes');
const bugReportsRoutes = require('../../routes/bug-reports-routes');
const devRoutes = require('../../routes/dev-routes');

const { authenticateRequest } = require('../../middleware/authz');
const { invalidateCacheOnWriteMiddleware } = require('../../middleware/cache');
const { errorHandler, notFoundHandler } = require('../../middleware/error-handler');

type RouteKey =
  | 'bug-reports'
  | 'auth'
  | 'dev'
  | 'system'
  | 'items'
  | 'organizations'
  | 'orders'
  | 'users'
  | 'roles'
  | 'permissions'
  | 'licenses'
  | 'sales-invoices'
  | 'customers'
  | 'expenses'
  | 'vendors'
  | 'reports'
  | 'settings'
  | 'tax-types'
  | 'withholding-tax-types'
  | 'profile'
  | 'messages'
  | 'dashboard';

type RouteConfig = {
  prefix: string;
  router: any;
  protected: boolean;
};

const ROUTE_CONFIG: Record<RouteKey, RouteConfig> = {
  'bug-reports': { prefix: '/api/v1/bug-reports', router: bugReportsRoutes, protected: true },
  auth: { prefix: '/api/v1/auth', router: authRoutes, protected: false },
  dev: { prefix: '/api/v1/dev', router: devRoutes, protected: false },
  system: { prefix: '/api/v1', router: systemRoutes, protected: true },
  items: { prefix: '/api/v1/items', router: itemsRoutes, protected: true },
  organizations: { prefix: '/api/v1/organizations', router: organizationsRoutes, protected: true },
  orders: { prefix: '/api/v1/orders', router: ordersRoutes, protected: true },
  users: { prefix: '/api/v1/users', router: usersRoutes, protected: true },
  roles: { prefix: '/api/v1/roles', router: rolesRoutes, protected: true },
  permissions: { prefix: '/api/v1/permissions', router: permissionsRoutes, protected: true },
  licenses: { prefix: '/api/v1/licenses', router: licensesRoutes, protected: true },
  'sales-invoices': { prefix: '/api/v1/sales-invoices', router: salesInvoicesRoutes, protected: true },
  customers: { prefix: '/api/v1/customers', router: customersRoutes, protected: true },
  expenses: { prefix: '/api/v1/expenses', router: expensesRoutes, protected: true },
  vendors: { prefix: '/api/v1/vendors', router: vendorsRoutes, protected: true },
  reports: { prefix: '/api/v1/reports', router: reportsRoutes, protected: true },
  settings: { prefix: '/api/v1/settings', router: settingsRoutes, protected: true },
  'tax-types': { prefix: '/api/v1/tax-types', router: taxTypesRoutes, protected: true },
  'withholding-tax-types': {
    prefix: '/api/v1/withholding-tax-types',
    router: withholdingTaxTypesRoutes,
    protected: true,
  },
  profile: { prefix: '/api/v1/profile', router: profileRoutes, protected: true },
  messages: { prefix: '/api/v1/messages', router: messagesRoutes, protected: true },
  dashboard: { prefix: '/api/v1/dashboard', router: dashboardRoutes, protected: true },
};

function runMiddleware(
  middleware: any,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (err?: any) => {
      res.off('finish', onResponse);
      res.off('close', onResponse);
      if (err) reject(err);
      else resolve();
    };
    const onResponse = () => finish();
    res.once('finish', onResponse);
    res.once('close', onResponse);
    try {
      Promise.resolve(middleware(req, res, finish)).catch(finish);
    } catch (err) { finish(err); }
  });
}

function dispatchToRouter(config: RouteConfig, req: Request, res: Response, next: NextFunction): Promise<void> {
  return new Promise((resolve) => {
    const originalUrl = req.url;
    const finish = () => {
      req.url = originalUrl;
      res.off('finish', finish);
      res.off('close', finish);
      resolve();
    };
    // Controllers and cache hits end the response without calling router.next.
    res.once('finish', finish);
    res.once('close', finish);

    try {
      const target = req.originalUrl || req.url || '';
      let proxiedUrl = target.startsWith(config.prefix) ? target.slice(config.prefix.length) : target;
      if (!proxiedUrl.startsWith('/')) {
        proxiedUrl = `/${proxiedUrl}`;
      }
      req.url = proxiedUrl || '/';

      config.router(req, res, (err?: any) => {
        req.url = originalUrl;

        if (err) {
          errorHandler(err, req, res, next);
          finish();
          return;
        }
        if (!res.headersSent) {
          notFoundHandler(req, res, next);
        }
        finish();
      });
    } catch (err) {
      req.url = originalUrl;
      errorHandler(err, req, res, next);
      finish();
    }
  });
}

export async function proxyLegacyRoute(
  key: RouteKey,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const config = ROUTE_CONFIG[key];
  if (!config) {
    notFoundHandler(req, res, next);
    return;
  }

  try {
    if (config.protected) {
      await runMiddleware(authenticateRequest, req, res, next);
      if (res.headersSent) {
        return;
      }
      await runMiddleware(invalidateCacheOnWriteMiddleware, req, res, next);
      if (res.headersSent) {
        return;
      }
    }
  } catch (err) {
    errorHandler(err, req, res, next);
    return;
  }

  await dispatchToRouter(config, req, res, next);
}
