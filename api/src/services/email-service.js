const { buildPasswordResetTemplate } = require('../templates/emails/password-reset-template');
const { buildEmailVerificationTemplate } = require('../templates/emails/email-verification-template');
const {
  buildOrganizationUserInviteTemplate,
} = require('../templates/emails/organization-user-invite-template');
const {
  buildLicenseRevokedTemplate,
} = require('../templates/emails/license-revoked-template');

async function sendViaSmtp2go({ toEmail, subject, html, text }) {
  const apiKey = String(process.env.SMTP2GO_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  const endpoint = String(
    process.env.SMTP2GO_API_URL || 'https://api.smtp2go.com/v3/email/send'
  ).trim();
  const fromEmail = String(
    process.env.SMTP_FROM_EMAIL || 'no-reply@bizassistant.local'
  ).trim();
  const fromName = String(process.env.SMTP_FROM_NAME || 'Biz Assistant').trim();

  const payload = {
    sender: fromEmail,
    sender_name: fromName,
    to: [toEmail],
    subject,
    html_body: html,
    text_body: text,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Smtp2go-Api-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    parsed = null;
  }

  if (!response.ok) {
    const reason = parsed?.data?.error || parsed?.error || raw || `HTTP ${response.status}`;
    console.error(
      `[EMAIL][SMTP2GO][FAILED] to=${toEmail} subject="${subject}" status=${response.status} reason="${reason}"`
    );
    throw new Error(`SMTP2GO send failed: ${reason}`);
  }

  if (parsed && String(parsed.data?.succeeded || '0') === '0') {
    const reason = parsed?.data?.error || 'SMTP2GO rejected message.';
    console.error(
      `[EMAIL][SMTP2GO][FAILED] to=${toEmail} subject="${subject}" status=200 reason="${reason}"`
    );
    throw new Error(`SMTP2GO send failed: ${reason}`);
  }

  const requestId = parsed?.data?.email_id || parsed?.data?.request_id || '-';
  console.log(
    `[EMAIL][SMTP2GO][SENT] to=${toEmail} subject="${subject}" requestId=${requestId}`
  );
  return parsed || { ok: true };
}

async function sendMail({ toEmail, subject, html, text }) {
  const smtp2goApiKey = String(process.env.SMTP2GO_API_KEY || '').trim();
  if (!smtp2goApiKey) {
    console.error(
      `[EMAIL][SMTP2GO][FAILED] to=${toEmail} subject="${subject}" reason="SMTP2GO_API_KEY missing"`
    );
    throw new Error('SMTP2GO_API_KEY is required. SMTP credentials fallback is disabled.');
  }
  try {
    return await sendViaSmtp2go({ toEmail, subject, html, text });
  } catch (err) {
    console.error(
      `[EMAIL][SMTP2GO][FAILED] to=${toEmail} subject="${subject}" error="${err.message}"`
    );
    throw err;
  }
}

async function sendPasswordResetEmail({
  toEmail,
  toName,
  resetUrl,
  expiresInMinutes = 30,
}) {
  const template = buildPasswordResetTemplate({
    brandName: String(process.env.APP_NAME || 'Biz Assistant').trim(),
    recipientName: toName,
    resetUrl,
    expiresInMinutes,
  });

  return sendMail({
    toEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

async function sendEmailVerificationEmail({
  toEmail,
  toName,
  verifyUrl,
  expiresInMinutes = 60,
}) {
  const template = buildEmailVerificationTemplate({
    brandName: String(process.env.APP_NAME || 'Biz Assistant').trim(),
    recipientName: toName,
    verifyUrl,
    expiresInMinutes,
  });

  return sendMail({
    toEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

async function sendOrganizationUserInviteEmail({
  toEmail,
  toName,
  organizationName,
  setPasswordUrl,
  expiresInMinutes = 30,
}) {
  const template = buildOrganizationUserInviteTemplate({
    brandName: String(process.env.APP_NAME || 'Biz Assistant').trim(),
    recipientName: toName,
    organizationName,
    setPasswordUrl,
    expiresInMinutes,
  });

  return sendMail({
    toEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

async function sendQuarterlyExpenseReportReadyEmail({
  toEmail,
  toName,
  organizationName,
  quarter,
  year,
  reportUrl,
}) {
  const brandName = String(process.env.APP_NAME || 'Biz Assistant').trim();
  const safeRecipient = toName || 'there';
  const safeOrganization = organizationName || 'your organization';
  const safeQuarter = String(quarter || '').trim() || 'Q?';
  const safeYear = String(year || '').trim() || '';
  const subject = `${brandName} ${safeQuarter} ${safeYear} Expense Report Ready`;

  const html = `
<p>Hi ${safeRecipient},</p>
<p>
  The quarterly expense report for <strong>${safeOrganization}</strong>
  (${safeQuarter} ${safeYear}) has been generated.
</p>
<p>
  <a href="${reportUrl}" style="color:#2563eb;">Open report preview</a>
</p>
<p>If the link does not work, copy and open this URL:</p>
<p>${reportUrl}</p>
`.trim();

  const text = [
    `Hi ${safeRecipient},`,
    '',
    `The quarterly expense report for ${safeOrganization} (${safeQuarter} ${safeYear}) has been generated.`,
    '',
    `Open report preview: ${reportUrl}`,
  ].join('\n');

  return sendMail({
    toEmail,
    subject,
    html,
    text,
  });
}

async function sendOrderCreatedEmail({
  toEmail,
  toName,
  organizationName,
  orderNumber,
  orderUrl,
}) {
  const brandName = String(process.env.APP_NAME || 'Biz Assistant').trim();
  const safeRecipient = toName || 'there';
  const safeOrganization = organizationName || 'your organization';
  const safeOrderNumber = String(orderNumber || '').trim() || 'N/A';
  const safeOrderUrl = String(orderUrl || '').trim();
  const subject = `${brandName} Order Created: ${safeOrderNumber}`;

  const html = `
<p>Hi ${safeRecipient},</p>
<p>
  A new order <strong>${safeOrderNumber}</strong> was created for
  <strong>${safeOrganization}</strong>.
</p>
<p>
  <a href="${safeOrderUrl}" style="color:#2563eb;">Open order details</a>
</p>
<p>If the link does not work, copy and open this URL:</p>
<p>${safeOrderUrl}</p>
`.trim();

  const text = [
    `Hi ${safeRecipient},`,
    '',
    `A new order ${safeOrderNumber} was created for ${safeOrganization}.`,
    '',
    `Open order details: ${safeOrderUrl}`,
  ].join('\n');

  return sendMail({
    toEmail,
    subject,
    html,
    text,
  });
}

async function sendLicenseRevokedEmail({
  toEmail,
  toName,
  organizationName,
  licenseKey,
  licensesUrl,
}) {
  const template = buildLicenseRevokedTemplate({
    brandName: String(process.env.APP_NAME || 'Biz Assistant').trim(),
    recipientName: toName,
    organizationName,
    licenseKey,
    licensesUrl,
  });

  return sendMail({
    toEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

async function sendUserCreatedAdminNotificationEmail({
  toEmail,
  toName,
  organizationName,
  createdUserName,
  createdUserEmail,
  roleLabels = [],
  userUrl,
}) {
  const brandName = String(process.env.APP_NAME || 'Biz Assistant').trim();
  const safeRecipient = toName || 'there';
  const safeOrganization = organizationName || 'your organization';
  const safeCreatedUserName = String(createdUserName || '').trim() || 'New user';
  const safeCreatedUserEmail = String(createdUserEmail || '').trim() || '-';
  const safeUserUrl = String(userUrl || '').trim();
  const roleText = Array.isArray(roleLabels) && roleLabels.length > 0 ? roleLabels.join(', ') : 'N/A';
  const subject = `${brandName} User Created: ${safeCreatedUserName}`;

  const html = `
<p>Hi ${safeRecipient},</p>
<p>
  A new user was created under <strong>${safeOrganization}</strong>.
</p>
<p><strong>Name:</strong> ${safeCreatedUserName}</p>
<p><strong>Email:</strong> ${safeCreatedUserEmail}</p>
<p><strong>Assigned roles:</strong> ${roleText}</p>
<p>
  <a href="${safeUserUrl}" style="color:#2563eb;">Open user details</a>
</p>
<p>If the link does not work, copy and open this URL:</p>
<p>${safeUserUrl}</p>
`.trim();

  const text = [
    `Hi ${safeRecipient},`,
    '',
    `A new user was created under ${safeOrganization}.`,
    `Name: ${safeCreatedUserName}`,
    `Email: ${safeCreatedUserEmail}`,
    `Assigned roles: ${roleText}`,
    '',
    `Open user details: ${safeUserUrl}`,
  ].join('\n');

  return sendMail({
    toEmail,
    subject,
    html,
    text,
  });
}

module.exports = {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
  sendOrganizationUserInviteEmail,
  sendQuarterlyExpenseReportReadyEmail,
  sendOrderCreatedEmail,
  sendLicenseRevokedEmail,
  sendUserCreatedAdminNotificationEmail,
};
