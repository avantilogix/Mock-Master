import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

export function createApp({ db, verifyToken, manualPayment = {}, firebase = {}, adminUids = [], trustLocalProxy = false }) {
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
  const admins = new Set(adminUids);
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
  const paymentDetails = upiDetails(manualPayment);
  api.get('/config', (_req, res) => res.json({ firebase, payment: paymentDetails }));
  api.get('/social', (_req, res) => {
    const rows = all('SELECT key, value FROM settings WHERE key IN (?, ?, ?)', 'youtube', 'instagram', 'telegram');
    res.json(Object.fromEntries(rows.map(row => [row.key, row.value])));
  });
  api.get('/courses', (_req, res) => res.json(all('SELECT * FROM courses ORDER BY rowid DESC')));
  api.get('/courses/:id/payment-qr', async (req, res) => {
    const row = course(req.params.id);
    const uri = upiPaymentUri(paymentDetails, row.price, `Mission Selection ${row.title}`);
    if (!uri) fail(503, 'UPI payment details are not configured.');
    res.type('svg').send(await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  });
  api.get('/courses/:id/reviews', (req, res) => {
    course(req.params.id);
    res.json(all(`SELECT COALESCE(NULLIF(s.name, ''), 'Student') AS name, r.rating, r.text
      FROM reviews r JOIN students s USING (uid) WHERE r.course=? ORDER BY r.rowid DESC LIMIT 100`, req.params.id));
  });
  api.get('/timetable', (_req, res) => res.json(all('SELECT * FROM schedules ORDER BY day, starts_at')));
  api.get('/physical-books', (_req, res) => res.json(all('SELECT id, title, description, price, stock FROM physical_books WHERE active=1 ORDER BY rowid DESC')));
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
      books: all('SELECT id, title, pages FROM books WHERE course=? ORDER BY rowid', id),
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
    res.json({ amount: price, payment: { ...paymentDetails, qr: `/api/courses/${id}/payment-qr` }, order });
  });
  api.post('/courses/:id/payment', paymentLimit, (req, res) => {
    const { id, price } = course(req.params.id);
    const { uid } = req.user;
    if (owns(uid, id)) fail(409, 'You already own this course.');
    if (!paymentDetails.configured) fail(503, 'UPI payment details are not configured.');
    const reference = paymentReference(req.body?.reference);
    if (!reference) fail(422, 'Enter a valid UPI transaction reference (4–80 characters).');
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
    run(`INSERT INTO orders (id, uid, course, amount, payment_status, transaction_ref, payment_note, submitted_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
      ON CONFLICT (uid, course) DO UPDATE SET amount=excluded.amount, payment_status='pending',
        transaction_ref=excluded.transaction_ref, payment_note=excluded.payment_note, submitted_at=excluded.submitted_at,
        review_note='', reviewed_at='', reviewed_by=''`,
    orderId, uid, id, price, reference, note, submittedAt);
    res.status(201).json({ id: orderId, amount: price, status: 'pending', reference, submittedAt });
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
    res.json({
      attempts,
      summary: { attempts: attempts.length, questions: total, correct,
        accuracy: total ? Math.round(correct / total * 100) : 0 },
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
    res.json(all('SELECT id, kind, title, summary, body, created_at AS createdAt FROM resources WHERE kind=? ORDER BY created_at DESC',
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

  api.use('/admin', admin);
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
    run('INSERT INTO resources VALUES (?, ?, ?, ?, ?, ?)', id, kind,
      text(req.body?.title, 'Title', 120), text(req.body?.summary, 'Summary', 300),
      text(req.body?.body, 'Content', 10_000), new Date().toISOString());
    res.status(201).json({ id });
  });
  api.post('/admin/courses', (req, res) => {
    const { title, description, price } = req.body ?? {};
    if (!Number.isInteger(price) || price < 100 || price > 10_000_000) fail(422, 'Price must be ₹1–₹100,000, in whole paise.');
    const id = randomUUID();
    run('INSERT INTO courses VALUES (?, ?, ?, ?)', id, text(title, 'Title', 120), text(description, 'Description', 2000), price);
    res.status(201).json({ id });
  });
  api.post('/admin/courses/:id/tests', (req, res) => {
    const { id: courseId } = course(req.params.id);
    const id = randomUUID();
    const { title, questions } = req.body ?? {};
    run('INSERT INTO tests VALUES (?, ?, ?, ?)', id, courseId, text(title, 'Title', 120), JSON.stringify(validateQuestions(questions)));
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
    run('INSERT INTO books VALUES (?, ?, ?, ?, ?)', id, courseId, title, pages, req.body);
    res.status(201).json({ id, pages });
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
    const order = one('SELECT id, payment_status FROM orders WHERE id=?', req.params.id);
    if (!order) fail(404, 'Payment request not found.');
    if (order.payment_status !== 'pending') fail(409, 'Only pending requests can be rejected.');
    const reviewNote = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!reviewNote || reviewNote.length > 500) fail(422, 'Enter a rejection reason (maximum 500 characters).');
    run(`UPDATE orders SET payment_status='rejected', reviewed_at=?, reviewed_by=?, review_note=?
      WHERE id=? AND payment_status='pending'`, new Date().toISOString(), req.user.uid, reviewNote, order.id);
    res.sendStatus(204);
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
