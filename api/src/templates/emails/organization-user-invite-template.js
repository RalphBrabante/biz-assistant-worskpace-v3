function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildOrganizationUserInviteTemplate({
  brandName = 'Biz Assistant',
  recipientName,
  organizationName,
  setPasswordUrl,
  expiresInMinutes = 30,
}) {
  const safeName = escapeHtml(recipientName || 'there');
  const safeOrganizationName = escapeHtml(organizationName || 'your organization');
  const safeUrl = escapeHtml(setPasswordUrl);
  const subject = `${brandName} Organization Access Invitation`;

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#f3f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,.08);">
            <tr>
              <td style="background:linear-gradient(135deg,#0ea5e9 0%,#2563eb 100%);padding:24px 28px;color:#fff;">
                <div style="font-size:14px;opacity:.95;">${escapeHtml(brandName)}</div>
                <div style="font-size:22px;font-weight:700;margin-top:6px;">You Were Added to an Organization</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 12px;font-size:15px;">Hi ${safeName},</p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#334155;">
                  You were added to <strong>${safeOrganizationName}</strong> in ${escapeHtml(brandName)}.
                  Please set your password using the button below. This link will expire in
                  <strong>${escapeHtml(expiresInMinutes)}</strong> minutes.
                </p>

                <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 20px;">
                  <tr>
                    <td align="center" style="border-radius:10px;background:#2563eb;">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;color:#fff;text-decoration:none;font-size:15px;font-weight:600;">
                        Set Password
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 8px;font-size:13px;color:#64748b;">If the button does not work, use this link:</p>
                <p style="margin:0 0 16px;word-break:break-all;font-size:13px;color:#1d4ed8;">${safeUrl}</p>

                <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
                  If you were not expecting this invitation, contact your administrator.
                </p>
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
    `${brandName} Organization Access Invitation`,
    '',
    `Hi ${recipientName || 'there'},`,
    '',
    `You were added to ${organizationName || 'your organization'} in ${brandName}.`,
    `Set your password using this link (expires in ${expiresInMinutes} minutes):`,
    setPasswordUrl,
    '',
    'If you were not expecting this invitation, contact your administrator.',
  ].join('\n');

  return { subject, html, text };
}

module.exports = {
  buildOrganizationUserInviteTemplate,
};
