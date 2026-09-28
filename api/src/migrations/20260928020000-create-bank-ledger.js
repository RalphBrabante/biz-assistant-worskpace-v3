'use strict';
const { ensureIndex } = require('../database/resumable-index');
const {randomUUID} = require('crypto');
module.exports = {
  async up(q, S) {
    const required = type => ({type, allowNull: false});
    const id = () => ({...required(S.UUID), primaryKey: true});
    const ref = table => ({...required(S.UUID), references: {model: table, key: 'id'}, onDelete: 'RESTRICT', onUpdate: 'CASCADE'});
    const timestamps = () => ({created_at: required(S.DATE), updated_at: required(S.DATE)});
    await q.createTable('bank_accounts', {
      id: id(), organization_id: ref('organizations'), name: required(S.STRING(120)), bank_name: required(S.STRING(120)),
      last_four: S.STRING(4), currency: required(S.STRING(3)), balance: {...required(S.DECIMAL(14,2)), defaultValue: '0.00'},
      is_archived: {...required(S.BOOLEAN), defaultValue: false}, notes: S.TEXT, ...timestamps(),
    });
    await ensureIndex(q, 'bank_accounts', ['organization_id', 'is_archived'], {name: 'bank_accounts_org_status'});
    await q.createTable('bank_operations', {
      id: id(), organization_id: ref('organizations'), request_key: required(S.UUID), fingerprint: required(S.STRING(64)),
      kind: required(S.STRING(20)), reversal_of: {type:S.UUID, allowNull:true, references:{model:'bank_operations',key:'id'}, onDelete:'RESTRICT'},
      created_by: {type: S.UUID, references: {model:'users',key:'id'}, onDelete:'SET NULL'}, ...timestamps(),
    });
    await ensureIndex(q, 'bank_operations', ['organization_id', 'request_key'], {unique:true, name:'bank_operations_request'});
    await ensureIndex(q, 'bank_operations', ['reversal_of'], {unique:true, name:'bank_operations_reversal'});
    await q.createTable('bank_entries', {
      id: {type:S.BIGINT.UNSIGNED, primaryKey:true, autoIncrement:true, allowNull:false}, organization_id: ref('organizations'),
      account_id: ref('bank_accounts'), operation_id: ref('bank_operations'), kind: required(S.STRING(20)), direction: required(S.STRING(10)),
      amount: required(S.DECIMAL(14,2)), balance_after: required(S.DECIMAL(14,2)), posted_on: required(S.DATEONLY),
      reference: S.STRING(200), notes: S.TEXT, ...timestamps(),
    });
    await ensureIndex(q, 'bank_entries', ['account_id','id'], {name:'bank_entries_account_sequence'});
    await ensureIndex(q, 'bank_entries', ['operation_id'], {name:'bank_entries_operation'});
    const now = new Date();
    for (const action of ['read','manage','transact']) {
      const [rows] = await q.sequelize.query('SELECT id FROM permissions WHERE code = :code', {replacements:{code:`banks.${action}`}});
      if (!rows.length) await q.bulkInsert('permissions',[{id:randomUUID(),name:`Banks: ${action}`,code:`banks.${action}`,resource:'banks',action,description:`Bank ledger: ${action}`,is_system:true,is_active:true,created_at:now,updated_at:now}]);
    }
  },
  async down(q) {await q.dropTable('bank_entries'); await q.dropTable('bank_operations'); await q.dropTable('bank_accounts');},
};
