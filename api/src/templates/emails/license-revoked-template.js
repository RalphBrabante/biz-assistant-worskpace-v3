function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildLicenseRevokedTemplate({
  brandName = 'Biz Assistant',
  recipientName,
  organizationName,
  licenseKey,
  licensesUrl,
}) {
  const safeName = escapeHtml(recipientName || 'there');
  const safeOrganization = escapeHtml(organizationName || 'your organization');
  const safeLicenseKey = escapeHtml(licenseKey || 'N/A');
  const safeLicensesUrl = escapeHtml(licensesUrl || '');
  const subject = `${brandName} License Revoked: ${organizationName || 'Organization'}`;

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
              <td style="background:linear-gradient(135deg,#b91c1c 0%,#dc2626 100%);padding:24px 28px;color:#fff;">
                <div style="font-size:14px;opacity:.95;">${escapeHtml(brandName)}</div>
                <div style="font-size:24px;font-weight:700;margin-top:6px;">&#9888; License Revoked</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 12px;font-size:15px;">Hi ${safeName},</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">
                  The active license for <strong>${safeOrganization}</strong> has been revoked.
                  Access to protected areas may now be restricted for users in this organization.
                </p>

                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 18px;border:1px solid #fecaca;background:#fff1f2;border-radius:12px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#7f1d1d;">
                      <div style="margin-bottom:6px;"><strong>&#127970; Organization:</strong> ${safeOrganization}</div>
                      <div><strong>&#128273; License Key:</strong> <span style="word-break:break-all;">${safeLicenseKey}</span></div>
                    </td>
                  </tr>
                </table>

                <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 18px;">
                  <tr>
                    <td align="center" style="border-radius:10px;background:#dc2626;">
                      <a href="${safeLicensesUrl}" style="display:inline-block;padding:12px 22px;color:#fff;text-decoration:none;font-size:15px;font-weight:600;">
                        &#128065; Review License Details
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 8px;font-size:13px;color:#64748b;">If the button does not work, use this link:</p>
                <p style="margin:0 0 14px;word-break:break-all;font-size:13px;color:#1d4ed8;">${safeLicensesUrl}</p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
                  If you believe this is an error, contact your system administrator.
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
    `${brandName} License Revoked`,
    '',
    `Hi ${recipientName || 'there'},`,
    '',
    `The active license for ${organizationName || 'your organization'} has been revoked.`,
    `License key: ${licenseKey || 'N/A'}`,
    '',
    `Review license details: ${licensesUrl || ''}`,
    '',
    'If you believe this is an error, contact your system administrator.',
  ].join('\n');

  return { subject, html, text };
}

module.exports = {
  buildLicenseRevokedTemplate,
};
