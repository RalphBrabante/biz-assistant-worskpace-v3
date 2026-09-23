const { getModels } = require('../sequelize');
const { Op, fn, col } = require('sequelize');
const { isPrivilegedRequest, getAuthenticatedOrganizationId } = require('../services/request-scope');

const STATUSES = ['open', 'in_progress', 'resolved', 'dismissed'];
const DEFAULT_COLUMNS = [
  { id: 'open', name: 'Open', color: 'slate' },
  { id: 'in_progress', name: 'In progress', color: 'blue' },
  { id: 'resolved', name: 'Resolved', color: 'green' },
  { id: 'dismissed', name: 'Dismissed', color: 'slate' },
].map(column => ({ ...column, isSystem: true, organizationId: null }));
const COLUMN_COLORS = ['slate', 'blue', 'violet', 'amber', 'green', 'rose'];
const REPORT_INCLUDE = [
  {association: 'reporter', attributes: ['firstName', 'lastName'], required: false},
  {association: 'organization', attributes: ['name'], required: false},
  {association: 'reviewer', attributes: ['firstName', 'lastName'], required: false},
];

async function statusAllowed(models, status, scope) {
  if (STATUSES.includes(status)) return true;
  if (typeof status !== 'string' || status.length > 64) return false;
  return Boolean(await models.BugReportColumn.findOne({where: {...scope, id: status}, attributes: ['id']}));
}

function applySearch(where, query) {
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : '';
  if (search) where[Op.or] = [{title: {[Op.like]: `%${search}%`}}, {description: {[Op.like]: `%${search}%`}}];
  return where;
}

// Review access is role-based, even when an ordinary user has broad permissions.
function requireBugReportAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ ok: false, message: 'Authentication required.' });
  const roles = (req.auth.roleCodes || []).map(role => String(role).toLowerCase());
  if (!roles.some(role => ['superuser', 'administrator'].includes(role))) {
    return res.status(403).json({ ok: false, message: 'Only administrators can review bug reports.' });
  }
  return next();
}

function reviewScope(req) {
  if (isPrivilegedRequest(req)) {
    const organizationId = String(req.query.organizationId || '').trim();
    return organizationId ? { organizationId } : {};
  }
  const organizationId = getAuthenticatedOrganizationId(req);
  return organizationId ? { organizationId } : null;
}

function textField(body, field, max, required = false) {
  const value = body[field];
  if (value != null && typeof value !== 'string') throw new Error(`${field} must be text.`);
  const text = (value || '').trim();
  if (required && !text) throw new Error(`${field} is required.`);
  if (text.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return text || null;
}

async function createBugReport(req, res) {
  try {
    const createdBy = req.auth?.userId || req.auth?.user?.id;
    if (!createdBy) return res.status(401).json({ ok: false, message: 'Authentication required.' });
    const body = req.body || {};
    let payload;
    try {
      const pagePath = textField(body, 'pagePath', 500, true).split(/[?#]/, 1)[0];
      if (!pagePath.startsWith('/') || pagePath.startsWith('//') || /[\\\s\x00-\x1f]/.test(pagePath)) {
        throw new Error('pagePath must be an app page path.');
      }
      payload = {
        title: textField(body, 'title', 200, true),
        description: textField(body, 'description', 10000, true),
        steps: textField(body, 'steps', 5000),
        expectedResult: textField(body, 'expectedResult', 5000),
        pagePath,
      };
    } catch (err) {
      return res.status(400).json({ ok: false, message: err.message });
    }
    const models = getModels();
    if (!models?.BugReport) return res.status(503).json({ ok: false, message: 'Bug reports are not available yet.' });
    const organizationId = isPrivilegedRequest(req)
      ? (String(body.organizationId || '').trim() || null)
      : getAuthenticatedOrganizationId(req);
    if (!organizationId && !isPrivilegedRequest(req)) {
      return res.status(403).json({ ok: false, message: 'An organization is required.' });
    }
    if (organizationId && !await models.Organization.findByPk(organizationId, {attributes: ['id']})) {
      return res.status(400).json({ ok: false, message: 'Organization not found.' });
    }
    const report = await models.BugReport.create({ ...payload, organizationId, createdBy, updatedBy: createdBy, status: 'open' });
    // Do not return report contents through the submission endpoint.
    return res.status(201).json({ ok: true, data: { id: report.id }, message: 'Bug report submitted.' });
  } catch (err) {
    console.error('[bug-reports] create failed:', err);
    return res.status(500).json({ ok: false, message: 'Unable to submit the bug report. Please try again.' });
  }
}

async function listBugReports(req, res) {
  return requireBugReportAdmin(req, res, async () => {
    try {
      const where = reviewScope(req);
      if (!where) return res.status(403).json({ ok: false, message: 'An organization is required.' });
      const page = Number(req.query.page || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) return res.status(400).json({ ok: false, message: 'Invalid page.' });
      const models = getModels();
      if (!models?.BugReport) return res.status(503).json({ ok: false, message: 'Bug reports are not available yet.' });
      if (req.query.status) {
        if (!await statusAllowed(models, req.query.status, where)) return res.status(400).json({ ok: false, message: 'Invalid report status.' });
        where.status = req.query.status;
      }
      const {rows, count} = await models.BugReport.findAndCountAll({
        where: applySearch(where, req.query), limit: 20, offset: (page - 1) * 20, order: [['createdAt', 'DESC'], ['id', 'DESC']],
        include: REPORT_INCLUDE,
      });
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, data: rows, meta: { page, limit: 20, total: count, totalPages: Math.ceil(count / 20) } });
    } catch (err) {
      console.error('[bug-reports] list failed:', err);
      return res.status(500).json({ ok: false, message: 'Unable to load bug reports.' });
    }
  });
}

async function updateBugReport(req, res) {
  return requireBugReportAdmin(req, res, async () => {
    try {
      const where = reviewScope(req);
      if (!where) return res.status(403).json({ ok: false, message: 'An organization is required.' });
      const status = req.body?.status;
      const models = getModels();
      if (!models?.BugReport) return res.status(503).json({ ok: false, message: 'Bug reports are not available yet.' });
      const report = await models.BugReport.findOne({ where: {...where, id: req.params.id}, attributes: ['id', 'organizationId', 'status'] });
      if (!report) return res.status(404).json({ ok: false, message: 'Bug report not found.' });
      if (!await statusAllowed(models, status, {organizationId: report.organizationId})) {
        return res.status(400).json({ ok: false, message: 'Choose a status column belonging to this report’s organization.' });
      }
      if (req.body.expectedStatus !== undefined && req.body.expectedStatus !== report.status) {
        return res.status(409).json({ ok: false, message: 'This report was moved by another reviewer. Refresh the board and try again.' });
      }
      if (status === report.status) return res.json({ ok: true, message: 'Bug report already has this status.' });
      // Include tenant scope in the write itself, not just in a preliminary lookup.
      const [updated] = await models.BugReport.update({ status, updatedBy: req.auth.userId || req.auth.user?.id }, {where: {...where, id: req.params.id, status: report.status}});
      if (!updated) return res.status(409).json({ ok: false, message: 'This report changed while you were moving it. Refresh the board and try again.' });
      return res.json({ ok: true, message: 'Bug report updated.' });
    } catch (err) {
      console.error('[bug-reports] update failed:', err);
      return res.status(500).json({ ok: false, message: 'Unable to update the bug report.' });
    }
  });
}

async function getBugReportBoard(req, res) {
  return requireBugReportAdmin(req, res, async () => {
    try {
      const scope = reviewScope(req);
      if (!scope) return res.status(403).json({ ok: false, message: 'An organization is required.' });
      const models = getModels();
      if (!models?.BugReportColumn || !models?.BugReport) return res.status(503).json({ ok: false, message: 'The bug report board is not available yet.' });
      const custom = await models.BugReportColumn.findAll({where: scope, include: [{association: 'organization', attributes: ['name'], required: false}], order: [['createdAt', 'ASC'], ['id', 'ASC']]});
      const definitions = [DEFAULT_COLUMNS[0], DEFAULT_COLUMNS[1], ...custom.map(row => ({...row.toJSON(), isSystem: false})), DEFAULT_COLUMNS[2], DEFAULT_COLUMNS[3]];
      const where = applySearch({...scope}, req.query);
      const counts = await models.BugReport.findAll({where, attributes: ['status', [fn('COUNT', col('id')), 'total']], group: ['status'], raw: true});
      const totals = new Map(counts.map(row => [row.status, Number(row.total)]));
      const columns = await Promise.all(definitions.map(async definition => ({
        ...definition,
        total: totals.get(definition.id) || 0,
        rows: totals.get(definition.id) ? await models.BugReport.findAll({where: {...where, status: definition.id}, include: REPORT_INCLUDE, limit: 20, order: [['createdAt', 'DESC'], ['id', 'DESC']]}) : [],
      })));
      res.set('Cache-Control', 'no-store');
      return res.json({ok: true, data: {columns, canCreateColumn: Boolean(scope.organizationId), total: counts.reduce((sum, row) => sum + Number(row.total), 0)}});
    } catch (err) {
      console.error('[bug-reports] board failed:', err);
      return res.status(500).json({ok: false, message: 'Unable to load the bug report board.'});
    }
  });
}

async function createBugReportColumn(req, res) {
  return requireBugReportAdmin(req, res, async () => {
    try {
      const scope = reviewScope(req);
      if (!scope?.organizationId) return res.status(400).json({ok: false, message: 'Select an organization before adding a column.'});
      let name;
      try { name = textField(req.body || {}, 'name', 60, true); }
      catch (err) { return res.status(400).json({ok: false, message: err.message}); }
      const color = req.body?.color || 'violet';
      if (!COLUMN_COLORS.includes(color)) return res.status(400).json({ok: false, message: 'Choose a valid column color.'});
      if (DEFAULT_COLUMNS.some(column => column.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ok: false, message: 'A column with this name already exists.'});
      const models = getModels();
      if (!models?.BugReportColumn) return res.status(503).json({ok: false, message: 'The bug report board is not available yet.'});
      if (!await models.Organization.findByPk(scope.organizationId, {attributes: ['id']})) return res.status(404).json({ok: false, message: 'Organization not found.'});
      const column = await models.BugReportColumn.create({organizationId: scope.organizationId, name, color, createdBy: req.auth.userId || req.auth.user?.id});
      return res.status(201).json({ok: true, data: column});
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ok: false, message: 'A column with this name already exists.'});
      console.error('[bug-reports] create column failed:', err);
      return res.status(500).json({ok: false, message: 'Unable to create the column.'});
    }
  });
}

module.exports = { createBugReport, listBugReports, updateBugReport, requireBugReportAdmin, getBugReportBoard, createBugReportColumn };
