import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, createWriteStream, mkdirSync, openSync, readFileSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import QRCode from 'qrcode';
import { fail, importQuestions, mobile, pageCount, renderPage, validateQuestions } from './documents.js';
import { paymentReference, upiDetails, upiPaymentUri } from './manual-payments.js';

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(422, `${label} is required (maximum ${max} characters).`);
  return value.trim();
}

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const VIDEO_LINK_SECONDS = 2 * 60 * 60;
const videoTypes = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

function looksLikeVideo(path, type) {
  const header = Buffer.alloc(12);
  const fd = openSync(path, 'r');
  try { readSync(fd, header, 0, 12, 0); } finally { closeSync(fd); }
  if (type === 'video/webm') return header.readUInt32BE(0) === 0x1a45dfa3;
  return ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(header.toString('latin1', 4, 8));
}

export function createApp({ db, verifyToken, manualPayment = {}, firebase = {}, adminUids = [], trustLocalProxy = false,
  videoDir = join(tmpdir(), 'mock-master-videos'), dummyLogin = false }) {
  const app = express();
  if (trustLocalProxy) app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    });
    next();
  });
  const api = express.Router();
  app.use('/api', api);
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const raw = express.raw({ type: 'application/octet-stream', limit: '12mb', inflate: false });
  const limit = max => rateLimit({
    windowMs: 60_000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Wait a minute and try again.' },
  });
  const authLimit = limit(120);
  const paymentLimit = limit(20);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function transaction(work) {
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  const admins = new Set(adminUids);
  const linkSecret = randomBytes(32);
  const videoSignature = (id, uid, expires) => createHmac('sha256', linkSecret).update(`${id}|${uid}|${expires}`).digest('base64url');
  const videoPath = id => resolve(videoDir, id.replace(/[^A-Za-z0-9-]/g, ''));
  let documentJobs = 0;
  async function processDocument(operation) {
    if (documentJobs >= 4) fail(503, 'Document processing is busy. Please retry.');
    documentJobs++;
    try { return await operation(); } finally { documentJobs--; }
  }

  const login = async (req, res, next) => {
    const [scheme, token, extra] = (req.get('Authorization') || '').split(' ');
    if (scheme.toLowerCase() !== 'bearer' || !token || extra !== undefined) fail(401, 'Sign in with your mobile number.');
    let user;
    try {
      user = await verifyToken(token);
    } catch (error) {
      if (error.status === 503) throw error;
      fail(401, 'Your sign-in expired or could not be verified.');
    }
    if (typeof user?.uid !== 'string' || !user.uid || user.uid.length > 128 ||
        typeof user.phone !== 'string' || !mobile.test(user.phone)) fail(403, 'Use a verified Indian mobile number.');
    run(`INSERT INTO students (uid, phone) VALUES (?, ?) ON CONFLICT (uid) DO UPDATE SET phone=excluded.phone
      WHERE students.phone != excluded.phone`, user.uid, user.phone);
    const student = one('SELECT disabled FROM students WHERE uid=?', user.uid);
    if (student?.disabled) fail(403, 'This account is disabled. Contact support to request reactivation.');
    req.user = { ...user, admin: admins.has(user.uid) };
    next();
  };
  const admin = (req, res, next) => {
    if (!req.user.admin) fail(403, 'Admin access required.');
    next();
  };
  function course(id) {
    const row = one('SELECT * FROM courses WHERE id=?', id);
    if (!row) fail(404, 'Course not found.');
    return row;
  }
  const owns = (uid, id) => one('SELECT 1 FROM orders WHERE uid=? AND course=? AND payment IS NOT NULL', uid, id);
  function requirePurchase(req, id, allowAdmin = true) {
    if (!(allowAdmin && req.user.admin) && !owns(req.user.uid, id)) fail(403, 'Purchase this course to unlock it.');
  }
  api.use(express.json({ limit: '1mb', inflate: false }));
  const runtimePayment = () => {
    const setting = one('SELECT * FROM payment_settings WHERE id=1');
    const details = upiDetails({
      upiId: setting?.upi_id ?? manualPayment.upiId,
      payeeName: setting?.payee_name ?? manualPayment.payeeName,
    });
    const method = ['upi', 'qr', 'both'].includes(setting?.method) ? setting.method : 'upi';
    return {
      ...details,
      method,
      customQr: Boolean(setting?.qr),
      configured: (method !== 'qr' && details.configured) || (method !== 'upi' && Boolean(setting?.qr)),
    };
  };
  api.get('/config', (_req, res) => res.json({ firebase, payment: runtimePayment(), personalTimetable: true,
    ...(dummyLogin ? { dummyLogin: true } : {}) }));
  api.get('/social', (_req, res) => {
    const rows = all('SELECT key, value FROM settings WHERE key IN (?, ?, ?)', 'youtube', 'instagram', 'telegram');
    res.json(Object.fromEntries(rows.map(row => [row.key, row.value])));
  });
  api.get('/courses', (_req, res) => res.json(all('SELECT id, title, description, price FROM courses ORDER BY rowid DESC')));
  api.get('/courses/:id/payment-qr', async (req, res) => {
    const row = course(req.params.id);
    const payment = runtimePayment();
    const setting = one('SELECT qr, qr_type FROM payment_settings WHERE id=1');
    if (setting?.qr && payment.method !== 'upi') {
      res.type(setting.qr_type || 'png').send(Buffer.from(setting.qr));
      return;
    }
    const uri = upiPaymentUri(payment, row.price, `Mission Selection ${row.title}`);
    if (!uri) fail(503, 'UPI payment details are not configured.');
    res.type('svg').send(await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  });
  api.get('/payment-qr', async (_req, res) => {
    const payment = runtimePayment();
    const setting = one('SELECT qr, qr_type FROM payment_settings WHERE id=1');
    if (setting?.qr && payment.method !== 'upi') {
      res.type(setting.qr_type || 'png').send(Buffer.from(setting.qr));
      return;
    }
    const uri = upiPaymentUri(payment, 100, 'Mission Selection payment');
    if (!uri) fail(503, 'Payment details are not configured.');
    res.type('svg').send(await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  });
  api.get('/courses/:id/reviews', (req, res) => {
    course(req.params.id);
    res.json(all(`SELECT COALESCE(NULLIF(s.name, ''), 'Student') AS name, r.rating, r.text
      FROM reviews r JOIN students s USING (uid) WHERE r.course=? ORDER BY r.rowid DESC LIMIT 100`, req.params.id));
  });
  api.get('/timetable', (_req, res) => res.json(all('SELECT * FROM schedules ORDER BY day, starts_at')));
  api.get('/physical-books', (_req, res) => res.json(all('SELECT id, title, description, price, stock FROM physical_books WHERE active=1 ORDER BY rowid DESC')));
  api.get('/videos', (_req, res) => res.json(all(`SELECT v.id, v.title, v.description, v.video_id AS videoId,
    v.created_at AS createdAt, c.title AS courseTitle FROM videos v LEFT JOIN courses c ON c.id=v.course
    ORDER BY v.created_at DESC`)));
  // <video> and download links cannot send an Authorization header, so they use a short-lived signed link.
  api.get('/videos/:id/file', (req, res) => {
    const { uid, expires, signature } = req.query;
    if (![uid, expires, signature].every(value => typeof value === 'string' && value)) fail(403, 'This video link is invalid.');
    const expected = Buffer.from(videoSignature(req.params.id, uid, expires));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) fail(403, 'This video link is invalid.');
    if (!(Number(expires) > Date.now() / 1000)) fail(403, 'This video link has expired. Open the video again.');
    const video = one('SELECT * FROM chapter_videos WHERE id=?', req.params.id);
    if (!video) fail(404, 'Video not found.');
    if (one('SELECT 1 FROM students WHERE uid=? AND disabled', uid)) fail(403, 'This account is disabled. Contact support to request reactivation.');
    if (!admins.has(uid) && !owns(uid, video.course)) fail(403, 'Purchase this course to unlock it.');
    if (req.query.download === '1') res.attachment(`${video.title.replace(/[^\w .-]+/g, '_')}.${videoTypes[video.type] || 'mp4'}`);
    res.sendFile(videoPath(video.id), { headers: { 'Content-Type': video.type } });
  });
  api.use(authLimit, login);
  api.get('/me', (req, res) => {
    const { uid, phone, admin } = req.user;
    const { name } = one('SELECT name FROM students WHERE uid=?', uid);
    res.json({ uid, name, phone, admin, purchases: all('SELECT course FROM orders WHERE uid=? AND payment IS NOT NULL', uid).map(p => p.course) });
  });
  api.put('/me', (req, res) => {
    run('UPDATE students SET name=? WHERE uid=?', text(req.body?.name, 'Name', 100), req.user.uid);
    res.sendStatus(204);
  });
  api.post('/me/disable', (req, res) => {
    run('UPDATE students SET disabled=1 WHERE uid=?', req.user.uid);
    res.sendStatus(204);
  });
  api.get('/referral', (req, res) => {
    let referral = one('SELECT code, referred_by, credits FROM referrals WHERE uid=?', req.user.uid);
    if (!referral) {
      const code = `MS${createHash('sha256').update(req.user.uid).digest('hex').slice(0, 6).toUpperCase()}`;
      run('INSERT INTO referrals (uid, code) VALUES (?, ?)', req.user.uid, code);
      referral = one('SELECT code, referred_by, credits FROM referrals WHERE uid=?', req.user.uid);
    }
    res.json(referral);
  });
  api.post('/referral/apply', (req, res) => {
    const mine = one('SELECT referred_by FROM referrals WHERE uid=?', req.user.uid);
    if (mine?.referred_by) fail(409, 'A referral code is already linked to your account.');
    const code = text(req.body?.code, 'Referral code', 20).toUpperCase();
    const referrer = one('SELECT uid FROM referrals WHERE code=? AND uid!=?', code, req.user.uid);
    if (!referrer) fail(422, 'Enter a valid referral code from another student.');
    run('INSERT INTO referrals (uid, code, referred_by) VALUES (?, ?, ?) ON CONFLICT (uid) DO UPDATE SET referred_by=excluded.referred_by',
      req.user.uid, `MS${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`, referrer.uid);
    run('UPDATE referrals SET credits=credits+100 WHERE uid=?', referrer.uid);
    res.sendStatus(204);
  });
  api.get('/physical-orders', (req, res) => res.json(all(`SELECT o.id, b.title, o.quantity, o.amount, o.status, o.review_note AS reviewNote,
    o.tracking, o.created_at AS createdAt FROM physical_orders o JOIN physical_books b ON b.id=o.book
    WHERE o.uid=? ORDER BY o.created_at DESC`, req.user.uid)));
  api.post('/physical-orders', (req, res) => {
    const { bookId } = req.body ?? {};
    const book = one('SELECT * FROM physical_books WHERE id=? AND active=1', bookId);
    if (!book || book.stock < 1) fail(404, 'This physical book is not available.');
    const quantity = req.body?.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > book.stock || quantity > 5) fail(422, 'Choose a valid quantity.');
    const address = typeof req.body?.address === 'object' && req.body.address !== null ? req.body.address : null;
    if (!address) fail(422, 'Provide a shipping address.');
    const fullName = text(address.fullName, 'Full name', 100);
    const phone = typeof address.phone === 'string' && /^[6-9][0-9]{9}$/.test(address.phone.replace(/\D/g, '')) ?
      address.phone.replace(/\D/g, '') : null;
    if (!phone) fail(422, 'Enter a valid 10-digit delivery mobile number.');
    const completeAddress = [
      fullName, text(address.line1, 'Address', 300), (address.line2 || '').trim(), text(address.city, 'City', 100),
      text(address.state, 'State', 100), text(address.pin, 'PIN code', 6), phone,
    ].filter(Boolean).join('\n');
    const reference = paymentReference(req.body?.reference);
    if (!reference) fail(422, 'Enter a valid UPI transaction reference.');
    const id = randomUUID();
    run('INSERT INTO physical_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, req.user.uid, book.id, quantity, quantity * book.price, reference, completeAddress, 'pending', '', '',
      new Date().toISOString(), new Date().toISOString());
    res.status(201).json({ id, amount: quantity * book.price, status: 'pending' });
  });
  api.get('/courses/:id', (req, res) => {
    const { id } = course(req.params.id);
    requirePurchase(req, id);
    res.json({
      tests: all('SELECT id, title FROM tests WHERE course=? ORDER BY rowid', id),
      books: all('SELECT id, title, pages, subject, chapter FROM books WHERE course=? ORDER BY subject, chapter, rowid', id),
      videos: all('SELECT id, title, subject, chapter, type, size FROM chapter_videos WHERE course=? ORDER BY subject, chapter, rowid', id),
      messages: all(`SELECT COALESCE(NULLIF(s.name, ''), 'Student') AS name, m.text
        FROM messages m JOIN students s USING (uid) WHERE m.course=? ORDER BY m.id DESC LIMIT 100`, id).reverse(),
    });
  });
  api.post('/courses/:id/messages', (req, res) => {
    const { id } = course(req.params.id);
    requirePurchase(req, id);
    run('INSERT INTO messages (course, uid, text) VALUES (?, ?, ?)', id, req.user.uid, text(req.body?.text, 'Message', 1000));
    res.sendStatus(204);
  });
  api.put('/courses/:id/reviews', (req, res) => {
    const { id } = course(req.params.id);
    requirePurchase(req, id, false);
    const rating = req.body?.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(422, 'Choose a rating from 1 to 5.');
    run(`INSERT INTO reviews (course, uid, rating, text) VALUES (?, ?, ?, ?)
      ON CONFLICT (course, uid) DO UPDATE SET rating=excluded.rating, text=excluded.text`,
    id, req.user.uid, rating, text(req.body?.text, 'Review', 1000));
    res.sendStatus(204);
  });
  api.post('/support', (req, res) => {
    run('INSERT INTO tickets (uid, text) VALUES (?, ?)', req.user.uid, text(req.body?.text, 'Support request', 2000));
    res.sendStatus(204);
  });
  api.get('/courses/:id/payment', (req, res) => {
    const { id, price } = course(req.params.id);
    const order = one(`SELECT id, amount, payment_status AS status, transaction_ref AS reference,
      payment_note AS note, review_note AS reviewNote, submitted_at AS submittedAt FROM orders
      WHERE uid=? AND course=?`, req.user.uid, id);
    const credits = one('SELECT credits FROM referrals WHERE uid=?', req.user.uid)?.credits || 0;
    res.json({ amount: price, credits, payment: { ...runtimePayment(), qr: `/api/courses/${id}/payment-qr` }, order });
  });
  api.post('/courses/:id/payment', paymentLimit, (req, res) => {
    const { id, price } = course(req.params.id);
    const { uid } = req.user;
    if (owns(uid, id)) fail(409, 'You already own this course.');
    const referral = one('SELECT credits FROM referrals WHERE uid=?', uid);
    const creditsUsed = req.body?.useCredits === true ? Math.min(Number(referral?.credits || 0), Math.ceil(price / 100)) : 0;
    const amountDue = Math.max(0, price - creditsUsed * 100);
    if (amountDue > 0 && !runtimePayment().configured) fail(503, 'Payment details are not configured.');
    const reference = paymentReference(req.body?.reference);
    if (amountDue > 0 && !reference) fail(422, 'Enter a valid UPI transaction reference (4–80 characters).');
    if (typeof req.body?.note !== 'undefined' && (typeof req.body.note !== 'string' || req.body.note.length > 500)) {
      fail(422, 'Payment note must be 500 characters or fewer.');
    }
    const note = (req.body?.note || '').trim();
    const submittedAt = new Date().toISOString();
    const existing = one('SELECT id, payment_status FROM orders WHERE uid=? AND course=?', uid, id);
    if (existing?.payment_status === 'pending') {
      return res.status(409).json({ error: 'A payment request is already waiting for admin review.' });
    }
    const orderId = existing?.id || randomUUID();
    if (creditsUsed) run('UPDATE referrals SET credits=credits-? WHERE uid=? AND credits>=?', creditsUsed, uid, creditsUsed);
    run(`INSERT INTO orders (id, uid, course, amount, original_amount, credits_used, payment_status,
      transaction_ref, payment_note, submitted_at, payment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (uid, course) DO UPDATE SET amount=excluded.amount, original_amount=excluded.original_amount,
        credits_used=excluded.credits_used, payment=excluded.payment, payment_status=excluded.payment_status,
        transaction_ref=excluded.transaction_ref, payment_note=excluded.payment_note, submitted_at=excluded.submitted_at,
        review_note='', reviewed_at='', reviewed_by=''`,
    orderId, uid, id, amountDue, price, creditsUsed, amountDue === 0 ? 'approved' : 'pending',
      reference || 'CREDITS', note, submittedAt, amountDue === 0 ? `credits:${orderId}` : null);
    res.status(201).json({ id: orderId, amount: amountDue, creditsUsed,
      status: amountDue === 0 ? 'approved' : 'pending', reference: reference || 'CREDITS', submittedAt });
  });

  function test(id) {
    const row = one('SELECT * FROM tests WHERE id=?', id);
    if (!row) fail(404, 'Test not found.');
    return row;
  }
  api.get('/tests/:id', (req, res) => {
    const row = test(req.params.id);
    requirePurchase(req, row.course);
    res.json({ title: row.title, questions: JSON.parse(row.questions).map(({ prompt, options }) => ({ prompt, options })) });
  });
  api.post('/tests/:id/submit', (req, res) => {
    const row = test(req.params.id);
    requirePurchase(req, row.course);
    const questions = JSON.parse(row.questions);
    const { answers } = req.body ?? {};
    if (!Array.isArray(answers) || answers.length !== questions.length ||
        answers.some((v, i) => v !== null && (!Number.isInteger(v) || v < 0 || v >= questions[i].options.length))) {
      fail(422, 'Provide one valid answer or null per question.');
    }
    const score = questions.filter((q, i) => answers[i] === q.answer).length;
    const result = { score, total: questions.length };
    run('INSERT INTO attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), req.user.uid, row.course,
      row.id, row.title, score, questions.length, new Date().toISOString());
    res.json(result);
  });
  api.get('/progress', (req, res) => {
    const attempts = all(`SELECT a.id, a.course, c.title AS courseTitle, a.test, a.title, a.score, a.total,
      a.created_at AS createdAt FROM attempts a JOIN courses c ON c.id=a.course
      WHERE a.uid=? ORDER BY a.created_at DESC LIMIT 100`, req.user.uid);
    const total = attempts.reduce((sum, item) => sum + item.total, 0);
    const correct = attempts.reduce((sum, item) => sum + item.score, 0);
    const courses = Object.values(attempts.reduce((groups, item) => {
      const entry = groups[item.course] ||= { course: item.course, title: item.courseTitle, attempts: 0, correct: 0, total: 0, best: 0 };
      entry.attempts++;
      entry.correct += item.score;
      entry.total += item.total;
      entry.best = Math.max(entry.best, Math.round(item.score / item.total * 100));
      entry.accuracy = Math.round(entry.correct / entry.total * 100);
      return groups;
    }, {}));
    const trend = attempts.slice(0, 10).reverse().map(item => ({
      label: new Date(item.created_at || item.createdAt).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'}),
      value: Math.round(item.score / item.total * 100), title: item.title,
    }));
    res.json({
      attempts,
      summary: { attempts: attempts.length, questions: total, correct,
        accuracy: total ? Math.round(correct / total * 100) : 0,
        best: attempts.length ? Math.max(...attempts.map(item => Math.round(item.score / item.total * 100))) : 0,
        courses: courses.length },
      courses,
      trend,
    });
  });
  api.get('/notifications', (req, res) => {
    const orders = all(`SELECT o.id, o.course, c.title, o.payment_status AS status, o.review_note AS reviewNote,
      o.submitted_at AS date FROM orders o JOIN courses c ON c.id=o.course WHERE o.uid=?
      ORDER BY o.submitted_at DESC LIMIT 50`, req.user.uid);
    res.json(orders.map(order => ({
      id: `payment-${order.id}`,
      title: order.status === 'approved' ? `${order.title} is unlocked` :
        order.status === 'rejected' ? `${order.title} payment needs attention` :
        `${order.title} payment is under review`,
      body: order.status === 'rejected' ? order.reviewNote : order.status === 'approved' ?
        'Your mission, tests and books are ready.' : 'The admin is verifying your UPI transaction.',
      href: `#course/${order.course}`,
      date: order.date,
      unread: order.status === 'pending',
    })));
  });
  api.get('/content/:kind', (req, res) => {
    if (!['current-affairs', 'pyqs', 'syllabus', 'free-tests'].includes(req.params.kind)) fail(404, 'Content not found.');
    res.json(all(`SELECT id, kind, title, summary, body, created_at AS createdAt,
      published_at AS publishedAt FROM resources WHERE kind=?
      ORDER BY CASE WHEN published_at='' THEN created_at ELSE published_at END DESC`,
      req.params.kind));
  });
  api.get('/books/:id/pages/:page', async (req, res) => {
    const book = one('SELECT course, pages FROM books WHERE id=?', req.params.id);
    if (!book) fail(404, 'Book not found.');
    requirePurchase(req, book.course);
    const page = Number(req.params.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > book.pages) fail(404, 'Page not found.');
    const png = await processDocument(() => renderPage(Buffer.from(one('SELECT pdf FROM books WHERE id=?', req.params.id).pdf), page, req.user.phone));
    res.type('png').send(png);
  });
  api.get('/books/:id/pages/:page/download', async (req, res) => {
    const book = one('SELECT id, course, title, pages, pdf FROM books WHERE id=?', req.params.id);
    if (!book) fail(404, 'Book not found.');
    requirePurchase(req, book.course);
    const page = Number(req.params.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > book.pages) fail(404, 'Page not found.');
    const png = await processDocument(() => renderPage(Buffer.from(book.pdf), page, req.user.phone));
    res.attachment(`${book.title}-page-${page}.png`).type('png').send(png);
  });
  api.get('/videos/:id/link', (req, res) => {
    const video = one('SELECT id, course, title, type FROM chapter_videos WHERE id=?', req.params.id);
    if (!video) fail(404, 'Video not found.');
    requirePurchase(req, video.course);
    const expires = String(Math.floor(Date.now() / 1000) + VIDEO_LINK_SECONDS);
    const query = new URLSearchParams({ uid: req.user.uid, expires, signature: videoSignature(video.id, req.user.uid, expires) });
    res.json({ url: `/api/videos/${encodeURIComponent(video.id)}/file?${query}`, title: video.title, type: video.type });
  });

  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  function scheduleInput(body) {
    const day = body?.day;
    if (!weekDays.includes(day)) fail(422, 'Choose a day of the week.');
    const startsAt = body?.startsAt;
    if (typeof startsAt !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt)) fail(422, 'Enter a valid start time.');
    const duration = body?.duration;
    if (!Number.isInteger(duration) || duration < 5 || duration > 720) fail(422, 'Duration must be 5 to 720 minutes.');
    const description = body?.description ?? '';
    if (typeof description !== 'string' || description.length > 1000) fail(422, 'Notes can be at most 1000 characters.');
    return { title: text(body?.title, 'Session title', 120), day, startsAt, duration, description: description.trim() };
  }
  const mySchedule = (req, id) => {
    const row = one('SELECT id FROM student_schedules WHERE id=? AND uid=?', id, req.user.uid);
    if (!row) fail(404, 'Timetable session not found.');
    return row;
  };
  api.get('/timetable/mine', (req, res) => {
    const rows = all(`SELECT id, title, day, starts_at AS startsAt, duration, description, created_at AS createdAt,
      updated_at AS updatedAt FROM student_schedules WHERE uid=?`, req.user.uid);
    rows.sort((a, b) => weekDays.indexOf(a.day) - weekDays.indexOf(b.day) || a.startsAt.localeCompare(b.startsAt));
    res.json(rows);
  });
  api.post('/timetable/mine', (req, res) => {
    const entry = scheduleInput(req.body);
    if (one('SELECT COUNT(*) AS total FROM student_schedules WHERE uid=?', req.user.uid).total >= 100) {
      fail(422, 'Your timetable can hold at most 100 sessions. Delete an old session first.');
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    run('INSERT INTO student_schedules VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, req.user.uid, entry.title, entry.day,
      entry.startsAt, entry.duration, entry.description, now, now);
    res.status(201).json({ id });
  });
  api.put('/timetable/mine/:id', (req, res) => {
    const { id } = mySchedule(req, req.params.id);
    const entry = scheduleInput(req.body);
    run(`UPDATE student_schedules SET title=?, day=?, starts_at=?, duration=?, description=?, updated_at=?
      WHERE id=? AND uid=?`, entry.title, entry.day, entry.startsAt, entry.duration, entry.description,
    new Date().toISOString(), id, req.user.uid);
    res.sendStatus(204);
  });
  api.delete('/timetable/mine/:id', (req, res) => {
    const { id } = mySchedule(req, req.params.id);
    run('DELETE FROM student_schedules WHERE id=? AND uid=?', id, req.user.uid);
    res.sendStatus(204);
  });

  api.use('/admin', admin);
  api.post('/admin/videos', (req, res) => {
    const raw = req.body?.url || '';
    const input = String(raw);
    let videoId = '';
    try {
      const url = new URL(input);
      if (url.hostname === 'youtu.be') videoId = url.pathname.slice(1).split('/')[0];
      else if (url.hostname.endsWith('youtube.com')) videoId = url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).at(-1);
    } catch { /* Invalid URL rejected below. */ }
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) fail(422, 'Enter a valid YouTube video URL.');
    const selectedCourse = typeof req.body?.course === 'string' ? req.body.course : '';
    if (selectedCourse) course(selectedCourse);
    const id = randomUUID();
    run('INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?)', id, text(req.body?.title, 'Video title', 120),
      text(req.body?.description, 'Description', 1000), videoId, selectedCourse, new Date().toISOString());
    res.status(201).json({ id, videoId });
  });
  api.get('/admin/payment-settings', (_req, res) => res.json(runtimePayment()));
  api.put('/admin/payment-settings', (req, res) => {
    const method = req.body?.method;
    if (!['upi', 'qr', 'both'].includes(method)) fail(422, 'Choose UPI, QR code, or both.');
    const upi = upiDetails({ upiId: req.body?.upiId, payeeName: req.body?.payeeName });
    const existing = one('SELECT qr, qr_type FROM payment_settings WHERE id=1');
    if (method !== 'qr' && !upi.configured) fail(422, 'Enter a valid UPI ID and payee name.');
    if (method !== 'upi' && !existing?.qr) fail(422, 'Upload a payment QR image before enabling QR checkout.');
    run(`INSERT INTO payment_settings (id, upi_id, payee_name, method) VALUES (1, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET upi_id=excluded.upi_id, payee_name=excluded.payee_name, method=excluded.method`,
    req.body?.upiId || '', text(req.body?.payeeName, 'Payee name', 100), method);
    res.sendStatus(204);
  });
  api.post('/admin/payment-qr', express.raw({ type: /^image\//, limit: '2mb', inflate: false }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 8) fail(400, 'Upload a non-empty PNG, JPEG, or WebP QR image.');
    const type = req.get('Content-Type') || '';
    if (!/^image\/(png|jpeg|webp)$/i.test(type)) fail(422, 'Upload a PNG, JPEG, or WebP QR image.');
    run(`INSERT INTO payment_settings (id, upi_id, payee_name, qr, qr_type) VALUES (1, '', '', ?, ?)
      ON CONFLICT (id) DO UPDATE SET qr=excluded.qr, qr_type=excluded.qr_type`, req.body, type);
    res.status(201).json({ configured: true });
  });
  api.get('/admin/students', (_req, res) => res.json(all(`SELECT uid, phone, name, disabled FROM students ORDER BY name, phone LIMIT 500`)));
  api.post('/admin/students/:uid/status', (req, res) => {
    const disabled = req.body?.disabled;
    if (typeof disabled !== 'boolean') fail(422, 'Choose a valid account status.');
    run('UPDATE students SET disabled=? WHERE uid=?', disabled ? 1 : 0, req.params.uid);
    if (!one('SELECT 1 FROM students WHERE uid=?', req.params.uid)) fail(404, 'Student not found.');
    res.sendStatus(204);
  });
  api.put('/admin/social', (req, res) => {
    const values = req.body ?? {};
    for (const key of ['youtube', 'instagram', 'telegram']) {
      const value = typeof values[key] === 'string' ? values[key].trim() : '';
      if (value && !/^https:\/\/[^/\s]+/i.test(value)) fail(422, `Enter a valid HTTPS ${key} URL.`);
      run('INSERT INTO settings VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value=excluded.value', key, value);
    }
    res.sendStatus(204);
  });
  api.get('/admin/timetable', (_req, res) => res.json(all('SELECT * FROM schedules ORDER BY day, starts_at')));
  api.post('/admin/timetable', (req, res) => {
    const id = randomUUID();
    run('INSERT INTO schedules VALUES (?, ?, ?, ?, ?, ?, ?)', id, text(req.body?.title, 'Title', 120),
      text(req.body?.day, 'Day', 20), text(req.body?.startsAt, 'Start time', 20),
      text(req.body?.duration, 'Duration', 30), text(req.body?.description, 'Description', 1000), new Date().toISOString());
    res.status(201).json({ id });
  });
  api.get('/admin/physical-books', (_req, res) => res.json(all('SELECT * FROM physical_books ORDER BY rowid DESC')));
  api.post('/admin/physical-books', (req, res) => {
    const { price, stock } = req.body ?? {};
    if (!Number.isInteger(price) || price < 100 || price > 10_000_000 || !Number.isInteger(stock) || stock < 0 || stock > 10000) {
      fail(422, 'Enter valid stock and a price from ₹1 to ₹100,000, in paise.');
    }
    const id = randomUUID();
    run('INSERT INTO physical_books VALUES (?, ?, ?, ?, ?, 1, ?)', id, text(req.body?.title, 'Title', 120),
      text(req.body?.description, 'Description', 2000), price, stock, new Date().toISOString());
    res.status(201).json({ id });
  });
  api.get('/admin/physical-orders', (_req, res) => res.json(all(`SELECT o.*, COALESCE(NULLIF(s.name, ''), 'Student') AS name,
    s.phone AS accountPhone, b.title AS bookTitle FROM physical_orders o JOIN students s ON s.uid=o.uid
    JOIN physical_books b ON b.id=o.book ORDER BY CASE WHEN o.status='pending' THEN 0 ELSE 1 END, o.created_at DESC LIMIT 200`)));
  api.post('/admin/physical-orders/:id/status', (req, res) => {
    const order = one('SELECT * FROM physical_orders WHERE id=?', req.params.id);
    if (!order) fail(404, 'Order not found.');
    const status = req.body?.status;
    if (!['approved', 'shipped', 'delivered', 'cancelled'].includes(status)) fail(422, 'Choose a valid order status.');
    const tracking = typeof req.body?.tracking === 'string' ? req.body.tracking.trim().slice(0, 100) : order.tracking;
    const reviewNote = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : order.review_note;
    run('UPDATE physical_orders SET status=?, review_note=?, tracking=?, updated_at=? WHERE id=?',
      status, reviewNote, tracking, new Date().toISOString(), order.id);
    if (status === 'approved' && order.status === 'pending') run('UPDATE physical_books SET stock=stock-? WHERE id=? AND stock>=?',
      order.quantity, order.book, order.quantity);
    res.sendStatus(204);
  });
  api.post('/admin/content/:kind', (req, res) => {
    const kind = req.params.kind;
    if (!['current-affairs', 'pyqs', 'syllabus', 'free-tests'].includes(kind)) fail(422, 'Choose a valid content section.');
    const id = randomUUID();
    const publishedAt = typeof req.body?.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.publishedAt)
      ? req.body.publishedAt : new Date().toISOString().slice(0, 10);
    run('INSERT INTO resources VALUES (?, ?, ?, ?, ?, ?, ?)', id, kind,
      text(req.body?.title, 'Title', 120), text(req.body?.summary, 'Summary', 300),
      text(req.body?.body, 'Content', 10_000), new Date().toISOString(), publishedAt);
    res.status(201).json({ id });
  });
  api.post('/admin/courses', (req, res) => {
    const { title, description, price } = req.body ?? {};
    if (!Number.isInteger(price) || price < 100 || price > 10_000_000) fail(422, 'Price must be ₹1–₹100,000, in whole paise.');
    const id = randomUUID();
    run('INSERT INTO courses (id, title, description, price, created_at) VALUES (?, ?, ?, ?, ?)', id, text(title, 'Title', 120),
      text(description, 'Description', 2000), price, new Date().toISOString());
    res.status(201).json({ id });
  });
  api.post('/admin/courses/:id/tests', (req, res) => {
    const { id: courseId } = course(req.params.id);
    const id = randomUUID();
    const { title, questions } = req.body ?? {};
    run('INSERT INTO tests (id, course, title, questions, created_at) VALUES (?, ?, ?, ?, ?)', id, courseId,
      text(title, 'Title', 120), JSON.stringify(validateQuestions(questions)), new Date().toISOString());
    res.status(201).json({ id });
  });
  api.post('/admin/import', raw, async (req, res) => {
    res.json({ questions: await processDocument(() => importQuestions(req.body, req.query.format)) });
  });
  api.post('/admin/courses/:id/books', raw, async (req, res) => {
    const { id: courseId } = course(req.params.id);
    const id = randomUUID();
    const title = text(req.query.title, 'Title', 120);
    if (!Buffer.isBuffer(req.body)) fail(400, 'Upload a PDF.');
    const pages = await processDocument(() => pageCount(req.body));
    const subject = text(req.query.subject || 'General', 'Subject', 100);
    const chapter = text(req.query.chapter || 'Chapter 1', 'Chapter', 120);
    run('INSERT INTO books (id, course, title, pages, pdf, subject, chapter, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, courseId, title, pages, req.body, subject, chapter, new Date().toISOString());
    res.status(201).json({ id, pages });
  });
  api.post('/admin/courses/:id/videos/upload', (req, res) => {
    course(req.params.id);
    res.json({ direct: true });
  });
  api.post('/admin/courses/:id/videos', async (req, res) => {
    const { id: courseId } = course(req.params.id);
    const title = text(req.query.title, 'Title', 120);
    const subject = text(req.query.subject || 'General', 'Subject', 100);
    const chapter = text(req.query.chapter || 'Chapter 1', 'Chapter', 120);
    const type = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!videoTypes[type]) fail(415, 'Upload an MP4, WebM, or MOV video.');
    if (Number(req.get('Content-Length')) > MAX_VIDEO_BYTES) fail(413, 'Videos can be at most 300 MB.');
    const id = randomUUID();
    const path = videoPath(id);
    mkdirSync(videoDir, { recursive: true, mode: 0o700 });
    let size = 0;
    try {
      await pipeline(req, new Transform({
        transform(chunk, _encoding, done) {
          size += chunk.length;
          done(size > MAX_VIDEO_BYTES ? Object.assign(new Error('Videos can be at most 300 MB.'), { status: 413 }) : null, chunk);
        },
      }), createWriteStream(path, { mode: 0o600 }));
      if (!size || !looksLikeVideo(path, type)) fail(422, 'The file is not a valid MP4, WebM, or MOV video.');
      run('INSERT INTO chapter_videos VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, courseId, title, subject, chapter, type, size,
        new Date().toISOString());
    } catch (error) {
      rmSync(path, { force: true });
      throw error;
    }
    res.status(201).json({ id, size });
  });
  api.get('/admin/payments', (req, res) => {
    res.json(all(`SELECT o.id, o.amount, o.transaction_ref AS reference, o.payment_note AS note,
      o.payment_status AS status, o.submitted_at AS submittedAt, o.review_note AS reviewNote,
      COALESCE(NULLIF(s.name, ''), 'Student') AS name, s.phone, c.title AS course
      FROM orders o JOIN students s ON s.uid=o.uid JOIN courses c ON c.id=o.course
      ORDER BY CASE WHEN o.payment_status='pending' THEN 0 ELSE 1 END, o.submitted_at DESC LIMIT 200`));
  });
  api.post('/admin/payments/:id/approve', (req, res) => {
    const order = one('SELECT id, payment_status FROM orders WHERE id=?', req.params.id);
    if (!order) fail(404, 'Payment request not found.');
    if (order.payment_status === 'approved') return res.sendStatus(204);
    if (order.payment_status !== 'pending') fail(409, 'Only pending requests can be approved.');
    const reviewedAt = new Date().toISOString();
    run(`UPDATE orders SET payment=?, payment_status='approved', reviewed_at=?, reviewed_by=?, review_note=''
      WHERE id=? AND payment_status='pending'`, `manual:${order.id}`, reviewedAt, req.user.uid, order.id);
    res.sendStatus(204);
  });
  api.post('/admin/payments/:id/reject', (req, res) => {
    const order = one('SELECT id, uid, payment_status, credits_used FROM orders WHERE id=?', req.params.id);
    if (!order) fail(404, 'Payment request not found.');
    if (order.payment_status !== 'pending') fail(409, 'Only pending requests can be rejected.');
    const reviewNote = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!reviewNote || reviewNote.length > 500) fail(422, 'Enter a rejection reason (maximum 500 characters).');
    if (order.credits_used) run('UPDATE referrals SET credits=credits+? WHERE uid=?',
      order.credits_used, order.uid);
    run(`UPDATE orders SET payment_status='rejected', credits_used=0, reviewed_at=?, reviewed_by=?, review_note=?
      WHERE id=? AND payment_status='pending'`, new Date().toISOString(), req.user.uid, reviewNote, order.id);
    res.sendStatus(204);
  });
  const priceInput = value => {
    if (!Number.isInteger(value) || value < 100 || value > 10_000_000) fail(422, 'Price must be ₹1–₹1,00,000.');
    return value;
  };
  api.get('/admin/published', (_req, res) => {
    const tests = all(`SELECT t.id, t.course, c.title AS courseTitle, t.title, t.questions, t.created_at AS createdAt,
      (SELECT COUNT(*) FROM attempts a WHERE a.test=t.id) AS attempts
      FROM tests t JOIN courses c ON c.id=t.course ORDER BY t.created_at DESC, t.rowid DESC`)
      .map(test => ({ ...test, questions: JSON.parse(test.questions) }));
    res.json({
      courses: all(`SELECT c.id, c.title, c.description, c.price, c.created_at AS createdAt,
        (SELECT COUNT(*) FROM orders o WHERE o.course=c.id) AS enrollments,
        (SELECT COUNT(*) FROM tests t WHERE t.course=c.id) AS tests,
        (SELECT COUNT(*) FROM books b WHERE b.course=c.id) + (SELECT COUNT(*) FROM chapter_videos v WHERE v.course=c.id) AS materials,
        (SELECT COUNT(*) FROM videos v WHERE v.course=c.id) AS linkedVideos
        FROM courses c ORDER BY c.created_at DESC, c.rowid DESC`),
      tests,
      books: all(`SELECT b.id, b.course, c.title AS courseTitle, b.title, b.pages, b.subject, b.chapter, b.created_at AS createdAt
        FROM books b JOIN courses c ON c.id=b.course ORDER BY b.created_at DESC, b.rowid DESC`),
      chapterVideos: all(`SELECT v.id, v.course, c.title AS courseTitle, v.title, v.subject, v.chapter, v.size,
        v.created_at AS createdAt FROM chapter_videos v JOIN courses c ON c.id=v.course ORDER BY v.created_at DESC`),
      videos: all(`SELECT v.id, v.title, v.description, v.video_id AS videoId, v.course, c.title AS courseTitle,
        v.created_at AS createdAt FROM videos v LEFT JOIN courses c ON c.id=v.course ORDER BY v.created_at DESC`),
      resources: all(`SELECT id, kind, title, summary, body, created_at AS createdAt, published_at AS publishedAt
        FROM resources ORDER BY created_at DESC`),
      physicalBooks: all(`SELECT b.id, b.title, b.description, b.price, b.stock, b.active, b.created_at AS createdAt,
        (SELECT COUNT(*) FROM physical_orders o WHERE o.book=b.id) AS orders FROM physical_books b ORDER BY b.created_at DESC`),
      schedules: all(`SELECT id, title, day, starts_at AS startsAt, duration, description, created_at AS createdAt
        FROM schedules ORDER BY created_at DESC`),
    });
  });
  const found = (table, id, label) => {
    const row = one(`SELECT * FROM ${table} WHERE id=?`, id);
    if (!row) fail(404, `${label} not found.`);
    return row;
  };
  const editors = {
    courses(id, body) {
      found('courses', id, 'Course');
      run('UPDATE courses SET title=?, description=?, price=? WHERE id=?', text(body.title, 'Title', 120),
        text(body.description, 'Description', 2000), priceInput(body.price), id);
    },
    tests(id, body) {
      found('tests', id, 'Test');
      run('UPDATE tests SET title=?, questions=? WHERE id=?', text(body.title, 'Title', 120),
        JSON.stringify(validateQuestions(body.questions)), id);
    },
    books(id, body) {
      found('books', id, 'Study book');
      run('UPDATE books SET title=?, subject=?, chapter=? WHERE id=?', text(body.title, 'Title', 120),
        text(body.subject, 'Subject', 100), text(body.chapter, 'Chapter', 120), id);
    },
    chapterVideos(id, body) {
      found('chapter_videos', id, 'Chapter video');
      run('UPDATE chapter_videos SET title=?, subject=?, chapter=? WHERE id=?', text(body.title, 'Title', 120),
        text(body.subject, 'Subject', 100), text(body.chapter, 'Chapter', 120), id);
    },
    videos(id, body) {
      found('videos', id, 'Video');
      const selected = typeof body.course === 'string' ? body.course : '';
      if (selected) course(selected);
      run('UPDATE videos SET title=?, description=?, course=? WHERE id=?', text(body.title, 'Video title', 120),
        text(body.description, 'Description', 1000), selected, id);
    },
    resources(id, body) {
      found('resources', id, 'Resource');
      if (typeof body.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.publishedAt) ||
          Number.isNaN(Date.parse(body.publishedAt))) fail(422, 'Enter a valid publish date.');
      run('UPDATE resources SET title=?, summary=?, body=?, published_at=? WHERE id=?', text(body.title, 'Title', 120),
        text(body.summary, 'Summary', 300), text(body.body, 'Content', 10_000), body.publishedAt, id);
    },
    physicalBooks(id, body) {
      found('physical_books', id, 'Physical book');
      const { stock } = body;
      if (!Number.isInteger(stock) || stock < 0 || stock > 10000) fail(422, 'Stock must be a whole number from 0 to 10,000.');
      if (typeof body.active !== 'boolean') fail(422, 'Choose whether the book is visible in the store.');
      run('UPDATE physical_books SET title=?, description=?, price=?, stock=?, active=? WHERE id=?', text(body.title, 'Title', 120),
        text(body.description, 'Description', 2000), priceInput(body.price), stock, body.active ? 1 : 0, id);
    },
    schedules(id, body) {
      found('schedules', id, 'Timetable session');
      run('UPDATE schedules SET title=?, day=?, starts_at=?, duration=?, description=? WHERE id=?', text(body.title, 'Title', 120),
        text(body.day, 'Day', 20), text(body.startsAt, 'Start time', 20), text(body.duration, 'Duration', 30),
        text(body.description, 'Description', 1000), id);
    },
  };
  const removers = {
    courses(id) {
      found('courses', id, 'Course');
      if (one('SELECT 1 FROM orders WHERE course=?', id)) {
        fail(409, 'Students have purchased or requested this course, so it cannot be deleted. Edit it instead.');
      }
      const files = all('SELECT id FROM chapter_videos WHERE course=?', id);
      transaction(() => {
        for (const table of ['attempts', 'messages', 'reviews', 'tests', 'books', 'chapter_videos']) {
          run(`DELETE FROM ${table} WHERE course=?`, id);
        }
        run("UPDATE videos SET course='' WHERE course=?", id);
        run('DELETE FROM courses WHERE id=?', id);
      });
      for (const file of files) rmSync(videoPath(file.id), { force: true });
    },
    tests(id) {
      found('tests', id, 'Test');
      transaction(() => {
        run('DELETE FROM attempts WHERE test=?', id);
        run('DELETE FROM tests WHERE id=?', id);
      });
    },
    books: id => { found('books', id, 'Study book'); run('DELETE FROM books WHERE id=?', id); },
    chapterVideos(id) {
      found('chapter_videos', id, 'Chapter video');
      run('DELETE FROM chapter_videos WHERE id=?', id);
      rmSync(videoPath(id), { force: true });
    },
    videos: id => { found('videos', id, 'Video'); run('DELETE FROM videos WHERE id=?', id); },
    resources: id => { found('resources', id, 'Resource'); run('DELETE FROM resources WHERE id=?', id); },
    schedules: id => { found('schedules', id, 'Timetable session'); run('DELETE FROM schedules WHERE id=?', id); },
    physicalBooks(id) {
      found('physical_books', id, 'Physical book');
      // Orders reference the book, so it is hidden from the store instead of being removed.
      if (one('SELECT 1 FROM physical_orders WHERE book=?', id)) {
        run('UPDATE physical_books SET active=0 WHERE id=?', id);
        return { archived: true };
      }
      run('DELETE FROM physical_books WHERE id=?', id);
    },
  };
  const managedType = type => Object.hasOwn(editors, type) ? type : fail(404, 'Content type not found.');
  api.put('/admin/published/:type/:id', (req, res) => {
    editors[managedType(req.params.type)](req.params.id, req.body ?? {});
    res.sendStatus(204);
  });
  api.delete('/admin/published/:type/:id', (req, res) => {
    const result = removers[managedType(req.params.type)](req.params.id);
    res.json({ deleted: !result?.archived, archived: Boolean(result?.archived) });
  });
  api.get('/admin/support', (_req, res) => res.json(all(`SELECT s.phone, t.text FROM tickets t
    JOIN students s USING (uid) ORDER BY t.id DESC LIMIT 100`)));
  api.use((_req, res) => res.status(404).json({ error: 'API route not found.' }));
  try {
    const assetLinks = JSON.parse(readFileSync(new URL('../public/.well-known/assetlinks.json', import.meta.url), 'utf8'));
    app.get('/.well-known/assetlinks.json', (_req, res) => res.json(assetLinks));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), { dotfiles: 'ignore' }));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const code = error.status;
    const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500;
    if (status === 500) console.error('Unhandled request error:', error.name, error.code);
    const message = error.type === 'entity.parse.failed' ? 'Invalid JSON body.' :
      status === 413 ? 'Request is too large.' : status < 500 || status === 503 ? error.message : 'Something went wrong.';
    res.status(status).json({ error: message });
  });
  return app;
}
