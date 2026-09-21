function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildEmailVerificationTemplate({
  brandName = 'Biz Assistant',
  recipientName,
  verifyUrl,
  expiresInMinutes = 60,
}) {
  const safeName = escapeHtml(recipientName || 'there');
  const safeUrl = escapeHtml(verifyUrl);
  const subject = `${brandName} Email Verification`;

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
              <td style="background:linear-gradient(135deg,#06b6d4 0%,#2563eb 100%);padding:24px 28px;color:#fff;">
                <div style="font-size:14px;opacity:.95;">${escapeHtml(brandName)}</div>
                <div style="font-size:22px;font-weight:700;margin-top:6px;">Verify Your Email</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 12px;font-size:15px;">Hi ${safeName},</p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#334155;">
                  Please confirm your email to activate your account and continue using ${escapeHtml(brandName)}.
                  This link will expire in <strong>${escapeHtml(expiresInMinutes)}</strong> minutes.
                </p>

                <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 20px;">
                  <tr>
                    <td align="center" style="border-radius:10px;background:#1d4ed8;">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;color:#fff;text-decoration:none;font-size:15px;font-weight:600;">
                        Verify Email
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 8px;font-size:13px;color:#64748b;">If the button does not work, use this link:</p>
                <p style="margin:0 0 16px;word-break:break-all;font-size:13px;color:#1d4ed8;">${safeUrl}</p>

                <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
                  If you did not request this, you can safely ignore this email.
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
    `${brandName} Email Verification`,
    '',
    `Hi ${recipientName || 'there'},`,
    '',
    `Please verify your email using this link (expires in ${expiresInMinutes} minutes):`,
    verifyUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  return { subject, html, text };
}

module.exports = {
  buildEmailVerificationTemplate,
};
