// Bank management is temporarily restricted by role, regardless of permission grants.
function requireBankAdministrator(req, res, next) {
  if (!req.auth) return res.status(401).json({message: 'Authentication required.'});
  const roles = (req.auth.roleCodes || []).map(code => String(code || '').toLowerCase());
  if (!roles.some(role => role === 'administrator' || role === 'superuser')) {
    return res.status(403).json({message: 'Bank management is available only to administrators and superusers.'});
  }
  return next();
}
module.exports = {requireBankAdministrator};
