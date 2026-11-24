import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';
import { importQuestions, pageCount, renderDemoPage, renderPage } from '../server/documents.js';

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
  assert.deepEqual(await (await request('/courses')).json(), [{ id, ...course, downloadsEnabled: 0 }]);
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
  const resultPdf = await request(`/attempts/${result.attemptId}/result.pdf`, 'buyer');
  assert.equal(resultPdf.headers.get('content-type'), 'application/pdf');
  assert.equal((await request(`/attempts/${result.attemptId}/result.pdf`, 'other')).status, 404);
  const receiptPdf = await request(`${path}/receipt.pdf`, 'buyer');
  assert.equal(receiptPdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await receiptPdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  assert.equal((await request('/receipts', 'buyer')).status, 200);
  assert.equal((await request(`/admin/payments/${requestId}/receipt.pdf`, 'admin')).status, 200);
  assert.equal((await request(`/admin/payments/${requestId}/receipt.pdf`, 'buyer')).status, 403);
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
    const downloadPath = `${pagePath}/download`;
    assert.equal((await request(downloadPath, 'buyer')).status, 403);
    assert.equal((await request(`/admin/published/courses/${id}`, 'admin', 'PUT',
      {...course, downloadsEnabled: true})).status, 204);
    assert.equal((await request(downloadPath, 'buyer')).headers.get('content-type'), 'image/png');
  }
  assert.equal((await request(`/admin/payments/${requestId}/reject`, 'admin', 'POST',
    {note: 'Payment reversed'})).status, 204);
  assert.equal((await request(path, 'buyer')).status, 403);
  assert.equal((await request(testPath, 'buyer')).status, 403);
  assert.ok(!(await (await request('/me', 'buyer')).json()).purchases.includes(id));
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
  assert.equal((await request(`/admin/published/courses/${id}`, 'admin', 'PUT',
    JSON.stringify({title: 'Video Course', description: 'Secure videos', price: 14900, downloadsEnabled: true}),
    'application/json')).status, 204);
  const downloadLink = await request(`/videos/${videoId}/link?download=1`, 'buyer');
  const downloadUrl = (await downloadLink.json()).url;
  const download = await fetch(`${origin}${downloadUrl}`);
  assert.match(download.headers.get('content-disposition'), /attachment; filename="Algebra Lesson\.mp4"/);
  assert.equal((await fetch(origin + url, { headers: { Range: 'bytes=0-3' } })).status, 206);

  assert.equal((await fetch(origin + url.replace(/signature=[^&]+/, 'signature=forged'))).status, 403);
  assert.equal((await fetch(origin + url.replace('uid=buyer', 'uid=other'))).status, 403);
  const expired = new URL(origin + url);
  expired.searchParams.set('expires', '1');
  assert.equal((await fetch(expired)).status, 403);
});
test('Current Affairs publishes completed media, protects viewing and enforces download switches', async t => {
  const db = openDatabase(':memory:');
  const dataDir = mkdtempSync(join(tmpdir(), 'mock-affairs-'));
  const videoDir = join(dataDir, '.private');
  const users = new Map([
    ['admin', {uid: 'admin', phone: '+919000000091'}],
    ['admin2', {uid: 'admin2', phone: '+919000000092'}],
    ['student', {uid: 'student', phone: '+919000000093'}],
  ]);
  const server = createApp({db, videoDir, verifyToken: async token => users.get(token), adminUids: ['admin', 'admin2']})
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => {
    db.close(); rmSync(dataDir, {recursive: true, force: true}); resolve();
  })));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, user = 'admin', method = 'GET', body) => fetch(`${origin}/api${path}`, {
    method, headers: {...(user ? {Authorization: `Bearer ${user}`} : {}),
      ...(body === undefined ? {} : {'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json'})},
    body: Buffer.isBuffer(body) ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const pdf = fixturePdf();
  const video = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
  const files = {pdf: {size: pdf.length, type: 'application/pdf'}, video: {size: video.length, type: 'video/mp4'}};
  const draftPath = '/admin/current-affairs/uploads';
  const publishPath = '/admin/content/current-affairs';
  assert.equal((await request(draftPath, 'student', 'POST', files)).status, 403);
  for (const invalid of [{}, {pdf: {size: 13 * 1024 * 1024, type: 'application/pdf'}},
    {video: {size: 301 * 1024 * 1024, type: 'video/mp4'}}, {video: {size: 100, type: 'text/html'}}]) {
    assert.equal((await request(draftPath, 'admin', 'POST', invalid)).status, 422);
  }
  const draft = await request(draftPath, 'admin', 'POST', files);
  assert.equal(draft.status, 201);
  const {id} = await draft.json();
  const input = {uploadId: id, title: 'Daily Affairs', publishedAt: '2026-02-28', downloadsEnabled: false};
  assert.equal((await request(publishPath, 'admin2', 'POST', input)).status, 404);
  assert.equal((await request(publishPath, 'admin', 'POST', {...input, publishedAt: '2026-02-30'})).status, 422);
  assert.equal((await request(publishPath, 'admin', 'POST', input)).status, 409);
  assert.deepEqual(await (await request('/content/current-affairs', 'student')).json(), []);
  assert.equal((await request(`${draftPath}/${id}/pdf`, 'admin2', 'PUT', pdf)).status, 404);
  assert.equal((await request(`${draftPath}/${id}/pdf`, 'admin', 'PUT', pdf)).status, 204);
  assert.equal((await request(publishPath, 'admin', 'POST', input)).status, 409);
  assert.equal((await request(`${draftPath}/${id}/video`, 'admin', 'PUT', video)).status, 204);
  assert.equal((await request(publishPath, 'admin', 'POST', input)).status, 201);
  assert.equal((await request(publishPath, 'admin', 'POST', input)).status, 404);
  assert.equal((await request(`/resources/${id}`, null)).status, 401);
  assert.equal((await request(`/resources/${id}/pdf/pages/1`, null)).status, 401);
  const list = await (await request('/content/current-affairs', 'student')).json();
  assert.equal(list[0].publishedAt, '2026-02-28');
  assert.equal(list[0].media.pdf.pages, 1);
  assert.equal(list[0].media.video.size, video.length);
  assert.equal(list[0].downloadsEnabled, false);
  const page = await request(`/resources/${id}/pdf/pages/1`, 'student');
  assert.equal(page.status, 200);
  assert.equal(Buffer.from(await page.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  assert.equal((await request(`/resources/${id}/pdf/pages/2`, 'student')).status, 404);
  assert.equal((await request(`/resources/${id}/pdf/download`, 'student')).status, 403);
  assert.equal((await request(`/resources/${id}/video/link?download=1`, 'student')).status, 403);
  const {url} = await (await request(`/resources/${id}/video/link`, 'student')).json();
  assert.equal((await fetch(origin + url, {headers: {Range: 'bytes=0-3'}})).status, 206);
  assert.equal((await fetch(origin + url.replace('download=0', 'download=1'))).status, 403);
  const editPath = `/admin/published/resources/${id}`;
  const edit = {title: 'Updated Affairs', publishedAt: '2026-03-01', downloadsEnabled: true};
  assert.equal((await request(editPath, 'admin', 'PUT', edit)).status, 204);
  const download = await request(`/resources/${id}/pdf/download`, 'student');
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const {url: downloadUrl} = await (await request(`/resources/${id}/video/link?download=1`, 'student')).json();
  assert.match((await fetch(origin + downloadUrl)).headers.get('content-disposition'), /attachment/);
  assert.equal((await request(editPath, 'admin', 'PUT', {...edit, downloadsEnabled: false})).status, 204);
  assert.equal((await fetch(origin + downloadUrl)).status, 403);
  const managed = await (await request('/admin/published')).json();
  assert.equal(managed.resources[0].media.pdf.pages, 1);
  assert.equal(managed.resources[0].title, 'Updated Affairs');
  assert.equal((await request(editPath, 'admin', 'DELETE')).status, 200);
  assert.equal((await request(`/resources/${id}`, 'student')).status, 404);

  const badDraft = await (await request(draftPath, 'admin', 'POST', {video: files.video})).json();
  assert.equal((await request(`${draftPath}/${badDraft.id}/video`, 'admin', 'PUT', Buffer.alloc(video.length))).status, 204);
  assert.equal((await request(publishPath, 'admin', 'POST', {...input, uploadId: badDraft.id})).status, 422);
  db.prepare('UPDATE resource_uploads SET expires=0 WHERE id=?').run(badDraft.id);
  assert.equal((await request(publishPath, 'admin', 'POST', {...input, uploadId: badDraft.id})).status, 410);

  const text = {title: 'Syllabus', summary: 'Existing summary', body: 'Existing content', publishedAt: '2026-01-02'};
  for (const kind of ['syllabus', 'current-affairs']) {
    const created = await request(`/admin/content/${kind}`, 'admin', 'POST', text);
    assert.equal(created.status, 201);
    const {id: legacyId} = await created.json();
    const patch = kind === 'current-affairs' ? {...edit, downloadsEnabled: false} : {...text, title: 'Updated Syllabus'};
    assert.equal((await request(`/admin/published/resources/${legacyId}`, 'admin', 'PUT', patch)).status, 204);
    const rows = await (await request(`/content/${kind}`, 'student')).json();
    assert.equal(rows[0].summary, text.summary);
    assert.equal(rows[0].body, text.body);
    if (kind === 'syllabus') assert.equal((await request(`/admin/published/resources/${legacyId}`, 'admin', 'PUT', edit)).status, 422);
  }
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
  assert.equal((await request(`/admin/payments/${orderId}/reject`, 'admin', 'POST',
    {note: 'Transaction could not be verified'})).status, 204);
  assert.equal((await request(`/ebooks/${id}/pages/1`, 'buyer')).status, 403);
  const rejected = (await (await request('/ebook-orders', 'buyer')).json())[0];
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reviewNote, 'Transaction could not be verified');
});

test('e-book demos are separate public page images managed only by admins', async t => {
  const db = openDatabase(':memory:');
  const users = new Map([
    ['buyer', { uid: 'buyer', phone: '+919000000041' }],
    ['admin', { uid: 'admin', phone: '+919000000042' }],
  ]);
  const server = createApp({ db, verifyToken: async token => users.get(token), adminUids: ['admin'] })
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => { db.close(); resolve(); })));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, user, method = 'GET', body) => fetch(base + path, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${user}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/octet-stream' }),
    },
    body,
  });
  const fullPdf = fixturePdf();
  const demoDocument = await PDFDocument.create();
  demoDocument.addPage().drawText('Public demo sample - page one');
  demoDocument.addPage().drawText('Public demo sample - page two');
  const demoPdf = Buffer.from(await demoDocument.save());
  const query = new URLSearchParams({ title: 'Preview Guide', description: 'Full paid book', price: '9900' });
  const { id } = await (await request(`/admin/ebooks?${query}`, 'admin', 'POST', fullPdf)).json();
  const path = `/ebooks/${id}/demo`;
  const adminPath = `/admin/ebooks/${id}/demo`;
  assert.equal((await request(path)).status, 404);
  assert.equal((await (await request('/ebooks')).json())[0].demoPages, 0);
  assert.equal((await request(adminPath, undefined, 'PUT', demoPdf)).status, 401);
  assert.equal((await request(adminPath, 'buyer', 'PUT', demoPdf)).status, 403);
  assert.equal((await request('/admin/ebooks/missing/demo', 'admin', 'PUT', demoPdf)).status, 404);
  const upload = await request(adminPath, 'admin', 'PUT', demoPdf);
  assert.equal(upload.status, 200);
  assert.deepEqual(await upload.json(), { pages: 2 });
  assert.deepEqual(await (await request(path)).json(), { id, title: 'Preview Guide', pages: 2 });
  const listed = (await (await request('/ebooks')).json())[0];
  assert.equal(listed.demoPages, 2);
  assert.equal(listed.pages, 1);
  assert.equal('pdf' in listed || 'demo_pdf' in listed, false);
  const page = await request(`${path}/pages/1`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'image/png');
  const png = Buffer.from(await page.arrayBuffer());
  assert.deepEqual(png, await renderDemoPage(demoPdf, 1));
  assert.notDeepEqual(png, await renderDemoPage(fullPdf, 1));
  assert.equal((await request(`${path}/pages/2`)).status, 200);
  for (const invalid of ['0', '3', '1.5', 'not-a-page']) {
    assert.equal((await request(`${path}/pages/${invalid}`)).status, 404);
  }
  assert.equal((await request(`/ebooks/${id}/pages/1`)).status, 401);
  assert.equal((await request(`/ebooks/${id}/pages/1`, 'buyer')).status, 403);
  assert.equal((await request(`/ebooks/${id}/download`, 'buyer')).status, 403);
  await assert.rejects(renderPage(fullPdf, 1, ''), { status: 403 });
  assert.equal((await request(adminPath, 'admin', 'PUT', Buffer.from('not a PDF'))).status, 422);
  assert.equal((await (await request(path)).json()).pages, 2);
  assert.equal((await request(adminPath, 'admin', 'PUT', fullPdf)).status, 200);
  assert.equal((await (await request(path)).json()).pages, 1);
  assert.equal((await request(`${path}/pages/2`)).status, 404);
  assert.equal((await request(adminPath, 'buyer', 'DELETE')).status, 403);
  assert.equal((await request(adminPath, 'admin', 'DELETE')).status, 204);
  assert.equal((await request(path)).status, 404);
  assert.equal((await request(`${path}/pages/1`)).status, 404);
  assert.equal((await (await request('/ebooks')).json())[0].demoPages, 0);
  assert.deepEqual(Buffer.from(db.prepare('SELECT pdf FROM ebooks WHERE id=?').get(id).pdf), fullPdf);
});

test('live test schedule is stored and returned in a stable IST-derived instant', async t => {
  const users = new Map([['admin', { uid: 'admin', phone: '+919000000041' }]]);
  const { server, request, db } = jsonServer(t, users);
  await once(server, 'listening');
  const { body: { id } } = await request('/admin/courses', 'admin', 'POST', {
    title: 'IST Mission', description: 'Timing check', price: 10000,
  });
  const response = await request(`/admin/courses/${id}/tests`, 'admin', 'POST', {
    title: 'IST Live Test',
    questions: [{prompt: 'One?', options: ['A', 'B'], answer: 0, section: 'General'}],
    live: true,
    startsAt: '2026-11-24T09:00',
    expiresAt: '2026-11-25T21:00',
    durationMinutes: 60,
    attemptsLimit: 2,
    marksPerQuestion: 1,
    negativeMark: 0.25,
  });
  assert.equal(response.status, 201);
  const row = db.prepare('SELECT starts_at, expires_at FROM tests WHERE id=?').get(response.body.id);
  assert.equal(row.starts_at, '2026-11-24T03:30:00.000Z');
  assert.equal(row.expires_at, '2026-11-25T15:30:00.000Z');
});

test('practice tests allow repeated attempts without a live attempt limit', async t => {
  const users = new Map([
    ['buyer', { uid: 'buyer', phone: '+919000000051' }],
    ['admin', { uid: 'admin', phone: '+919000000052' }],
  ]);
  const { server, request, db } = jsonServer(t, users);
  await once(server, 'listening');
  const { body: { id: courseId } } = await request('/admin/courses', 'admin', 'POST',
    {title: 'Unlimited Practice', description: 'Practice', price: 10000});
  const { body: { id: testId } } = await request(`/admin/courses/${courseId}/tests`, 'admin', 'POST',
    {title: 'Practice', questions: [{prompt: 'A?', options: ['Yes', 'No'], answer: 0, section: 'General'}],
      live: false, durationMinutes: 30, attemptsLimit: 0, marksPerQuestion: 1, negativeMark: 0});
  db.prepare('INSERT OR IGNORE INTO students (uid, phone) VALUES (?, ?)').run('buyer', users.get('buyer').phone);
  db.prepare('INSERT INTO orders (id, uid, course, amount, payment, payment_status) VALUES (?, ?, ?, ?, ?, ?)')
    .run('order-unlimited', 'buyer', courseId, 10000, 'manual:order-unlimited', 'approved');
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await request(`/tests/${testId}/start`, 'buyer', 'POST')).status, 201);
    assert.equal((await request(`/tests/${testId}/submit`, 'buyer', 'POST', {answers: [0]})).status, 200);
  }
  const test = (await request(`/tests/${testId}`, 'buyer')).body;
  assert.equal(test.attemptsLimit, 0);
  assert.equal(test.limited, false);
});

test('configured phone numbers retain admin access across Firebase UID changes', async t => {
  const db = openDatabase(':memory:');
  const users = new Map([['phone-admin', {uid: 'new-firebase-uid', phone: '+919131463747'}]]);
  const server = createApp({db, verifyToken: async token => users.get(token),
    adminPhones: ['+919131463747']}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => { db.close(); resolve(); })));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/me`, {
    headers: {Authorization: ['Bearer', 'phone-admin'].join(' ')},
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).admin, true);
});

test('profile stores and returns multiple validated target exams', async t => {
  const users = new Map([['student', {uid: 'student', phone: '+919000000081'}]]);
  const {server, request} = jsonServer(t, users);
  await once(server, 'listening');
  const selected = ['CCE', 'TET 1', 'PSI - Constable'];
  const saved = await request('/me', 'student', 'PUT', {name: 'Asha', examPreferences: selected});
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.examPreferences, selected);
  assert.deepEqual((await request('/me', 'student')).body.examPreferences, selected);
  assert.equal((await request('/me', 'student', 'PUT', {examPreferences: ['Invalid Exam']})).status, 422);
});

test('live leaderboard is private, rank ordered, and locked until expiry', async t => {
  const db = openDatabase(':memory:');
  const users = new Map([
    ['one', {uid: 'one', phone: '+919000000061'}],
    ['two', {uid: 'two', phone: '+919000000062'}],
  ]);
  const server = createApp({db, verifyToken: async token => users.get(token)}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => {db.close(); resolve();})));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  db.prepare('INSERT INTO students (uid,phone,name) VALUES (?,?,?)').run('one', users.get('one').phone, 'Aarav');
  db.prepare('INSERT INTO students (uid,phone,name) VALUES (?,?,?)').run('two', users.get('two').phone, 'Bhavin');
  db.prepare('INSERT INTO courses (id,title,description,price) VALUES (?,?,?,?)').run('c', 'Live', 'Live', 100);
  db.prepare(`INSERT INTO tests (id,course,title,questions,live,starts_at,expires_at,duration_minutes)
    VALUES (?,?,?,?,?,?,?,?)`).run('t', 'c', 'Final Live', JSON.stringify([{prompt:'A?', options:['A','B'], answer:0}]),
  1, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 60);
  db.prepare('INSERT INTO orders (id,uid,course,amount,payment) VALUES (?,?,?,?,?)').run('o1', 'one', 'c', 100, 'paid-one');
  db.prepare('INSERT INTO orders (id,uid,course,amount,payment) VALUES (?,?,?,?,?)').run('o2', 'two', 'c', 100, 'paid-two');
  for (const [id, uid, score, elapsed] of [
    ['a1', 'one', 4, 60], ['a2', 'two', 2, 40],
  ]) db.prepare(`INSERT INTO attempts (id,uid,course,test,title,score,total,created_at,max_marks,elapsed_seconds)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, uid, 'c', 't', 'Final Live', score, 1, '2026-01-02T00:00:00.000Z', 4, elapsed);
  let response = await fetch(`${base}/tests/t/leaderboard`, {headers:{Authorization:'Bearer one'}});
  assert.equal(response.status, 423);
  db.prepare('UPDATE tests SET expires_at=? WHERE id=?').run('2026-01-03T00:00:00.000Z', 't');
  response = await fetch(`${base}/tests/t/leaderboard`, {headers:{Authorization:'Bearer one'}});
  assert.equal(response.status, 200);
  const board = await response.json();
  assert.equal(board.rows[0].rank, 1);
  assert.equal(board.rows[0].isCurrentUser, true);
  assert.equal(board.rows[1].name, 'B.');
  assert.equal(JSON.stringify(board).includes('+919000000062'), false);
});

test('mock and live question paper switches require a completed attempt and preserve access controls', async t => {
  const db = openDatabase(':memory:');
  const users = new Map([['student', {uid: 'student', phone: '+919000000071'}],
    ['admin', {uid: 'admin', phone: '+919000000072'}],
    ['other', {uid: 'other', phone: '+919000000073'}]]);
  const server = createApp({db, verifyToken: async token => users.get(token), adminUids: ['admin']})
    .listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => {db.close(); resolve();})));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, user, method = 'GET', body) => fetch(base + path, {
    method,
    headers: {Authorization: ['Bearer', user].join(' '), ...(body === undefined ? {} : {'Content-Type':'application/json'})},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  db.prepare('INSERT OR IGNORE INTO students (uid,phone) VALUES (?,?)').run('student', users.get('student').phone);
  const createdCourse = await request('/admin/courses', 'admin', 'POST',
    {title: 'Live Download', description: 'Test', price: 10000});
  const {id: courseId} = await createdCourse.json();
  db.prepare('INSERT INTO orders (id,uid,course,amount,payment) VALUES (?,?,?,?,?)')
    .run('download-order', 'student', courseId, 10000, 'paid');
  const question = [{prompt: 'Capital of India?', options: ['Delhi', 'Mumbai'], answer: 0, section: 'General'}];
  for (const live of [false, true]) {
    const input = {title: live ? 'Live Final' : 'Manual Mock', questions: question, live, startsAt: '2026-01-01T09:00',
      expiresAt: '2099-01-01T09:00', durationMinutes: 30, attemptsLimit: 3,
      marksPerQuestion: 1, negativeMark: 0, questionPaperDownload: true};
    assert.equal((await request(`/admin/courses/${courseId}/tests`, 'student', 'POST', input)).status, 403);
    assert.equal((await request(`/admin/courses/${courseId}/tests`, 'admin', 'POST',
      {...input, questionPaperDownload: 'true'})).status, 422);
    const createdTest = await request(`/admin/courses/${courseId}/tests`, 'admin', 'POST', input);
    assert.equal(createdTest.status, 201);
    const {id: testId} = await createdTest.json();
    const path = `/tests/${testId}`;
    assert.equal((await request(`${path}/question-paper.pdf`, 'student')).status, 403);
    assert.equal((await request(`${path}/question-paper.pdf`, 'other')).status, 403);
    const visible = await (await request(path, 'student')).json();
    assert.equal(visible.questionPaperDownload, true);
    assert.equal(visible.questions[0].answer, undefined);
    assert.equal((await request(`${path}/start`, 'student', 'POST')).status, 201);
    const result = await request(`${path}/submit`, 'student', 'POST', {answers:[0]});
    assert.equal(result.status, 200);
    assert.equal((await result.json()).questionPaperDownload, true);
    const before = db.prepare('SELECT COUNT(*) AS count FROM attempts WHERE uid=? AND test=?').get('student', testId).count;
    const paper = await request(`${path}/question-paper.pdf`, 'student');
    assert.equal(paper.status, 200);
    assert.equal(paper.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await paper.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    const after = db.prepare('SELECT COUNT(*) AS count FROM attempts WHERE uid=? AND test=?').get('student', testId).count;
    assert.equal(after, before);
    const edit = {title: input.title, questions: question, questionPaperDownload: false};
    assert.equal((await request(`/admin/published/tests/${testId}`, 'admin', 'PUT', edit)).status, 204);
    assert.equal((await request(`${path}/question-paper.pdf`, 'student')).status, 403);
    assert.equal((await request(`/admin/published/tests/${testId}`, 'admin', 'PUT',
      {...edit, questionPaperDownload: true})).status, 204);
    assert.equal((await request(`${path}/question-paper.pdf`, 'student')).status, 200);
  }
});