// All fixtures live in connection-local TEMPORARY tables. No application records are changed.
const assert = require('node:assert/strict');
const {initSequelize} = require('../src/sequelize');
const {administratorRecipients,sendQuarterlyTaxReminders} = require('../src/jobs/quarterly-tax-reminder-job');
(async()=>{
  const sequelize=initSequelize(), transaction=await sequelize.transaction();
  const tables=['quarterly_tax_reminder_deliveries','organization_users','user_roles','roles','users','organizations'];
  const query=(sql,options={})=>sequelize.query(sql,{...options,transaction});
  try {
    const [columns]=await query('SHOW COLUMNS FROM quarterly_tax_reminder_deliveries');
    assert.equal(columns.filter(column=>column.Key==='PRI').length,4);
    await query('CREATE TEMPORARY TABLE quarterly_tax_reminder_deliveries (organization_id VARCHAR(36) NOT NULL, tax_year INT NOT NULL, quarter INT NOT NULL, recipient_hash VARCHAR(64) NOT NULL, sent_at DATETIME NULL, PRIMARY KEY (organization_id,tax_year,quarter,recipient_hash))');
    await query('CREATE TEMPORARY TABLE organizations (id VARCHAR(36), name VARCHAR(100), is_active BOOLEAN)');
    await query('CREATE TEMPORARY TABLE users (id VARCHAR(36), organization_id VARCHAR(36), email VARCHAR(255), first_name VARCHAR(100), role VARCHAR(50), is_active BOOLEAN, status VARCHAR(30))');
    await query('CREATE TEMPORARY TABLE organization_users (id VARCHAR(36), organization_id VARCHAR(36), user_id VARCHAR(36), role VARCHAR(50), is_active BOOLEAN)');
    await query('CREATE TEMPORARY TABLE roles (id VARCHAR(36), code VARCHAR(50), is_active BOOLEAN)');
    await query('CREATE TEMPORARY TABLE user_roles (user_id VARCHAR(36), role_id VARCHAR(36), is_active BOOLEAN)');
    await query("INSERT INTO organizations VALUES ('a','Company A',1),('b','Company B',1),('c','Inactive',0)");
    const users=[
      ['legacy','a','legacy@example.com','Legacy','administrator',1,'active'],
      ['membership','a','membership@example.com','Membership','member',1,'active'],
      ['assigned','a','assigned@example.com','Assigned','member',1,'active'],
      ['removed','a','removed@example.com','Removed','administrator',1,'active'],
      ['super','a','super@example.com','Global','superuser',1,'active'],
      ['suspended','a','suspended@example.com','Suspended','administrator',1,'suspended'],
      ['inactive','a','inactive@example.com','Inactive','administrator',0,'active'],
      ['revoked','a','revoked@example.com','Revoked','member',1,'active'],
      ['inactive-role','a','role@example.com','Role','member',1,'active'],
      ['other','b','other@example.com','Other','administrator',1,'active'],
      ['disabled-org','c','disabled-org@example.com','Disabled','administrator',1,'active'],
    ];
    for(const row of users)await query('INSERT INTO users VALUES (?,?,?,?,?,?,?)',{replacements:row});
    await query("INSERT INTO organization_users VALUES ('m1','a','membership','administrator',1),('m2','a','removed','administrator',0)");
    await query("INSERT INTO roles VALUES ('admin','administrator',1),('disabled','administrator',0)");
    await query("INSERT INTO user_roles VALUES ('assigned','admin',1),('revoked','admin',0),('inactive-role','disabled',1)");
    const connection={query,transaction:async fn=>fn(transaction)};
    const recipients=await administratorRecipients(connection);
    assert.deepEqual(recipients.map(r=>`${r.organizationId}:${r.email}`).sort(),['a:assigned@example.com','a:legacy@example.com','a:membership@example.com','b:other@example.com']);
    const messages=[];const dependencies={sequelize:connection,send:async message=>{messages.push(message);}};
    const first=await sendQuarterlyTaxReminders(new Date('2026-10-15T00:00:00Z'),dependencies);
    assert.equal(first.sent,4);assert.equal(first.failed,0);
    assert.equal((await sendQuarterlyTaxReminders(new Date('2026-10-15T01:00:00Z'),dependencies)).sent,0);
    assert.equal(messages.length,4);assert(messages.every(message=>message.text.includes('/reports')));
    console.log('PASS MySQL: administrator recipient scoping, inactive memberships/users/roles/organizations excluded, delivery tracking and repeat suppression. No live emails or application records changed.');
  } finally {
    for(const table of tables)await query(`DROP TEMPORARY TABLE IF EXISTS ${table}`);
    await transaction.rollback();await sequelize.close();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
