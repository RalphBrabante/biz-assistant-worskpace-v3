'use strict';
module.exports = {
  async up(q,S) {
    const ref=(table)=>({type:S.UUID,allowNull:false,references:{model:table,key:'id'},onDelete:'CASCADE',onUpdate:'CASCADE'});
    const id=()=>({type:S.UUID,allowNull:false,primaryKey:true});
    const times=()=>({created_at:{type:S.DATE,allowNull:false},updated_at:{type:S.DATE,allowNull:false}});
    await q.createTable('organization_roles',{id:id(),organization_id:ref('organizations'),name:{type:S.STRING(100),allowNull:false},code:{type:S.STRING(100),allowNull:false},description:S.TEXT,is_active:{type:S.BOOLEAN,allowNull:false,defaultValue:true},...times()});
    await q.addIndex('organization_roles',['organization_id','code'],{unique:true,name:'organization_roles_code'});
    await q.addIndex('organization_roles',['organization_id','name'],{unique:true,name:'organization_roles_name'});
    await q.createTable('organization_role_permissions',{id:id(),role_id:ref('organization_roles'),permission_id:ref('permissions'),...times()});
    await q.addIndex('organization_role_permissions',['role_id','permission_id'],{unique:true,name:'organization_role_permissions_unique'});
    await q.createTable('organization_user_roles',{id:id(),organization_id:ref('organizations'),role_id:ref('organization_roles'),user_id:ref('users'),...times()});
    await q.addIndex('organization_user_roles',['organization_id','role_id','user_id'],{unique:true,name:'organization_user_roles_unique'});
  },
  async down(q){await q.dropTable('organization_user_roles');await q.dropTable('organization_role_permissions');await q.dropTable('organization_roles');},
};
