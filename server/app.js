import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { fail, importQuestions, mobile, pageCount, renderPage, validateQuestions } from './documents.js';

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(422, `${label} is required (maximum ${max} characters).`);
  return value.trim();
}

export function createApp({ db, verifyToken, payments, firebase = {}, adminUids = [], trustLocalProxy = false }) {
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
  const pending = new Map();
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
  function activate(payment, expected) {
    if (!payment || !expected || payment.orderId !== expected.id || payment.amount !== expected.amount ||
        payment.currency !== 'INR' || (expected.payment && expected.payment !== payment.id) ||
        one('SELECT id FROM orders WHERE payment=? AND id!=?', payment.id, expected.id)) return false;
    run('UPDATE orders SET payment=? WHERE id=?', payment.id, expected.id);
    return true;
  }

  api.post('/payments/webhook', express.raw({ type: 'application/json', limit: '256kb', inflate: false }), (req, res) => {
    const payment = payments.webhookPayment(req.body, req.get('X-Razorpay-Signature'));
    if (payment) {
      const order = one('SELECT * FROM orders WHERE id=?', payment.orderId);
      if (!order) fail(503, 'Order is not available yet.');
      if (!activate(payment, order)) fail(409, 'Payment does not match the order.');
    }
    res.sendStatus(204);
  });
  api.use(express.json({ limit: '1mb', inflate: false }));
  api.get('/config', (_req, res) => res.json({ firebase }));
  api.get('/courses', (_req, res) => res.json(all('SELECT * FROM courses ORDER BY rowid DESC')));
  api.get('/courses/:id/reviews', (req, res) => {
    course(req.params.id);
    res.json(all(`SELECT COALESCE(NULLIF(s.name, ''), 'Student') AS name, r.rating, r.text
      FROM reviews r JOIN students s USING (uid) WHERE r.course=? ORDER BY r.rowid DESC LIMIT 100`, req.params.id));
  });
  api.use(authLimit, login);
  api.get('/me', (req, res) => {
    const { uid, phone, admin } = req.user;
    const { name } = one('SELECT name FROM students WHERE uid=?', uid);
    res.json({ name, phone, admin, purchases: all('SELECT course FROM orders WHERE uid=? AND payment IS NOT NULL', uid).map(p => p.course) });
  });
  api.put('/me', (req, res) => {
    run('UPDATE students SET name=? WHERE uid=?', text(req.body?.name, 'Name', 100), req.user.uid);
    res.sendStatus(204);
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
  api.post('/courses/:id/order', paymentLimit, async (req, res) => {
    const { id, price } = course(req.params.id);
    const { uid } = req.user;
    if (owns(uid, id)) fail(409, 'You already own this course.');
    const existing = one('SELECT id, amount FROM orders WHERE uid=? AND course=?', uid, id);
    if (existing) {
      if (!payments.key) fail(503, 'Checkout is not configured.');
      return res.json({ ...existing, currency: 'INR', key: payments.key });
    }
    const lock = JSON.stringify([uid, id]);
    if (!pending.has(lock)) {
      const work = (async () => {
        const order = await payments.createOrder({ amount: price, receipt: randomUUID() });
        run('INSERT INTO orders (id, uid, course, amount) VALUES (?, ?, ?, ?)', order.id, uid, id, price);
        return order;
      })().finally(() => pending.delete(lock));
      pending.set(lock, work);
    }
    res.status(201).json(await pending.get(lock));
  });
  api.post('/courses/:id/verify', paymentLimit, async (req, res) => {
    const { id } = course(req.params.id);
    const body = req.body ?? {};
    const order = one('SELECT * FROM orders WHERE uid=? AND course=?', req.user.uid, id);
    if (!order || order.id !== body.razorpay_order_id || !payments.verifyCheckout(body)) fail(400, 'Invalid payment confirmation.');
    if (order.payment === body.razorpay_payment_id) return res.sendStatus(204);
    const payment = await payments.capturedPayment(body.razorpay_payment_id);
    if (!payment) fail(409, 'Payment is not captured yet. Refresh your purchases shortly.');
    if (payment.id !== body.razorpay_payment_id ||
        !activate(payment, one('SELECT * FROM orders WHERE id=?', order.id))) fail(409, 'Payment does not match the order.');
    res.sendStatus(204);
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
    res.json({ score: questions.filter((q, i) => answers[i] === q.answer).length, total: questions.length });
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

  api.use('/admin', admin);
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
