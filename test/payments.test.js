import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentReference, upiDetails, upiPaymentUri } from '../server/manual-payments.js';
import { approvedCourseOrder, isPublicResourceTest } from '../firebase-functions/course-entitlements.js';

test('Firebase course entitlement requires explicit approval', () => {
  assert.equal(approvedCourseOrder({ payment: 'paid', paymentStatus: 'approved' }), true);
  assert.equal(approvedCourseOrder({ payment: 'legacy' }), false);
  for (const order of [null, {}, {payment: ''}, {payment: 'paid', paymentStatus: 'pending'},
    {payment: 'paid', paymentStatus: 'rejected'}, {payment: '', paymentStatus: 'approved'},
    {payment: '   ', paymentStatus: 'approved'}]) {
    assert.equal(approvedCourseOrder(order), false);
  }
});

test('only tests in the public Current Affairs course can bypass course ownership', () => {
  assert.equal(isPublicResourceTest('public-current-affairs', 'resource'), true);
  assert.equal(isPublicResourceTest('paid-course', 'resource'), false);
  assert.equal(isPublicResourceTest('public-current-affairs', null), false);
});

test('normalizes valid UPI transaction references', () => {
  assert.equal(paymentReference('  upi-123456789  '), 'UPI-123456789');
  for (const value of ['', 'ab', 'x'.repeat(81), '<script>', null]) assert.equal(paymentReference(value), '');
});

test('builds payment details and a precise INR UPI link', () => {
  const details = upiDetails({ upiId: 'mockmaster@upi', payeeName: 'Mock Master' });
  assert.deepEqual(details, { configured: true, upiId: 'mockmaster@upi', payeeName: 'Mock Master' });
  const uri = new URL(upiPaymentUri(details, 14900, 'Course payment'));
  assert.equal(uri.protocol, 'upi:');
  assert.equal(uri.searchParams.get('pa'), 'mockmaster@upi');
  assert.equal(uri.searchParams.get('am'), '149.00');
  assert.equal(uri.searchParams.get('cu'), 'INR');
  assert.equal(uri.searchParams.get('tn'), 'Course payment');
});

test('fails closed when manual payment configuration is missing', () => {
  for (const details of [
    upiDetails({}),
    upiDetails({ upiId: 'bad id', payeeName: 'Mock Master' }),
    upiDetails({ upiId: 'mock@upi', payeeName: ' ' }),
  ]) {
    assert.equal(details.configured, false);
    assert.equal(upiPaymentUri(details, 100, 'Payment'), '');
  }
});
