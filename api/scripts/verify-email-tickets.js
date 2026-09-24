// Uses the configured MySQL database; every fixture is rolled back, with no mail sent.
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {authenticateSequelize, getModels} = require('../src/sequelize');
const {importThread} = require('../src/services/gmail-tickets');
const {fields} = require('../src/controllers/tickets-controller');
const {importMessage} = require('../src/services/hostinger-tickets');
(async () => {
  const sequelize = await authenticateSequelize();
  const models = getModels();
  const transaction = await sequelize.transaction();
  try {
    const suffix = randomUUID();
    const org = await models.Organization.create({name: `Ticket test ${suffix}`, addressLine1: 'Test only', city: 'Test', country: 'Philippines', contactEmail: 'test@example.com', phone: '000'}, {transaction});
    const other = await models.Organization.create({name: `Other ticket test ${suffix}`, addressLine1: 'Test only', city: 'Test', country: 'Philippines', contactEmail: 'test@example.com', phone: '000'}, {transaction});
    const user = await models.User.create({organizationId: org.id, firstName: 'Ticket', lastName: 'Tester', email: `${suffix}@example.com`, password: randomUUID(), isActive: true}, {transaction});
    const customer = await models.Customer.create({organizationId: org.id, name: 'Ticket test customer', taxId: suffix, email: 'ticket-test@example.com'}, {transaction});
    const mailbox = await models.GmailMailbox.create({organizationId: org.id, email: `support-${suffix}@example.com`}, {transaction});
    const thread = {id: 'test-thread', messages: [{id: 'test-message', internalDate: String(Date.now()), labelIds: ['INBOX'], payload: {headers: [{name: 'From', value: 'ticket-test@example.com'}, {name: 'Subject', value: 'Test ticket'}], mimeType: 'text/plain', body: {data: Buffer.from('Integration test body').toString('base64url')}}}]};
    await importThread(models, mailbox, thread, transaction);
    await importThread(models, mailbox, thread, transaction);
    const ticket = await models.EmailTicket.findOne({where: {organizationId: org.id}, transaction});
    assert.equal(ticket.customerId, customer.id);
    assert.equal(await models.TicketMessage.count({where: {ticketId: ticket.id}, transaction}), 1);
    const values = await fields(models, org.id, {assigneeId: user.id, customerId: customer.id, priority: 4, status: 'resolved'}, transaction);
    await ticket.update(values, {transaction});
    await assert.rejects(fields(models, other.id, {assigneeId: user.id}, transaction), /teammate/);
    await assert.rejects(fields(models, other.id, {customerId: customer.id}, transaction), /customer/);
    assert.equal(await models.EmailTicket.findOne({where: {id: ticket.id, organizationId: other.id}, transaction}), null);
    const populated = await models.EmailTicket.findOne({where: {id: ticket.id}, include: ['customer', 'assignee'], transaction});
    assert.equal(populated.assignee.id, user.id); assert.equal(populated.customer.id, customer.id);
    thread.messages.push({...thread.messages[0], id: 'test-followup', internalDate: String(Date.now() + 2000)});
    await importThread(models, mailbox, thread, transaction);
    await ticket.reload({transaction}); assert.equal(ticket.status, 'open'); assert.equal(ticket.assigneeId, user.id);
    await assert.rejects(models.EmailTicket.create({organizationId: org.id, mailboxId: mailbox.id, gmailThreadId: thread.id, subject: 'Duplicate', requesterEmail: 'ticket-test@example.com'}, {transaction}), error => error.name === 'SequelizeUniqueConstraintError');
    const hostMailbox = await models.GmailMailbox.create({organizationId: other.id, provider: 'hostinger', email: `hostinger-${suffix}@example.com`, imapState: {INBOX: {validity: '123', lastUid: 5}}}, {transaction});
    await hostMailbox.reload({transaction}); assert.equal(hostMailbox.imapState.INBOX.lastUid, 5);
    const incoming = {messageId: '<hostinger-test@example.com>', subject: 'Hostinger test', from: {value: [{address: 'requester@example.com'}]}, text: 'Hostinger body'};
    const source = {identity: 'INBOX:123:6', date: new Date(), sentFolder: false};
    await importMessage(models, hostMailbox, incoming, source, transaction);
    await importMessage(models, hostMailbox, incoming, {...source, identity: 'INBOX:456:1'}, transaction);
    const hostTicket = await models.EmailTicket.findOne({where: {mailboxId: hostMailbox.id}, transaction});
    assert.equal(hostTicket.organizationId, other.id); assert.equal(hostTicket.gmailThreadId, null);
    assert.equal(await models.TicketMessage.count({where: {ticketId: hostTicket.id}, transaction}), 1);
    await importMessage(models, hostMailbox, {...incoming, messageId: '<hostinger-reply@example.com>', inReplyTo: incoming.messageId}, {...source, identity: 'INBOX:123:7', date: new Date(Date.now() + 3000)}, transaction);
    assert.equal(await models.EmailTicket.count({where: {mailboxId: hostMailbox.id}, transaction}), 1);
    assert.equal(await models.TicketMessage.count({where: {ticketId: hostTicket.id}, transaction}), 2);
    console.log('PASS: MySQL Gmail/Hostinger models, JSON cursors, thread grouping, customer matching, deduplication, organization isolation, assignments, joins, reopening, and unique constraints.');
  } finally {
    await transaction.rollback();
    await sequelize.close();
    console.log('All test fixtures rolled back. No email sent.');
  }
})().catch(error => {console.error(error.message); process.exitCode = 1;});
