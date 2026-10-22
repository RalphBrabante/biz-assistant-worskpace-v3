const express = require('express');
const { authenticateRequest } = require('../middleware/authz');
const { rateLimit, clientIp, bodyEmail } = require('../middleware/rate-limit');
const {
  login,
  getSession,
  forgotPassword,
  resetPassword,
  requestEmailVerification,
  verifyEmail,
} = require('../controllers/auth-controller');

const router = express.Router();

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const loginPerIp = rateLimit({ name: 'login_ip', windowMs: FIFTEEN_MINUTES, max: 30, key: clientIp });
const loginPerAccount = rateLimit({
  name: 'login_ip_email',
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  key: (req) => (bodyEmail(req) ? `${clientIp(req)}|${bodyEmail(req)}` : null),
});
const emailLinkPerIp = rateLimit({ name: 'email_link_ip', windowMs: ONE_HOUR, max: 10, key: clientIp });
// Counted for every address, registered or not, so the limit itself reveals nothing
const emailLinkPerAddress = rateLimit({
  name: 'email_link_address',
  windowMs: ONE_HOUR,
  max: 3,
  key: bodyEmail,
  message: 'Too many emails requested for this address. Please check your inbox or try again later.',
});
const tokenRedeemPerIp = rateLimit({ name: 'token_redeem_ip', windowMs: FIFTEEN_MINUTES, max: 20, key: clientIp });

router.post('/login', loginPerIp, loginPerAccount, login);
router.get('/session', authenticateRequest, getSession);
router.post('/forgot-password', emailLinkPerIp, emailLinkPerAddress, forgotPassword);
router.post('/reset-password', tokenRedeemPerIp, resetPassword);
router.post('/request-email-verification', emailLinkPerIp, emailLinkPerAddress, requestEmailVerification);
router.post('/verify-email', tokenRedeemPerIp, verifyEmail);

module.exports = router;
