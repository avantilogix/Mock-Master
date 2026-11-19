const UPI_ID = /^[A-Za-z0-9._-]{2,80}@[A-Za-z0-9.-]{2,40}$/;
const TRANSACTION_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 _/.-]{2,79}$/;

export function paymentReference(value) {
  if (typeof value !== 'string') return '';
  const reference = value.trim().toUpperCase();
  return TRANSACTION_REFERENCE.test(reference) ? reference : '';
}

export function upiDetails({ upiId, payeeName } = {}) {
  if (!UPI_ID.test(upiId || '') || typeof payeeName !== 'string' || !payeeName.trim() || payeeName.length > 100) {
    return { configured: false, upiId: '', payeeName: '' };
  }
  return { configured: true, upiId, payeeName: payeeName.trim() };
}

export function upiPaymentUri(details, amount, note) {
  if (!details.configured || !Number.isSafeInteger(amount) || amount <= 0) return '';
  const query = new URLSearchParams({
    pa: details.upiId,
    pn: details.payeeName,
    am: (amount / 100).toFixed(2),
    cu: 'INR',
    tn: note,
  });
  return `upi://pay?${query}`;
}
