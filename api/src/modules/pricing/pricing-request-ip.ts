import { isIP } from 'net';

/** Trust only explicitly configured proxy IPs, walking the chain from the socket. */
export function pricingRequestIp(req: any, configured = process.env.PRICING_REQUEST_TRUSTED_PROXY_IPS || ''): string {
  const normalize = (value: string) => value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  const trusted = configured.split(',').map(value => normalize(value.trim())).filter(Boolean);
  if (trusted.some(value => !isIP(value))) throw new Error('PRICING_REQUEST_TRUSTED_PROXY_IPS must contain explicit IP addresses.');
  let address = normalize(String(req.socket?.remoteAddress || 'unknown'));
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',').map(value => normalize(value.trim()));
  if (forwarded.length > 10 || forwarded.some(value => value && !isIP(value))) return address;
  for (const next of forwarded.reverse()) {
    if (!trusted.includes(address) || !next) break;
    address = next;
  }
  return address;
}
