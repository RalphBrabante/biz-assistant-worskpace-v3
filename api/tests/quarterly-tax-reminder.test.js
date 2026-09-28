const {test} = require('node:test');
const assert = require('node:assert/strict');
const {reminderPeriod,reminderMessage,sendQuarterlyTaxReminders} = require('../src/jobs/quarterly-tax-reminder-job');
test('reminders target the previous quarter 15 days after its end at 08:00 UTC+8',()=>{
  for(const [date,year,quarter,end] of [
    ['2027-01-15',2026,4,'2026-12-31'],['2026-04-15',2026,1,'2026-03-31'],
    ['2026-07-15',2026,2,'2026-06-30'],['2026-10-15',2026,3,'2026-09-30'],
    ['2028-04-15',2028,1,'2028-03-31'],
  ]) assert.deepEqual(reminderPeriod(new Date(`${date}T00:00:00Z`)),{year,quarter,end});
  for(const date of ['2026-10-14T23:59:59Z','2026-10-15T16:00:00Z','2026-09-15T00:00:00Z','2026-10-16T00:00:00Z']) assert.equal(reminderPeriod(new Date(date)),null);
  assert.equal(reminderPeriod(new Date('2026-10-15T15:59:59Z')).quarter,3);
});
test('email identifies the organization and quarter and links to Reports with escaped content',()=>{
  const message=reminderMessage({organizationName:'<Company>',firstName:'<Admin>',email:'admin@example.com'},{year:2026,quarter:3,end:'2026-09-30'});
  assert.match(message.subject,/Q3 2026/);assert.match(message.text,/15 days/);assert.match(message.text,/\/reports/);
  assert.match(message.html,/&lt;Company&gt;/);assert.doesNotMatch(message.html,/<Admin>/);assert.equal(message.toEmail,'admin@example.com');
});
function fixture(){
  const delivered=new Set(),messages=[];let failEmail='';let reads=0;
  const recipients=[{organizationId:'org-a',organizationName:'Company',email:'ADMIN@example.com',firstName:'Admin'},{organizationId:'org-a',organizationName:'Company',email:'admin@example.com',firstName:'Duplicate'},{organizationId:'org-a',organizationName:'Company',email:'second@example.com',firstName:'Second'}];
  const sequelize={async transaction(fn){return fn({});},async query(sql,options){
    if(sql.includes('SELECT DISTINCT')){reads++;return [recipients.map(r=>({...r}))];}
    const key=JSON.stringify(options.replacements);
    if(sql.startsWith('SELECT sent_at'))return [[{sent_at:delivered.has(key)?new Date():null}]];
    if(sql.startsWith('UPDATE'))delivered.add(key);
    return [[],{}];
  }};
  return {sequelize,messages,delivered,reads:()=>reads,fail:email=>{failEmail=email;},send:async m=>{if(m.toEmail===failEmail)throw Error('Test mail failure');messages.push(m);}};
}
test('non-reminder dates never query the database or send mail',async()=>{
  const f=fixture();assert.equal((await sendQuarterlyTaxReminders(new Date('2026-09-28T00:00:00Z'),f)).skipped,true);assert.equal(f.reads(),0);
});
test('deduplicates recipient emails and successful deliveries across repeated runs',async()=>{
  const f=fixture(),now=new Date('2026-10-15T00:00:00Z');
  assert.equal((await sendQuarterlyTaxReminders(now,f)).sent,2);
  assert.equal((await sendQuarterlyTaxReminders(now,f)).sent,0);assert.equal(f.messages.length,2);
  assert.equal((await sendQuarterlyTaxReminders(new Date('2027-01-15T00:00:00Z'),f)).sent,2);
});
test('failed deliveries are retried without resending successful recipients',async()=>{
  const f=fixture(),now=new Date('2026-10-15T00:00:00Z');f.fail('second@example.com');
  assert.deepEqual(await sendQuarterlyTaxReminders(now,f),{sent:1,failed:1,skipped:false});f.fail('');
  assert.deepEqual(await sendQuarterlyTaxReminders(now,f),{sent:1,failed:0,skipped:false});assert.equal(f.messages.length,2);
});
