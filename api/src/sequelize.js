const { Sequelize } = require('sequelize');
const { initModels } = require('./models');
const sequelizeConfig = require('./config/config');

let sequelize;
let models;

function getActiveConfig() {
  const env = sequelizeConfig.env || 'development';
  return sequelizeConfig[env] || sequelizeConfig.development;
}

function initSequelize() {
  if (!sequelize) {
    const config = getActiveConfig();
    sequelize = new Sequelize(
      config.database,
      config.username,
      config.password,
      config
    );
  }

  return sequelize;
}

async function authenticateSequelize() {
  const instance = initSequelize();
  await instance.authenticate();
  if (!models) {
    models = initModels(instance);
  }
  return instance;
}

module.exports = {
  initSequelize,
  authenticateSequelize,
  getModels: () => models,
};
