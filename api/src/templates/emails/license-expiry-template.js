function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// daysRemaining <= 0 renders the "expired" notice; otherwise an advance warning.
function buildLicenseExpiryTemplate({
  brandName = 'Biz Assistant',
  recipientName,
  organizationName,
  planName,
  expiresOn,
  daysRemaining,
  licensesUrl,
}) {
  const expired = daysRemaining <= 0;
  const organization = organizationName || 'your organization';
  const heading = expired ? 'License Expired' : `License Expires in ${plural(daysRemaining, 'Day')}`;
  const subject = expired
    ? `${brandName} license expired: ${organization}`
    : `${brandName} license for ${organization} expires in ${plural(daysRemaining, 'day')}`;
  const summary = expired
    ? `The ${planName || ''} license for ${organization} expired on ${expiresOn}. Members can no longer sign in to this organization until the license is renewed.`
    : `The ${planName || ''} license for ${organization} expires on ${expiresOn}. Renew it before then to keep everyone signed in without interruption.`;
  const action = expired
    ? 'Contact your provider to renew the license and restore access.'
    : 'Contact your provider to renew. Time added to a renewal starts from the current expiry date, so renewing early loses nothing.';
  const accent = expired ? '#dc2626' : '#d97706';
  const tint = expired ? '#fff1f2' : '#fffbeb';
  const border = expired ? '#fecaca' : '#fde68a';
  const ink = expired ? '#7f1d1d' : '#78350f';

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 14px 36px rgba(15,23,42,.08);">
            <tr>
              <td style="background:${accent};padding:24px 28px;color:#fff;">
                <div style="font-size:14px;opacity:.95;">${escapeHtml(brandName)}</div>
                <div style="font-size:24px;font-weight:700;margin-top:6px;">${escapeHtml(heading)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 12px;font-size:15px;">Hi ${escapeHtml(recipientName || 'there')},</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">${escapeHtml(summary)}</p>
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 18px;border:1px solid ${border};background:${tint};border-radius:12px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:14px;line-height:1.6;color:${ink};">
                      <div style="margin-bottom:6px;"><strong>Organization:</strong> ${escapeHtml(organization)}</div>
                      <div style="margin-bottom:6px;"><strong>Plan:</strong> ${escapeHtml(planName || '-')}</div>
                      <div><strong>${expired ? 'Expired on' : 'Expires on'}:</strong> ${escapeHtml(expiresOn)}</div>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(action)}</p>
                ${expired ? '' : `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 18px;">
                  <tr>
                    <td align="center" style="border-radius:10px;background:${accent};">
                      <a href="${escapeHtml(licensesUrl)}" style="display:inline-block;padding:12px 22px;color:#fff;text-decoration:none;font-size:15px;font-weight:600;">Review License</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:13px;color:#64748b;">If the button does not work, use this link:</p>
                <p style="margin:0;word-break:break-all;font-size:13px;color:#1d4ed8;">${escapeHtml(licensesUrl)}</p>`}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();

  const text = [
    `${brandName} ${heading}`,
    '',
    `Hi ${recipientName || 'there'},`,
    '',
    summary,
    '',
    `Organization: ${organization}`,
    `Plan: ${planName || '-'}`,
    `${expired ? 'Expired on' : 'Expires on'}: ${expiresOn}`,
    '',
    action,
    ...(expired ? [] : ['', `Review license: ${licensesUrl || ''}`]),
  ].join('\n');

  return { subject, html, text };
}

module.exports = {
  buildLicenseExpiryTemplate,
};
