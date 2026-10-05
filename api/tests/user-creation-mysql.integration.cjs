// Explicitly creates and removes a random, isolated local MySQL schema. Never uses app records or sends mail.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { Sequelize } = require('sequelize');

test('MySQL user creation: success, duplicate/racing email, and rollback/retry after access failures', {
  skip: process.env.RUN_USER_CREATION_MYSQL_INTEGRATION !== '1', timeout: 60000,
}, async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  const suffix = randomBytes(6).toString('hex'), schema = `user_creation_test_${suffix}`, login = `user_test_${suffix}`, password = randomBytes(24).toString('hex');
  const admin = sql => execFileSync('docker', ['exec', '-i', 'biz-assitant-mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  let db, provisioned = false;
  try {
    admin(`CREATE DATABASE ${schema}; CREATE USER '${login}'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON ${schema}.* TO '${login}'@'%';`); provisioned = true;
    db = new Sequelize(schema, login, password, { host: '127.0.0.1', port: 3306, dialect: 'mysql', logging: false });
    const models = {
      Organization: require('../src/models/organization').initOrganizationModel(db),
      User: require('../src/models/user').initUserModel(db),
      Role: require('../src/models/role').initRoleModel(db),
      OrganizationUser: require('../src/models/organization-user').initOrganizationUserModel(db),
      UserRole: require('../src/models/user-role').initUserRoleModel(db),
      Token: { update: async () => {}, create: async () => {} },
    };
    const { User, Role, UserRole, OrganizationUser, Organization } = models;
    User.belongsTo(Organization, { foreignKey: 'organizationId' });
    Organization.belongsToMany(User, { through: OrganizationUser, as: 'users', foreignKey: 'organizationId', otherKey: 'userId' });
    User.belongsToMany(Role, { through: UserRole, as: 'roles', foreignKey: 'userId', otherKey: 'roleId' });
    UserRole.belongsTo(User, { as: 'assigner', foreignKey: 'assignedByUserId' });
    await db.sync();
    const org = await Organization.create({ name: 'Synthetic test', addressLine1: 'Fixture', city: 'Fixture', country: 'Philippines', contactEmail: 'fixture@example.test', phone: '0' });
    const actor = await User.create({ organizationId: org.id, firstName: 'Actor', lastName: 'Fixture', email: 'actor@example.test', password: 'test-only-password' });
    const role = await Role.create({ name: 'Enduser', code: 'enduser' });
    let sent = 0;
    const filename = require.resolve('../src/controllers/users-controller'), actual = createRequire(filename), module = { exports: {} };
    const mocks = {
      '../sequelize': { getModels: () => models },
      '../services/email-service': { sendOrganizationUserInviteEmail: async () => { sent++; }, sendUserCreatedAdminNotificationEmail: async () => {} },
      '../services/message-service': { getActorDisplayName: () => 'Fixture actor', createOrganizationMessage: async () => {} },
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, process, Date,
      require: name => mocks[name] || actual(name), console: { error() {}, warn() {} } }, { filename });
    const create = async email => {
      const req = { body: { organizationId: org.id, firstName: 'New', lastName: 'Fixture', email, password: 'test-only-password', roleIds: [role.id] },
        auth: { userId: actor.id, roleCodes: ['administrator'], user: { id: actor.id, organizationId: org.id } }, ip: '127.0.0.1', get: () => '' };
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await module.exports.createUser(req, res); return res;
    };
    const success = await create('success@example.test'); assert.equal(success.statusCode, 201, success.body.message);
    assert.equal(success.body.data.password, undefined);
    const userId = success.body.data.id;
    assert.equal(await UserRole.count({ where: { userId } }), 1);
    assert.equal(await OrganizationUser.count({ where: { userId, isPrimary: true } }), 1);
    assert.equal(await require('bcryptjs').compare('test-only-password', (await User.findByPk(userId)).password), true);
    const duplicate = await create(' SUCCESS@example.test '); assert.equal(duplicate.statusCode, 409); assert.match(duplicate.body.message, /email already exists/);
    assert.equal(sent, 1);
    for (const [model, hook, email] of [[OrganizationUser, 'beforeCreate', 'membership-failure@example.test'], [UserRole, 'beforeBulkCreate', 'role-failure@example.test']]) {
      const before = [await User.count(), await OrganizationUser.count(), await UserRole.count(), sent];
      model.addHook(hook, 'inject_failure', () => { throw new Error('Injected access write failure'); });
      const failed = await create(email); model.removeHook(hook, 'inject_failure');
      assert.equal(failed.statusCode, 500);
      assert.deepEqual([await User.count(), await OrganizationUser.count(), await UserRole.count(), sent], before);
      assert.equal(await User.count({ where: { email } }), 0);
      assert.equal((await create(email)).statusCode, 201);
    }
    // Both requests pass the precheck; MySQL's email constraint must resolve the race.
    const originalFindOne = User.findOne; let checks = 0, release; const gate = new Promise(resolve => { release = resolve; });
    User.findOne = async function(options) {
      if (options.where?.email === 'race@example.test') { if (++checks === 2) release(); await gate; return null; }
      return originalFindOne.call(this, options);
    };
    let raced;
    try { raced = await Promise.all([create('race@example.test'), create('race@example.test')]); }
    finally { User.findOne = originalFindOne; }
    assert.deepEqual(raced.map(result => result.statusCode).sort(), [201, 409]);
    assert.match(raced.find(result => result.statusCode === 409).body.message, /email already exists/);
    const raceUser = await User.findOne({ where: { email: 'race@example.test' } });
    assert.equal(await User.count({ where: { email: raceUser.email } }), 1);
    assert.equal(await UserRole.count({ where: { userId: raceUser.id } }), 1);
    assert.equal(await OrganizationUser.count({ where: { userId: raceUser.id } }), 1);
  } finally {
    if (db) await db.close();
    if (provisioned) admin(`DROP DATABASE IF EXISTS ${schema}; DROP USER IF EXISTS '${login}'@'%';`);
  }
});
