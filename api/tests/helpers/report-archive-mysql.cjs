const { execFileSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { Sequelize } = require('sequelize');

async function reportArchiveFixture() {
  if (process.env.NODE_ENV === 'production') throw new Error('Local fixture only.');
  const suffix = randomBytes(6).toString('hex'), schema = `report_archive_test_${suffix}`, user = `pdf_test_${suffix}`, password = randomBytes(24).toString('hex');
  const admin = sql => execFileSync('docker', ['exec', '-i', 'biz-assitant-mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  let db;
  admin(`CREATE DATABASE ${schema}; CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON ${schema}.* TO '${user}'@'%';`);
  const close = async () => { if (db) await db.close(); admin(`DROP DATABASE IF EXISTS ${schema}; DROP USER IF EXISTS '${user}'@'%';`); };
  try {
    db = new Sequelize(schema, user, password, { host: '127.0.0.1', port: 3306, dialect: 'mysql', logging: false });
    await db.query('CREATE TABLE organizations (id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY)');
    await db.query('CREATE TABLE users (id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY)');
    const actorId = randomUUID(), organizationId = randomUUID(), otherOrganizationId = randomUUID();
    await db.query('INSERT INTO users (id) VALUES (?)', { replacements: [actorId] });
    await db.query('INSERT INTO organizations (id) VALUES (?), (?)', { replacements: [organizationId, otherOrganizationId] });
    const migration = require('../../src/migrations/20261005040000-create-report-documents');
    await migration.up(db.getQueryInterface(), Sequelize);
    const ReportDocument = require('../../src/models/report-document').initReportDocumentModel(db);
    const organization = { id: organizationId, name: 'Local PDF Archive Preview', legalName: 'Local PDF Archive Preview', taxId: '12345678900000', addressLine1: 'Synthetic fixture', city: 'Test City', country: 'Philippines', postalCode: '1000', phone: '0', contactEmail: 'preview@example.test', currency: 'PHP', taxpayerClassification: 'corporation', taxpayerSize: 'small', rdoCode: '039', taxType: { code: 'VAT', name: 'VAT', percentage: 12 } };
    const models = { ReportDocument, Organization: { findByPk: async id => id === organizationId ? organization : null },
      TaxType: {}, WithholdingTaxType: {}, Vendor: {}, Order: {}, Customer: {},
      SalesInvoice: { findOne: async () => ({}), findAll: async () => [] },
      Expense: { findOne: async () => ({}), findAll: async () => [] } };
    return { db, models, organization, actorId, otherOrganizationId, close, migration };
  } catch (error) { await close(); throw error; }
}
module.exports = { reportArchiveFixture };
