function serviceEnabled(name, env = process.env) {
  if (env[`${name}_ENABLED`] !== undefined) return env[`${name}_ENABLED`] === 'true';
  return Boolean(env[`${name}_URL`]) || env.NODE_ENV !== 'production';
}
function servicesHealthy(status = {}) {
  return status.mysql === true && ['redis', 'amqp'].every((key) => status[key] === true || status[key] === 'disabled');
}
module.exports = { serviceEnabled, servicesHealthy };
