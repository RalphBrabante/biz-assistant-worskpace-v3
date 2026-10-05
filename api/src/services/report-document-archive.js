const { createHash } = require('crypto');
class ReportArchiveError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
const REPORT_DOCUMENT_METADATA = ['id', 'organizationId', 'documentCode', 'title', 'year', 'quarter', 'filename', 'byteLength', 'generatedAt'];
async function archiveReportPdf(models, { organizationId, code, title, year, quarter, sourceRevision, bytes, generatedBy }) {
  if (!models?.ReportDocument) throw new ReportArchiveError('Generated PDF storage is not ready. Contact your administrator.');
  const content = Buffer.from(bytes);
  if (!content.subarray(0, 5).equals(Buffer.from('%PDF-')) || content.length > 16 * 1024 * 1024) {
    throw new ReportArchiveError('The generated PDF could not be saved. Please contact your administrator.', 500);
  }
  const filename = `bir-${code}-${year}-${quarter === null ? 'annual' : `q${quarter}`}.pdf`;
  try {
    return await models.ReportDocument.create({ organizationId, documentCode: code, title, year, quarter, filename,
      sourceRevision, pdfContent: content, byteLength: content.length,
      sha256: createHash('sha256').update(content).digest('hex'), generatedBy: generatedBy || null, generatedAt: new Date() });
  } catch (error) {
    // SQL/parameters contain the private PDF; log only a diagnostic code.
    console.error('Save generated report PDF error:', { name: error.name, code: error.original?.code });
    throw new ReportArchiveError('Unable to save the generated PDF. Please try again or contact your administrator.');
  }
}
module.exports = { archiveReportPdf, REPORT_DOCUMENT_METADATA, ReportArchiveError };
