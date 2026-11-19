import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { razorpay } from '../server/payments.js';

const credentials = { key: 'example-key', secret: 'example-secret', webhookSecret: 'example-webhook' };
const order = { id: 'order_123', amount: 12500, currency: 'INR' };
const entity = { id: 'pay_123', order_id: order.id, amount: order.amount, currency: 'INR', status: 'captured' };
const payment = { id: entity.id, orderId: order.id, amount: order.amount, currency: 'INR' };
const sign = (raw, secret) => createHmac('sha256', secret).update(raw).digest('hex');
const withResponse = (data) => razorpay({ ...credentials, fetchImpl: async () => Response.json(data) });

test('creates an INR order in minor units using Basic auth', async () => {
  const { key, createOrder } = razorpay({
    ...credentials,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.razorpay.com/v1/orders');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, `Basic ${Buffer.from(`${credentials.key}:${credentials.secret}`).toString('base64')}`);
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(options.body), { amount: order.amount, currency: 'INR', receipt: 'receipt-1' });
      assert.equal(options.signal.aborted, false);
      return Response.json({ ...order, extra: 'not exposed' });
    },
  });
  assert.equal(key, credentials.key);
  assert.deepEqual(await createOrder({ amount: order.amount, receipt: 'receipt-1' }), { ...order, key });
});

test('rejects invalid order input and unexpected provider order fields', async () => {
  const noFetch = razorpay({ ...credentials, fetchImpl: () => assert.fail('unexpected API call') });
  for (const [amount, receipt] of [[1.5, 'valid'], [0, 'valid'], [1, ' '], [1, 'x'.repeat(41)]]) {
    await assert.rejects(noFetch.createOrder({ amount, receipt }), { status: 400 });
  }
  for (const data of [{ ...order, amount: 1 }, { ...order, currency: 'USD' }, { ...order, id: 'pay_123' }]) {
    await assert.rejects(withResponse(data).createOrder({ amount: order.amount, receipt: 'r' }), { status: 502 });
  }
});

test('verifies checkout signatures against both IDs using the API secret', () => {
  const { verifyCheckout } = razorpay({ secret: credentials.secret });
  const data = {
    razorpay_order_id: order.id,
    razorpay_payment_id: entity.id,
    razorpay_signature: sign(`${order.id}|${entity.id}`, credentials.secret),
  };
  assert.equal(verifyCheckout(data), true);
  assert.equal(verifyCheckout(null), false);
  assert.equal(verifyCheckout({ ...data, razorpay_order_id: 'order_other' }), false);
  assert.equal(verifyCheckout({ ...data, razorpay_payment_id: 'pay_other' }), false);
  for (const signature of [null, 'ab', 'z'.repeat(64), `${data.razorpay_signature} `]) {
    assert.equal(verifyCheckout({ ...data, razorpay_signature: signature }), false);
  }
});

test('looks up capture with the provider and checks the requested ID and returned details', async () => {
  const { capturedPayment } = razorpay({
    ...credentials,
    fetchImpl: async (url, options) => {
      assert.equal(url, `https://api.razorpay.com/v1/payments/${entity.id}`);
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      return Response.json({ ...entity, captured: true, extra: 'not exposed' });
    },
  });
  assert.deepEqual(await capturedPayment(entity.id), payment);
  assert.equal(await withResponse({ ...entity, status: 'authorized', captured: false }).capturedPayment(entity.id), null);
  assert.equal(await withResponse({ ...entity, status: 'refunded', captured: true }).capturedPayment(entity.id), null);
  await assert.rejects(capturedPayment('pay_123/extra'), { status: 400 });
  for (const overrides of [
    { id: 'pay_other' }, { order_id: null }, { amount: '12500' }, { currency: 'USD' },
    { status: 'unexpected' }, { captured: false },
  ]) {
    await assert.rejects(withResponse({ ...entity, ...overrides }).capturedPayment(entity.id), { status: 502 });
  }
});

test('authenticates raw webhook bytes, normalizes captures, and ignores other events', () => {
  const { webhookPayment } = razorpay({ webhookSecret: credentials.webhookSecret });
  const raw = Buffer.from(JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { ...entity, description: 'café' } } },
  }, null, 2));
  const signature = sign(raw, credentials.webhookSecret);
  assert.deepEqual(webhookPayment(raw, signature), payment);
  assert.deepEqual(webhookPayment(raw.toString(), signature), payment);
  assert.throws(() => webhookPayment(`${raw}\n`, signature), { status: 400 });
  assert.throws(() => webhookPayment(raw, sign(raw, credentials.secret)), { status: 400 });
  const ignored = '{"event":"payment.authorized"}';
  assert.equal(webhookPayment(ignored, sign(ignored, credentials.webhookSecret)), null);
  assert.throws(() => webhookPayment(ignored, 'bad'), { status: 400 });
});

test('rejects malformed or contradictory signed webhook data', () => {
  const { webhookPayment } = razorpay(credentials);
  for (const raw of [
    '{invalid', Buffer.from([255]), 'null', '{}', '{"event":"payment.captured"}',
    ...[{ amount: 0 }, { currency: 'USD' }, { status: 'authorized' }, { captured: false }].map(
      (overrides) => JSON.stringify({
        event: 'payment.captured', payload: { payment: { entity: { ...entity, ...overrides } } },
      }),
    ),
  ]) {
    assert.throws(() => webhookPayment(raw, sign(raw, credentials.webhookSecret)), { status: 400 });
  }
});

test('fails closed if the credentials needed for an operation are missing', async () => {
  const fetchImpl = () => assert.fail('unexpected API call');
  for (const config of [{ key: credentials.key }, { secret: credentials.secret }, { ...credentials, secret: ' ' }]) {
    const adapter = razorpay({ ...config, fetchImpl });
    await assert.rejects(adapter.createOrder({ amount: 1, receipt: 'r' }), { status: 503 });
    await assert.rejects(adapter.capturedPayment(entity.id), { status: 503 });
  }
  const adapter = razorpay({ key: credentials.key, fetchImpl });
  assert.throws(() => adapter.verifyCheckout(), { status: 503 });
  assert.throws(() => adapter.webhookPayment('x', 'bad'), { status: 503 });
});

test('sanitizes upstream HTTP, transport and JSON errors', async () => {
  for (const fetchImpl of [
    async () => new Response('private upstream details', { status: 401 }),
    async () => { throw new Error('private upstream details'); },
    async () => new Response('private upstream details'),
  ]) {
    const adapter = razorpay({ ...credentials, fetchImpl });
    await assert.rejects(adapter.capturedPayment(entity.id), (err) => {
      assert.equal(err.status, 502);
      assert.equal(err.message, 'Razorpay request failed');
      assert.equal(err.cause, undefined);
      return true;
    });
  }
});

test('times out while waiting for either headers or the response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hang = () => new Promise(() => {});
  for (const makeResponse of [hang, () => ({ ok: true, json: hang })]) {
    let signal;
    const adapter = razorpay({
      ...credentials,
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return makeResponse();
      },
    });
    const result = assert.rejects(adapter.capturedPayment(entity.id), { status: 504 });
    await Promise.resolve();
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(10_000);
    await result;
    assert.equal(signal.aborted, true);
  }
});
