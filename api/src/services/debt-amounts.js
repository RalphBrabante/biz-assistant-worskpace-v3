const fail = (status, message) => Object.assign(new Error(message), {status});
// Work in integer minor units; never subtract binary floating-point currency values.
function cents(value, label = 'amount') {
  const text = String(value ?? '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) throw fail(400, `Enter a valid ${label} with at most two decimal places.`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function money(value) { return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`; }
function positive(value, label) {
  const amount = cents(value, label);
  if (amount <= 0n) throw fail(400, `${label} must be greater than zero.`);
  return money(amount);
}
function debtView(model) {
  const row = model.toJSON ? model.toJSON() : {...model};
  const remaining = cents(row.originalAmount) - cents(row.paidAmount);
  return {...row, remainingAmount: money(remaining), status: remaining === 0n ? 'paid' : 'outstanding'};
}
module.exports = {fail, cents, money, positive, debtView};
