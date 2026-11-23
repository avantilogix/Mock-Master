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
const questions = [{ prompt: 'What is 2 + 2?', options: ['3', '4'], answer: 1, section: 'General' }];
const has = command => {
  try { execFileSync('which', [command]); return true; } catch { return false; }
};

function fixturePdf(mediaBox = '0 0 612 792') {
  const contents = `BT /F1 14 Tf 40 700 Td 20 TL ${source.split('\n').map(line => `(${line}) Tj T*`).join('\n')} ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
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

test('renders A4 and tall PDF pages within the watermark pixel limit', async () => {
  for (const mediaBox of ['0 0 595 842', '0 0 600 3000']) {
    const png = await renderPage(fixturePdf(mediaBox), 1, '+919000000001');
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  }
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

  db.prepare(`INSERT INTO referrals (uid, code, credits) VALUES (?, ?, ?)
    ON CONFLICT (uid) DO UPDATE SET credits=excluded.credits`).run('buyer', 'MSBUYER1', 100);
  const submitted = await request(`${path}/payment`, 'buyer', 'POST', {
    reference: 'UPI123456789', note: 'Paid in app', useCredits: true,
  });
  assert.equal(submitted.status, 201);
  const submittedOrder = await submitted.json();
  assert.equal(submittedOrder.amount, 4900);
  const requestId = submittedOrder.id;
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
    [{ prompt: questions[0].prompt, options: questions[0].options, section: 'General' }]);
  assert.equal((await request(`${testPath}/start`, 'buyer', 'POST')).status, 201);
  const result = await (await request(`${testPath}/submit`, 'buyer', 'POST', { answers: [1] })).json();
  assert.equal(result.score, 1);
  assert.equal(result.total, 1);
  assert.equal(result.correct, 1);
  assert.equal(result.unanswered, 0);
  const progress = await (await request('/progress', 'buyer')).json();
  assert.deepEqual(progress.summary, { attempts: 1, questions: 1, correct: 1, accuracy: 100, best: 100, courses: 1 });
  assert.equal(progress.attempts[0].course, id);
  assert.equal((await request('/content/syllabus', 'buyer')).status, 200);
  assert.equal((await request('/admin/payment-settings', 'buyer')).status, 403);
  assert.equal((await request('/admin/content/syllabus', 'buyer', 'POST', {
    title: 'Not allowed', summary: 'Denied', body: 'Denied',
  })).status, 403);
  assert.equal((await request('/admin/videos', 'buyer', 'POST', {
    title: 'Denied', description: 'Denied', url: 'https://youtu.be/dQw4w9WgXcQ',
  })).status, 403);
  assert.equal((await request('/admin/videos', 'admin', 'POST', {
    title: 'Lesson', description: 'Practice lesson', url: 'https://youtu.be/dQw4w9WgXcQ', course: id,
  })).status, 201);
  assert.equal((await (await request('/videos')).json())[0].videoId, 'dQw4w9WgXcQ');
  assert.deepEqual(Object.keys(progress.summary).sort(),
    ['accuracy', 'attempts', 'best', 'correct', 'courses', 'questions'].sort());
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
  assert.equal((await request('/me', 'buyer', 'PUT', { name: 'A Student' })).status, 200);
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

test('chapter videos upload for admins and stream only through signed links for buyers', async t => {
  const db = openDatabase(':memory:');
  const videoDir = mkdtempSync(join(tmpdir(), 'mock-master-video-test-'));
  const users = new Map([
    ['buyer', { uid: 'buyer', phone: '+919000000001' }],
    ['other', { uid: 'other', phone: '+919000000002' }],
    ['admin', { uid: 'admin', phone: '+919000000003' }],
  ]);
  const server = createApp({ db, verifyToken: async token => users.get(token), adminUids: ['admin'], videoDir })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => { db.close(); rmSync(videoDir, { recursive: true, force: true }); resolve(); })));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, user, method = 'GET', body, type) => fetch(`${origin}/api${path}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(type ? { 'Content-Type': type } : {}) },
    body,
  });
  const created = await request('/admin/courses', 'admin', 'POST',
    JSON.stringify({ title: 'Maths', description: 'Practice', price: 14900 }), 'application/json');
  const { id } = await created.json();
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64, 1)]);
  const uploadPath = `/admin/courses/${id}/videos?title=Algebra%20Lesson&subject=Maths&chapter=Chapter%204`;

  assert.equal((await request(uploadPath, 'buyer', 'POST', mp4, 'video/mp4')).status, 403);
  assert.equal((await request(uploadPath, 'admin', 'POST', mp4, 'application/pdf')).status, 415);
  assert.equal((await request(uploadPath, 'admin', 'POST', Buffer.from('not a video at all'), 'video/mp4')).status, 422);
  const upload = await request(uploadPath, 'admin', 'POST', mp4, 'video/mp4');
  assert.equal(upload.status, 201);
  const { id: videoId } = await upload.json();

  const material = await (await request(`/courses/${id}`, 'admin')).json();
  assert.deepEqual(material.videos, [{ id: videoId, title: 'Algebra Lesson', subject: 'Maths', chapter: 'Chapter 4',
    type: 'video/mp4', size: mp4.length }]);
  assert.equal((await request(`/videos/${videoId}/link`, 'buyer')).status, 403);

  for (const uid of ['buyer', 'other']) db.prepare('INSERT OR IGNORE INTO students (uid, phone) VALUES (?, ?)').run(uid, users.get(uid).phone);
  db.prepare('INSERT INTO orders (id, uid, course, amount, payment) VALUES (?, ?, ?, ?, ?)').run('order-1', 'buyer', id, 14900, 'pay-1');
  const linked = await request(`/videos/${videoId}/link`, 'buyer');
  assert.equal(linked.status, 200);
  const { url } = await linked.json();
  const file = await fetch(origin + url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), mp4);
  const download = await fetch(`${origin}${url}&download=1`);
  assert.match(download.headers.get('content-disposition'), /attachment; filename="Algebra Lesson\.mp4"/);
  assert.equal((await fetch(origin + url, { headers: { Range: 'bytes=0-3' } })).status, 206);

  assert.equal((await fetch(origin + url.replace(/signature=[^&]+/, 'signature=forged'))).status, 403);
  assert.equal((await fetch(origin + url.replace('uid=buyer', 'uid=other'))).status, 403);
  const expired = new URL(origin + url);
  expired.searchParams.set('expires', '1');
  assert.equal((await fetch(expired)).status, 403);
});
function jsonServer(t, users) {
  const db = openDatabase(':memory:');
  const server = createApp({ db, verifyToken: async token => users.get(token), adminUids: ['admin'] }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(() => { db.close(); resolve(); })));
  const request = async (path, user, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${user}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body && JSON.stringify(body),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  return { db, server, request };
}

test('students manage a personal timetable that other students cannot see or change', async t => {
  const users = new Map([['asha', { uid: 'asha', phone: '+919000000011' }], ['ravi', { uid: 'ravi', phone: '+919000000012' }]]);
  const { server, request } = jsonServer(t, users);
  await once(server, 'listening');
  const session = { day: 'Tuesday', title: 'Polity Revision', startsAt: '07:30', duration: 60, description: 'Chapter 4' };

  assert.equal((await request('/timetable/mine', 'asha', 'POST', { ...session, startsAt: '25:00' })).status, 422);
  assert.equal((await request('/timetable/mine', 'asha', 'POST', { ...session, day: 'Someday' })).status, 422);
  assert.equal((await request('/timetable/mine', 'asha', 'POST', { ...session, duration: 2 })).status, 422);
  const { status, body: { id } } = await request('/timetable/mine', 'asha', 'POST', session);
  assert.equal(status, 201);
  await request('/timetable/mine', 'asha', 'POST', { ...session, day: 'Monday', title: 'Maths' });

  const mine = (await request('/timetable/mine', 'asha')).body;
  assert.deepEqual(mine.map(item => item.title), ['Maths', 'Polity Revision']);
  assert.deepEqual((await request('/timetable/mine', 'ravi')).body, []);
  assert.equal((await request(`/timetable/mine/${id}`, 'ravi', 'PUT', session)).status, 404);
  assert.equal((await request(`/timetable/mine/${id}`, 'ravi', 'DELETE')).status, 404);

  assert.equal((await request(`/timetable/mine/${id}`, 'asha', 'PUT', { ...session, title: 'Polity Mock Test' })).status, 204);
  assert.equal((await request(`/timetable/mine/${id}`, 'asha', 'DELETE')).status, 204);
  assert.deepEqual((await request('/timetable/mine', 'asha')).body.map(item => item.title), ['Maths']);
});

test('admins list published content with dates, edit it, and delete it safely', async t => {
  const users = new Map([['admin', { uid: 'admin', phone: '+919000000021' }], ['student', { uid: 'student', phone: '+919000000022' }]]);
  const { db, server, request } = jsonServer(t, users);
  await once(server, 'listening');
  const course = { title: 'Reasoning', description: 'Daily practice', price: 50000 };
  const { body: { id } } = await request('/admin/courses', 'admin', 'POST', course);
  const questions = [{ prompt: '2 + 2?', options: ['3', '4'], answer: 1, section: 'General' }];
  const { body: { id: testId } } = await request(`/admin/courses/${id}/tests`, 'admin', 'POST', { title: 'Mock 1', questions });

  assert.equal((await request('/admin/published', 'student')).status, 403);
  const listed = (await request('/admin/published', 'admin')).body;
  assert.equal(listed.courses[0].title, 'Reasoning');
  assert.ok(!Number.isNaN(Date.parse(listed.courses[0].createdAt)));
  assert.equal(listed.tests[0].courseTitle, 'Reasoning');
  assert.deepEqual(listed.tests[0].questions, questions);

  assert.equal((await request(`/admin/published/courses/${id}`, 'admin', 'PUT', { ...course, price: 50 })).status, 422);
  assert.equal((await request(`/admin/published/courses/${id}`, 'student', 'PUT', course)).status, 403);
  assert.equal((await request(`/admin/published/courses/${id}`, 'admin', 'PUT', { ...course, title: 'Reasoning Pro' })).status, 204);
  assert.equal((await request(`/admin/published/tests/${testId}`, 'admin', 'PUT', { title: 'Mock 1', questions: [] })).status, 422);
  assert.equal((await request('/admin/published/unknown/x', 'admin', 'DELETE')).status, 404);

  db.prepare('INSERT INTO orders (id, uid, course, amount) VALUES (?, ?, ?, ?)').run('order-1', 'admin', id, 50000);
  assert.equal((await request(`/admin/published/courses/${id}`, 'admin', 'DELETE')).status, 409);
  db.prepare('DELETE FROM orders').run();
  assert.equal((await request(`/admin/published/courses/${id}`, 'admin', 'DELETE')).status, 200);
  const after = (await request('/admin/published', 'admin')).body;
  assert.deepEqual([after.courses.length, after.tests.length], [0, 0]);
});

test('standalone e-books unlock after admin payment approval and download as protected PDFs', async t => {
  const db = openDatabase(':memory:');
  const users = new Map([
    ['buyer', { uid: 'buyer', phone: '+919000000031' }],
    ['admin', { uid: 'admin', phone: '+919000000032' }],
  ]);
  const server = createApp({ db, verifyToken: async token => users.get(token), adminUids: ['admin'],
    manualPayment: { upiId: 'mock@upi', payeeName: 'Mission Selection' } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => { db.close(); resolve(); })));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, user, method = 'GET', body, headers = {}) => fetch(base + path, {
    method,
    headers: {
      ...(user ? { Authorization: ['Bearer', user].join(' ') } : {}),
      ...(Buffer.isBuffer(body) ? { 'Content-Type': 'application/octet-stream' } :
        body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: Buffer.isBuffer(body) ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const query = new URLSearchParams({ title: 'Complete Guide', description: 'Protected revision book', price: '9900' });
  const upload = await request(`/admin/ebooks?${query}`, 'admin', 'POST', fixturePdf());
  assert.equal(upload.status, 201);
  const { id } = await upload.json();
  assert.equal((await (await request('/ebooks')).json())[0].id, id);
  assert.equal((await request(`/ebooks/${id}/pages/1`, 'buyer')).status, 403);
  const payment = await request(`/ebooks/${id}/payment`, 'buyer', 'POST', { reference: 'UPI123456789' });
  assert.equal(payment.status, 201);
  const { id: orderId } = await payment.json();
  const payments = await (await request('/admin/payments', 'admin')).json();
  assert.equal(payments.find(item => item.id === orderId).type, 'ebook');
  assert.equal((await request(`/admin/payments/${orderId}/approve`, 'admin', 'POST', {})).status, 204);
  assert.equal((await request(`/ebooks/${id}/pages/1`, 'buyer')).headers.get('content-type'), 'image/png');
  const download = await request(`/ebooks/${id}/download`, 'buyer');
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /protected\.pdf/);
  assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
});