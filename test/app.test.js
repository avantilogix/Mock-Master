import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { importQuestions, pageCount, renderPage } from '../server/documents.js';

const source = '1. What is 2 + 2?\nA. 3\nB. 4\nAnswer: B';
const questions = [{ prompt: 'What is 2 + 2?', options: ['3', '4'], answer: 1 }];
const has = command => {
  try { execFileSync('which', [command]); return true; } catch { return false; }
};

function fixturePdf() {
  const contents = `BT /F1 14 Tf 40 700 Td 20 TL ${source.split('\n').map(line => `(${line}) Tj T*`).join('\n')} ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${contents.length} >>\nstream\n${contents}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((value, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${value}\nendobj\n`;
    return `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  return Buffer.from(`${pdf}xref\n0 6\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`);
}

test('imports formatted text and rejects questions without a valid answer', async () => {
  assert.deepEqual(await importQuestions(Buffer.from(source), 'txt'), questions);
  await assert.rejects(importQuestions(Buffer.from(source.replace('Answer: B', 'Answer: F')), 'txt'), { status: 422 });
  await assert.rejects(importQuestions(Buffer.from('not a test'), 'txt'), { status: 422 });
});

test('extracts Word paragraphs from a DOCX', { skip: !has('zip') || !has('unzip') }, async t => {
  const path = mkdtempSync(join(tmpdir(), 'mock-master-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  mkdirSync(join(path, 'word'));
  const lines = source.split('\n').map(line => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`);
  writeFileSync(join(path, 'word/document.xml'), `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.join('')}</w:body></w:document>`);
  execFileSync('zip', ['-q', 'test.docx', 'word/document.xml'], { cwd: path });
  assert.deepEqual(await importQuestions(readFileSync(join(path, 'test.docx')), 'docx'), questions);
});

test('extracts PDF questions and bakes a viewer-specific watermark into pages', {
  skip: !has('pdftotext') || !has('pdftoppm'),
}, async () => {
  const pdf = fixturePdf();
  assert.deepEqual(await importQuestions(pdf, 'pdf'), questions);
  const [first, second] = await Promise.all([renderPage(pdf, 1, '+919000000001'), renderPage(pdf, 1, '+919000000002')]);
  assert.equal(first.subarray(1, 4).toString(), 'PNG');
  assert.notDeepEqual(first, second);
});

test('counts and securely renders PDF books without OS tools', async () => {
  const pdf = fixturePdf();
  assert.equal(await pageCount(pdf), 1);
  const [first, second] = await Promise.all([renderPage(pdf, 1, '+919000000001'), renderPage(pdf, 1, '+919000000002')]);
  assert.equal(first.subarray(1, 4).toString(), 'PNG');
  assert.notDeepEqual(first, second);
});

test('admin approval grants only the confirmed student access to their course, test and discussion', async t => {
  const db = openDatabase(':memory:');
  const users = new Map([
    ['buyer', { uid: 'buyer', phone: '+919000000001' }],
    ['other', { uid: 'other', phone: '+919000000002' }],
    ['admin', { uid: 'admin', phone: '+919000000003' }],
  ]);
  const server = createApp({ db, verifyToken: async token => users.get(token), adminUids: ['admin'],
    manualPayment: { upiId: 'mock@upi', payeeName: 'Mock Master' } })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => { db.close(); resolve(); })));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, user, method = 'GET', body, headers = {}) => fetch(base + path, {
    method,
    headers: {
      ...(user ? { Authorization: ['Bearer', user].join(' ') } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: Buffer.isBuffer(body) ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const course = { title: 'Maths', description: 'Practice', price: 14900 };
  assert.equal((await request('/admin/courses', 'buyer', 'POST', course)).status, 403);
  const created = await request('/admin/courses', 'admin', 'POST', course);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const path = `/courses/${id}`;
  assert.deepEqual(await (await request('/courses')).json(), [{ id, ...course }]);
  const createdTest = await request(`/admin${path}/tests`, 'admin', 'POST', { title: 'Practice test', questions });
  assert.equal(createdTest.status, 201);
  const testPath = `/tests/${(await createdTest.json()).id}`;
  const withPdf = true;
  let pagePath;
  if (withPdf) {
    const upload = await request(`/admin${path}/books?title=Guide`, 'admin', 'POST', fixturePdf(),
      { 'Content-Type': 'application/octet-stream' });
    assert.equal(upload.status, 201);
    pagePath = `/books/${(await upload.json()).id}/pages/1`;
    assert.equal((await request(pagePath, 'buyer')).status, 403);
  }
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, 'buyer')).status, 403);
  assert.equal((await request(testPath, 'buyer')).status, 403);
  assert.equal((await request(`${path}/messages`, 'buyer', 'POST', { text: 'Hello' })).status, 403);

  const submitted = await request(`${path}/payment`, 'buyer', 'POST', { reference: 'UPI123456789', note: 'Paid in app' });
  assert.equal(submitted.status, 201);
  const requestId = (await submitted.json()).id;
  assert.equal((await request(`${path}/payment`, 'buyer', 'POST', { reference: 'UPI123456789' })).status, 409);
  assert.equal((await request(path, 'buyer')).status, 403);
  const pending = await (await request('/admin/payments', 'admin')).json();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reference, 'UPI123456789');
  assert.equal((await request(`/admin/payments/${requestId}/reject`, 'admin', 'POST', { note: '' })).status, 422);
  assert.equal((await request(`/admin/payments/${requestId}/reject`, 'admin', 'POST', { note: 'Reference not visible in account' })).status, 204);
  const rejected = await (await request(`${path}/payment`, 'buyer')).json();
  assert.equal(rejected.order.status, 'rejected');
  assert.equal(rejected.order.reviewNote, 'Reference not visible in account');
  assert.equal((await request(`${path}/payment`, 'buyer', 'POST', { reference: 'UPI987654321' })).status, 201);
  assert.equal((await request(`/admin/payments/${requestId}/approve`, 'other', 'POST')).status, 403);
  assert.equal((await request(`/admin/payments/${requestId}/approve`, 'admin', 'POST')).status, 204);
  assert.equal((await request(`/admin/payments/${requestId}/approve`, 'admin', 'POST')).status, 204);
  assert.deepEqual((await (await request('/me', 'buyer')).json()).purchases, [id]);
  assert.equal((await request(path, 'buyer')).status, 200);
  assert.equal((await request(testPath, 'other')).status, 403);
  assert.deepEqual((await (await request(testPath, 'buyer')).json()).questions,
    [{ prompt: questions[0].prompt, options: questions[0].options }]);
  assert.deepEqual(await (await request(`${testPath}/submit`, 'buyer', 'POST', { answers: [1] })).json(), { score: 1, total: 1 });
  const progress = await (await request('/progress', 'buyer')).json();
  assert.deepEqual(progress.summary, { attempts: 1, questions: 1, correct: 1, accuracy: 100 });
  assert.equal(progress.attempts[0].course, id);
  assert.equal((await request('/content/syllabus', 'buyer')).status, 200);
  assert.equal((await request('/admin/content/syllabus', 'buyer', 'POST', {
    title: 'Not allowed', summary: 'Denied', body: 'Denied',
  })).status, 403);
  const schedule = await request('/admin/timetable', 'admin', 'POST', {
    title: 'Evening practice', day: 'Monday', startsAt: '19:00', duration: '60 minutes', description: 'Mock review',
  });
  assert.equal(schedule.status, 201);
  assert.equal((await (await request('/timetable', 'buyer')).json()).length, 1);
  const physicalBook = await request('/admin/physical-books', 'admin', 'POST', {
    title: 'Printed Guide', description: 'Practice workbook', price: 9900, stock: 10,
  });
  assert.equal(physicalBook.status, 201);
  const physicalBookId = (await physicalBook.json()).id;
  const physicalOrder = await request('/physical-orders', 'buyer', 'POST', {
    bookId: physicalBookId, quantity: 1, reference: 'UPI123BOOK',
    address: { fullName: 'A Student', phone: '9000000001', line1: '1 Main Road', city: 'Mumbai', state: 'Maharashtra', pin: '400001' },
  });
  assert.equal(physicalOrder.status, 201);
  assert.equal((await (await request('/physical-orders', 'buyer')).json()).length, 1);
  assert.equal((await request(`/admin/physical-orders/${(await physicalOrder.json()).id}/status`, 'admin', 'POST', {
    status: 'approved', note: 'Payment confirmed',
  })).status, 204);
  assert.equal((await request(`${path}/messages`, 'buyer', 'POST', { text: 'Hello' })).status, 204);
  assert.equal((await request(`${path}/reviews`, 'buyer', 'PUT', { rating: 5, text: 'Helpful' })).status, 204);
  assert.deepEqual(await (await request(`${path}/reviews`)).json(), [{ name: 'Student', rating: 5, text: 'Helpful' }]);
  assert.equal((await request('/me', 'buyer', 'PUT', { name: 'A Student' })).status, 204);
  assert.deepEqual(await (await request(`${path}/reviews`)).json(), [{ name: 'A Student', rating: 5, text: 'Helpful' }]);
  assert.equal((await request('/support', 'buyer', 'POST', { text: 'Question about my course' })).status, 204);
  assert.equal((await request('/admin/support', 'other')).status, 403);
  assert.deepEqual(await (await request('/admin/support', 'admin')).json(),
    [{ phone: users.get('buyer').phone, text: 'Question about my course' }]);
  if (withPdf) {
    assert.equal((await request(pagePath, 'other')).status, 403);
    const page = await request(pagePath, 'buyer');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await page.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  }
});
