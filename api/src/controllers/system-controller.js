const { servicesHealthy } = require('../services/runtime-services');

function health(req, res) {
  const status = req.app.locals.serviceStatus;
  const ok = servicesHealthy(status);
  return res.status(ok ? 200 : 503).json({ ok, services: status });
}

function root(req, res) {
  return res.json({
    message: 'Express API is running',
    services: req.app.locals.serviceStatus,
  });
}

module.exports = {
  health,
  root,
};
