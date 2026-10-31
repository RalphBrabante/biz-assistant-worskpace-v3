// All fixtures live in connection-local TEMPORARY tables. No application records are changed.
const assert = require('node:assert/strict');
const {initSequelize} = require('../src/sequelize');
const {administratorRecipients,sendQuarterlyTaxReminders} = require('../src/jobs/quarterly-tax-reminder-job');
(async()=>{
  const sequelize=initSequelize(), transaction=await sequelize.transaction();
  const tables=['quarterly_tax_reminder_deliveries','organization_user_roles','organization_roles','organization_users','users','organizations'];
  const query=(sql,options={})=>sequelize.query(sql,{...options,transaction});
  try {
    const [columns]=await query('SHOW COLUMNS FROM quarterly_tax_reminder_deliveries');
    assert.equal(columns.filter(column=>column.Key==='PRI').length,4);
    await query('CREATE TEMPORARY TABLE quarterly_tax_reminder_deliveries (organization_id VARCHAR(36) NOT NULL, tax_year INT NOT NULL, quarter INT NOT NULL, recipient_hash VARCHAR(64) NOT NULL, sent_at DATETIME NULL, PRIMARY KEY (organization_id,tax_year,quarter,recipient_hash))');
    await query('CREATE TEMPORARY TABLE organizations (id VARCHAR(36), name VARCHAR(100), is_active BOOLEAN)');
    await query('CREATE TEMPORARY TABLE users (id VARCHAR(36), organization_id VARCHAR(36), email VARCHAR(255), first_name VARCHAR(100), role VARCHAR(50), is_active BOOLEAN, status VARCHAR(30))');
    await query('CREATE TEMPORARY TABLE organization_users (id VARCHAR(36), organization_id VARCHAR(36), user_id VARCHAR(36), role VARCHAR(50), is_active BOOLEAN)');
    await query('CREATE TEMPORARY TABLE organization_roles (id VARCHAR(36), organization_id VARCHAR(36), preset_code VARCHAR(50), is_active BOOLEAN)');
    await query('CREATE TEMPORARY TABLE organization_user_roles (organization_id VARCHAR(36), role_id VARCHAR(36), user_id VARCHAR(36))');
    await query("INSERT INTO organizations VALUES ('a','Company A',1),('b','Company B',1),('c','Inactive',0)");
    const users=[
      ['admin-a','a','admin-a@example.com','AdminA','member',1,'active'],
      ['multi','b','multi@example.com','Multi','member',1,'active'],
      ['removed','a','removed@example.com','Removed','administrator',1,'active'],
      ['suspended','a','suspended@example.com','Suspended','administrator',1,'suspended'],
      ['inactive','a','inactive@example.com','Inactive','administrator',0,'active'],
      ['label-only','a','label@example.com','Label','administrator',1,'active'],
      ['admin-b','b','admin-b@example.com','AdminB','member',1,'active'],
      ['disabled-org','c','disabled-org@example.com','Disabled','administrator',1,'active'],
    ];
    for(const row of users)await query('INSERT INTO users VALUES (?,?,?,?,?,?,?)',{replacements:row});
    await query("INSERT INTO organization_users VALUES ('m1','a','admin-a','administrator',1),('m2','a','removed','administrator',0),('m3','a','suspended','administrator',1),('m4','a','inactive','administrator',1),('m5','a','label-only','administrator',1),('m6','b','admin-b','administrator',1),('m7','b','multi','enduser',1),('m8','a','multi','administrator',1),('m9','c','disabled-org','administrator',1)");
    await query("INSERT INTO organization_roles VALUES ('ra','a','administrator',1),('rb','b','administrator',1),('rc','c','administrator',1),('rb-user','b','enduser',1)");
    await query("INSERT INTO organization_user_roles VALUES ('a','ra','admin-a'),('a','ra','removed'),('a','ra','suspended'),('a','ra','inactive'),('b','rb','admin-b'),('b','rb-user','multi'),('a','ra','multi'),('c','rc','disabled-org')");
    const connection={query,transaction:async fn=>fn(transaction)};
    const recipients=await administratorRecipients(connection);
    // 'multi' administers Company A and is an ordinary user in Company B, and is reminded only about A.
    assert.deepEqual(recipients.map(r=>`${r.organizationId}:${r.email}`).sort(),['a:admin-a@example.com','a:multi@example.com','b:admin-b@example.com']);
    const messages=[];const dependencies={sequelize:connection,send:async message=>{messages.push(message);}};
    const first=await sendQuarterlyTaxReminders(new Date('2026-10-15T00:00:00Z'),dependencies);
    assert.equal(first.sent,3);assert.equal(first.failed,0);
    assert.equal((await sendQuarterlyTaxReminders(new Date('2026-10-15T01:00:00Z'),dependencies)).sent,0);
    assert.equal(messages.length,3);assert(messages.every(message=>message.text.includes('/reports')));
    console.log('PASS MySQL: administrator recipient scoping, inactive memberships/users/roles/organizations excluded, delivery tracking and repeat suppression. No live emails or application records changed.');
  } finally {
    for(const table of tables)await query(`DROP TEMPORARY TABLE IF EXISTS ${table}`);
    await transaction.rollback();await sequelize.close();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
