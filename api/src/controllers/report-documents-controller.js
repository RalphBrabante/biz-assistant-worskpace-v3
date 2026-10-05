const { getModels } = require('../sequelize');
const { getAuthenticatedOrganizationId, isPrivilegedRequest } = require('../services/request-scope');
const { REPORT_DOCUMENT_METADATA } = require('../services/report-document-archive');

function scope(req) {
  return isPrivilegedRequest(req) ? String(req.query?.organizationId || '').trim() : getAuthenticatedOrganizationId(req);
}
function headers(res) { res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff'); }
async function listReportDocuments(req, res, next) {
  headers(res);
  const organizationId = scope(req), year = Number(req.query?.year);
  if (!organizationId) return res.status(400).json({ message: 'Select an organization to retrieve generated PDFs.' });
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return res.status(400).json({ message: 'Select a valid year.' });
  const page = Number(req.query?.page || 1), limit = Number(req.query?.limit || 20);
  if (!Number.isInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ message: 'Invalid pagination. Use a positive page and 1 to 100 rows.' });
  }
  try {
    const model = getModels()?.ReportDocument;
    if (!model) return res.status(503).json({ message: 'Generated PDF storage is not ready.' });
    const { rows, count } = await model.findAndCountAll({ where: { organizationId, year }, attributes: REPORT_DOCUMENT_METADATA,
      order: [['generatedAt', 'DESC'], ['id', 'DESC']], limit, offset: (page - 1) * limit });
    return res.status(200).json({ data: rows, meta: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) } });
  } catch (error) { return next(error); }
}
async function downloadReportDocument(req, res, next) {
  headers(res);
  const organizationId = scope(req);
  if (!organizationId) return res.status(400).json({ message: 'Select an organization to retrieve generated PDFs.' });
  try {
    const model = getModels()?.ReportDocument;
    if (!model) return res.status(503).json({ message: 'Generated PDF storage is not ready.' });
    const row = await model.findOne({ where: { id: req.params.id, organizationId }, attributes: ['filename', 'pdfContent'] });
    if (!row) return res.status(404).json({ message: 'Generated PDF not found in this organization.' });
    const filename = String(row.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(row.pdfContent));
  } catch (error) { return next(error); }
}
module.exports = { listReportDocuments, downloadReportDocument };
