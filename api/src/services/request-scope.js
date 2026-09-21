function isPrivilegedRequest(req) {
  const roleCodes = req?.auth?.roleCodes || [];
  return roleCodes.some((code) => String(code || '').toLowerCase() === 'superuser');
}

function getAuthenticatedOrganizationId(req) {
  return req?.auth?.user?.organizationId || null;
}

function getScopedOrganizationId(req, fallback = null) {
  const authOrgId = getAuthenticatedOrganizationId(req);
  if (isPrivilegedRequest(req)) {
    return req?.query?.organizationId || req?.body?.organizationId || fallback || authOrgId;
  }
  return authOrgId || fallback;
}

function applyOrganizationWhereScope(where, req, key = 'organizationId') {
  const nextWhere = where || {};
  if (isPrivilegedRequest(req)) {
    return nextWhere;
  }

  const authOrgId = getAuthenticatedOrganizationId(req);
  if (!authOrgId) {
    return null;
  }

  nextWhere[key] = authOrgId;
  return nextWhere;
}

function assertOrganizationAccess(req, organizationId) {
  if (isPrivilegedRequest(req)) {
    return true;
  }

  const authOrgId = getAuthenticatedOrganizationId(req);
  return Boolean(authOrgId && organizationId && authOrgId === organizationId);
}

module.exports = {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  getScopedOrganizationId,
  applyOrganizationWhereScope,
  assertOrganizationAccess,
};
