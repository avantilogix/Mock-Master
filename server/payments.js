import { createHmac, timingSafeEqual } from 'node:crypto';

const API_URL = 'https://api.razorpay.com/v1';
const CURRENCY = 'INR';
const TIMEOUT_MS = 10_000;
const ORDER_ID = /^order_[A-Za-z0-9_]+$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9_]+$/;
const UNCAPTURED_STATUSES = new Set(['created', 'authorized', 'failed', 'refunded']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isId(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function isAmount(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function requireCredentials(...values) {
  if (!values.every(isText)) throw error(503, 'Razorpay is not configured');
}

function matchesSignature(secret, data, signature) {
  if (typeof signature !== 'string' || signature.length !== 64 || !/^[a-f0-9]+$/i.test(signature)) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(data).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

function capturedDetails(entity) {
  if (!isRecord(entity) ||
      !isId(entity.id, PAYMENT_ID) ||
      !isId(entity.order_id, ORDER_ID) ||
      !isAmount(entity.amount) ||
      entity.currency !== CURRENCY ||
      (Object.hasOwn(entity, 'captured') && entity.captured !== true)) {
    return null;
  }
  return { id: entity.id, orderId: entity.order_id, amount: entity.amount, currency: entity.currency };
}

export function razorpay({ key, secret, webhookSecret, fetchImpl = fetch }) {
  async function request(path, method, body) {
    const controller = new AbortController();
    let timer;
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(error(504, 'Razorpay request timed out'));
        }, TIMEOUT_MS);
      });
      const response = (async () => {
        const headers = {
          Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
          Accept: 'application/json',
        };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const result = await fetchImpl(`${API_URL}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          redirect: 'error',
        });
        if (result?.ok !== true) throw error(502, 'Razorpay request failed');
        return result.json();
      })();
      return await Promise.race([response, deadline]);
    } catch {
      if (controller.signal.aborted) throw error(504, 'Razorpay request timed out');
      throw error(502, 'Razorpay request failed');
    } finally {
      clearTimeout(timer);
    }
  }

  async function createOrder(input) {
    requireCredentials(key, secret);
    const { amount, receipt } = input ?? {};
    if (!isAmount(amount) || !isText(receipt) || receipt.length > 40) {
      throw error(400, 'Invalid Razorpay order amount or receipt');
    }
    const order = await request('/orders', 'POST', { amount, currency: CURRENCY, receipt });
    if (!isRecord(order) || !isId(order.id, ORDER_ID) ||
        order.amount !== amount || order.currency !== CURRENCY) {
      throw error(502, 'Invalid Razorpay order response');
    }
    return { id: order.id, amount: order.amount, currency: order.currency, key };
  }

  // The caller must supply the order ID stored on the server, not trust the browser's copy.
  function verifyCheckout(input) {
    requireCredentials(secret);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = input ?? {};
    return isId(razorpay_order_id, ORDER_ID) && isId(razorpay_payment_id, PAYMENT_ID) &&
      matchesSignature(secret, `${razorpay_order_id}|${razorpay_payment_id}`, razorpay_signature);
  }

  async function capturedPayment(paymentId) {
    requireCredentials(key, secret);
    if (!isId(paymentId, PAYMENT_ID)) throw error(400, 'Invalid Razorpay payment ID');
    const entity = await request(`/payments/${paymentId}`, 'GET');
    if (!isRecord(entity) || entity.id !== paymentId) {
      throw error(502, 'Invalid Razorpay payment response');
    }
    if (UNCAPTURED_STATUSES.has(entity.status)) return null;
    const payment = entity.status === 'captured' ? capturedDetails(entity) : null;
    if (!payment) throw error(502, 'Invalid Razorpay payment response');
    return payment;
  }

  function webhookPayment(rawBody, signature) {
    requireCredentials(webhookSecret);
    if (!(typeof rawBody === 'string' || rawBody instanceof Uint8Array) ||
        !matchesSignature(webhookSecret, rawBody, signature)) {
      throw error(400, 'Invalid Razorpay webhook signature');
    }

    let body;
    try {
      body = JSON.parse(typeof rawBody === 'string' ? rawBody : utf8.decode(rawBody));
    } catch {
      throw error(400, 'Invalid Razorpay webhook payload');
    }
    if (!isRecord(body) || !isText(body.event)) throw error(400, 'Invalid Razorpay webhook payload');
    if (body.event !== 'payment.captured') return null;
    const entity = body.payload?.payment?.entity;
    const payment = capturedDetails(entity);
    if (!payment || (Object.hasOwn(entity, 'status') && entity.status !== 'captured')) {
      throw error(400, 'Invalid Razorpay webhook payment');
    }
    return payment;
  }

  return { key, createOrder, verifyCheckout, capturedPayment, webhookPayment };
}
