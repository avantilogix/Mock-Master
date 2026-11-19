import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import QRCode from 'qrcode';
import { fail, importQuestions, mobile, pageCount, renderPage, validateQuestions } from './documents.js';
import { paymentReference, upiDetails, upiPaymentUri } from './manual-payments.js';
import { sampleBookPdf, sampleCourses } from './sample-data.js';

initializeApp();

const db = getFirestore();
const bucket = getStorage().bucket();
const auth = getAuth();
const adminUidsParameter = defineString('ADMIN_UIDS', { default: '' });
const upiIdParameter = defineString('UPI_ID', { default: '' });
const upiPayeeNameParameter = defineString('UPI_PAYEE_NAME', { default: '' });
const firebaseProjectIdParameter = defineString('PUBLIC_PROJECT_ID', { default: '' });
const firebaseApiKeyParameter = defineString('PUBLIC_API_KEY', { default: '' });
const firebaseAuthDomainParameter = defineString('PUBLIC_AUTH_DOMAIN', { default: '' });

function parameterValue(parameter) {
  return parameter.value() || process.env[parameter.name] || '';
}

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(422, `${label} is required (maximum ${max} characters).`);
  }
  return value.trim();
}

function idFor(...parts) {
  return createHash('sha256').update(parts.join('\0')).digest('base64url');
}

function value(snapshot) {
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

function byNewest(a, b) {
  return String(b.createdAt || b.submittedAt || '').localeCompare(String(a.createdAt || a.submittedAt || ''));
}

function publicCourse(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    price: item.price,
  };
}

async function course(id) {
  const item = value(await db.collection('courses').doc(id).get());
  if (!item) fail(404, 'Course not found.');
  return item;
}

async function owned(uid, courseId) {
  const snapshot = await db.collection('orders').where('uid', '==', uid).where('course', '==', courseId).get();
  return snapshot.docs.map(value).some(item => typeof item.payment === 'string' && item.payment.length > 0);
}

async function requirePurchase(user, courseId, allowAdmin = true) {
  if (!(allowAdmin && user.admin) && !await owned(user.uid, courseId)) {
    fail(403, 'Purchase this course to unlock it.');
  }
}

async function queryCollection(name) {
  return (await db.collection(name).get()).docs.map(value);
}

async function createWithId(collection, data) {
  const id = randomUUID();
  await db.collection(collection).doc(id).create({ ...data, createdAt: new Date().toISOString() });
  return id;
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    });
    next();
  });

  const api = express.Router();
  app.use('/api', api);
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '1mb', inflate: false }));
  const raw = express.raw({ type: 'application/octet-stream', limit: '12mb', inflate: false });
  const limit = max => rateLimit({
    windowMs: 60_000,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Wait a minute and try again.' },
  });
  const authLimit = limit(120);
  const paymentLimit = limit(20);
  let documentJobs = 0;
  async function processDocument(operation) {
    if (documentJobs >= 4) fail(503, 'Document processing is busy. Please retry.');
    documentJobs++;
    try {
      return await operation();
    } finally {
      documentJobs--;
    }
  }

  const login = async (req, _res, next) => {
    const [scheme, token, extra] = (req.get('Authorization') || '').split(' ');
    if (scheme.toLowerCase() !== 'bearer' || !token || extra !== undefined) {
      fail(401, 'Sign in with your mobile number.');
    }
    let decoded;
    try {
      decoded = await auth.verifyIdToken(token);
    } catch (error) {
      fail(401, 'Your sign-in expired or could not be verified.');
    }
    const user = { uid: decoded.uid, phone: decoded.phone_number, provider: decoded.firebase?.sign_in_provider };
    if (typeof user.uid !== 'string' || !user.uid || user.uid.length > 128 ||
        typeof user.phone !== 'string' || !mobile.test(user.phone) || user.provider !== 'phone') {
      fail(403, 'Use a verified Indian mobile number.');
    }
    await db.collection('students').doc(user.uid).set({ phone: user.phone }, { merge: true });
    const admins = new Set(parameterValue(adminUidsParameter).split(',').map(uid => uid.trim()).filter(Boolean));
    req.user = { uid: user.uid, phone: user.phone, admin: admins.has(user.uid) };
    next();
  };
  const admin = (req, _res, next) => {
    if (!req.user.admin) fail(403, 'Admin access required.');
    next();
  };
  const paymentDetails = () => upiDetails({
    upiId: parameterValue(upiIdParameter),
    payeeName: parameterValue(upiPayeeNameParameter),
  });

  api.get('/config', (_req, res) => res.json({
    firebase: {
      projectId: parameterValue(firebaseProjectIdParameter),
      apiKey: parameterValue(firebaseApiKeyParameter),
      authDomain: parameterValue(firebaseAuthDomainParameter),
    },
    payment: paymentDetails(),
  }));
  api.get('/courses', async (_req, res) => {
    res.json((await queryCollection('courses')).sort(byNewest).map(publicCourse));
  });
  api.get('/courses/:id/payment-qr', async (req, res) => {
    const row = await course(req.params.id);
    const uri = upiPaymentUri(paymentDetails(), row.price, `Mission Selection ${row.title}`);
    if (!uri) fail(503, 'UPI payment details are not configured.');
    res.type('svg').send(await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  });
  api.get('/courses/:id/reviews', async (req, res) => {
    await course(req.params.id);
    const reviews = (await db.collection('reviews').where('course', '==', req.params.id).get()).docs.map(value);
    const output = await Promise.all(reviews.sort(byNewest).slice(0, 100).map(async review => {
      const student = value(await db.collection('students').doc(review.uid).get());
      return { name: student?.name || 'Student', rating: review.rating, text: review.text };
    }));
    res.json(output);
  });

  api.use(authLimit, login);
  api.get('/me', async (req, res) => {
    const { uid, phone, admin: isAdmin } = req.user;
    const student = value(await db.collection('students').doc(uid).get());
    const orders = (await db.collection('orders').where('uid', '==', uid).get()).docs.map(value);
    res.json({
      uid,
      name: student?.name || '',
      phone,
      admin: isAdmin,
      purchases: orders.filter(order => typeof order.payment === 'string' && order.payment.length > 0).map(order => order.course),
    });
  });
  api.put('/me', async (req, res) => {
    await db.collection('students').doc(req.user.uid).set({
      name: text(req.body?.name, 'Name', 100),
    }, { merge: true });
    res.sendStatus(204);
  });
  api.get('/courses/:id', async (req, res) => {
    const { id } = await course(req.params.id);
    await requirePurchase(req.user, id);
    const tests = (await db.collection('tests').where('course', '==', id).get()).docs.map(value).sort(byNewest).reverse()
      .map(item => ({ id: item.id, title: item.title }));
    const books = (await db.collection('books').where('course', '==', id).get()).docs.map(value).sort(byNewest).reverse()
      .map(item => ({ id: item.id, title: item.title, pages: item.pages }));
    const messages = (await db.collection('messages').where('course', '==', id).get()).docs.map(value).sort(byNewest).slice(0, 100);
    const namedMessages = await Promise.all(messages.map(async message => {
      const student = value(await db.collection('students').doc(message.uid).get());
      return { name: student?.name || 'Student', text: message.text };
    }));
    res.json({ tests, books, messages: namedMessages.reverse() });
  });
  api.post('/courses/:id/messages', async (req, res) => {
    const { id } = await course(req.params.id);
    await requirePurchase(req.user, id);
    const messageId = randomUUID();
    await db.runTransaction(transaction => transaction.create(db.collection('messages').doc(messageId), {
      course: id,
      uid: req.user.uid,
      text: text(req.body?.text, 'Message', 1000),
      createdAt: new Date().toISOString(),
    }));
    res.sendStatus(204);
  });
  api.put('/courses/:id/reviews', async (req, res) => {
    const { id } = await course(req.params.id);
    await requirePurchase(req.user, id, false);
    const rating = req.body?.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(422, 'Choose a rating from 1 to 5.');
    const reviewRef = db.collection('reviews').doc(idFor(id, req.user.uid));
    const data = {
      course: id,
      uid: req.user.uid,
      rating,
      text: text(req.body?.text, 'Review', 1000),
      createdAt: new Date().toISOString(),
    };
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reviewRef);
      transaction[snapshot.exists ? 'set' : 'create'](reviewRef, data);
    });
    res.sendStatus(204);
  });
  api.post('/support', async (req, res) => {
    const id = randomUUID();
    await db.runTransaction(transaction => transaction.create(db.collection('tickets').doc(id), {
      uid: req.user.uid,
      text: text(req.body?.text, 'Support request', 2000),
      createdAt: new Date().toISOString(),
    }));
    res.sendStatus(204);
  });
  api.get('/courses/:id/payment', async (req, res) => {
    const { id, price } = await course(req.params.id);
    const snapshot = await db.collection('orders').where('uid', '==', req.user.uid).where('course', '==', id).limit(1).get();
    const item = snapshot.docs.map(value)[0];
    res.json({
      amount: price,
      payment: { ...paymentDetails(), qr: `/api/courses/${id}/payment-qr` },
      order: item ? {
        id: item.id,
        amount: item.amount,
        status: item.paymentStatus,
        reference: item.transactionRef,
        note: item.paymentNote,
        reviewNote: item.reviewNote,
        submittedAt: item.submittedAt,
      } : null,
    });
  });
  api.post('/courses/:id/payment', paymentLimit, async (req, res) => {
    const { id, price } = await course(req.params.id);
    const { uid } = req.user;
    const details = paymentDetails();
    if (!details.configured) fail(503, 'UPI payment details are not configured.');
    const reference = paymentReference(req.body?.reference);
    if (!reference) fail(422, 'Enter a valid UPI transaction reference (4–80 characters).');
    if (typeof req.body?.note !== 'undefined' && (typeof req.body.note !== 'string' || req.body.note.length > 500)) {
      fail(422, 'Payment note must be 500 characters or fewer.');
    }
    const note = (req.body?.note || '').trim();
    const submittedAt = new Date().toISOString();
    const orderId = idFor(uid, id);
    const orderRef = db.collection('orders').doc(orderId);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      const existing = value(snapshot);
      if (existing && typeof existing.payment === 'string' && existing.payment.length > 0) {
        fail(409, 'You already own this course.');
      }
      if (existing?.paymentStatus === 'pending') {
        throw Object.assign(new Error('A payment request is already waiting for admin review.'), { status: 409 });
      }
      transaction.set(orderRef, {
        uid,
        course: id,
        amount: price,
        payment: '',
        paymentStatus: 'pending',
        transactionRef: reference,
        paymentNote: note,
        reviewNote: '',
        submittedAt,
        reviewedAt: '',
        reviewedBy: '',
        createdAt: existing?.createdAt || submittedAt,
      });
    });
    res.status(201).json({ id: orderId, amount: price, status: 'pending', reference, submittedAt });
  });

  async function test(id) {
    const item = value(await db.collection('tests').doc(id).get());
    if (!item) fail(404, 'Test not found.');
    return item;
  }
  api.get('/tests/:id', async (req, res) => {
    const item = await test(req.params.id);
    await requirePurchase(req.user, item.course);
    res.json({ title: item.title, questions: item.questions.map(({ prompt, options }) => ({ prompt, options })) });
  });
  api.post('/tests/:id/submit', async (req, res) => {
    const item = await test(req.params.id);
    await requirePurchase(req.user, item.course);
    const { answers } = req.body ?? {};
    const questions = item.questions;
    if (!Array.isArray(answers) || answers.length !== questions.length ||
        answers.some((answer, index) => answer !== null &&
          (!Number.isInteger(answer) || answer < 0 || answer >= questions[index].options.length))) {
      fail(422, 'Provide one valid answer or null per question.');
    }
    res.json({ score: questions.filter((question, index) => answers[index] === question.answer).length, total: questions.length });
  });
  api.get('/books/:id/pages/:page', async (req, res) => {
    const book = value(await db.collection('books').doc(req.params.id).get());
    if (!book) fail(404, 'Book not found.');
    await requirePurchase(req.user, book.course);
    const page = Number(req.params.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > book.pages) fail(404, 'Page not found.');
    const [pdf] = await bucket.file(`books/${book.id}.pdf`).download();
    const png = await processDocument(() => renderPage(pdf, page, req.user.phone));
    res.type('png').send(png);
  });

  api.use('/admin', admin);
  api.post('/admin/seed-samples', async (_req, res) => {
    await Promise.all(sampleCourses.map(async sample => {
      const createdAt = new Date().toISOString();
      const bookId = `${sample.id}-book-01`;
      const testId = `${sample.id}-test-01`;
      await Promise.all([
        db.collection('courses').doc(sample.id).set({
          title: sample.title, description: sample.description, price: sample.price, createdAt,
        }, { merge: true }),
        db.collection('tests').doc(testId).set({
          course: sample.id, title: sample.test, questions: sample.questions, createdAt,
        }, { merge: true }),
        db.collection('books').doc(bookId).set({
          course: sample.id, title: sample.book, pages: 1, createdAt,
        }, { merge: true }),
        bucket.file(`books/${bookId}.pdf`).save(await sampleBookPdf(sample.book), {
          resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'private, no-store' },
        }),
      ]);
    }));
    res.json({ courses: sampleCourses.length });
  });
  api.post('/admin/courses', async (req, res) => {
    const { title, description, price } = req.body ?? {};
    if (!Number.isInteger(price) || price < 100 || price > 10_000_000) {
      fail(422, 'Price must be ₹1–₹100,000, in whole paise.');
    }
    const id = await createWithId('courses', {
      title: text(title, 'Title', 120),
      description: text(description, 'Description', 2000),
      price,
    });
    res.status(201).json({ id });
  });
  api.post('/admin/courses/:id/tests', async (req, res) => {
    const { id: courseId } = await course(req.params.id);
    const { title, questions } = req.body ?? {};
    const id = await createWithId('tests', {
      course: courseId,
      title: text(title, 'Title', 120),
      questions: validateQuestions(questions),
    });
    res.status(201).json({ id });
  });
  api.post('/admin/import', raw, async (req, res) => {
    res.json({ questions: await processDocument(() => importQuestions(req.body, req.query.format)) });
  });
  api.post('/admin/courses/:id/books', raw, async (req, res) => {
    const { id: courseId } = await course(req.params.id);
    const id = randomUUID();
    const title = text(req.query.title, 'Title', 120);
    if (!Buffer.isBuffer(req.body)) fail(400, 'Upload a PDF.');
    const pages = await processDocument(() => pageCount(req.body));
    const file = bucket.file(`books/${id}.pdf`);
    await file.save(req.body, { resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'private, no-store' } });
    try {
      await db.collection('books').doc(id).create({ course: courseId, title, pages, createdAt: new Date().toISOString() });
    } catch (error) {
      await file.delete({ ignoreNotFound: true });
      throw error;
    }
    res.status(201).json({ id, pages });
  });
  api.get('/admin/payments', async (_req, res) => {
    const orders = (await queryCollection('orders')).sort((a, b) => {
      const pending = Number(a.paymentStatus !== 'pending') - Number(b.paymentStatus !== 'pending');
      return pending || String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));
    }).slice(0, 200);
    res.json(await Promise.all(orders.map(async order => {
      const [student, selectedCourse] = await Promise.all([
        db.collection('students').doc(order.uid).get(),
        db.collection('courses').doc(order.course).get(),
      ]);
      return {
        id: order.id,
        amount: order.amount,
        reference: order.transactionRef,
        note: order.paymentNote,
        status: order.paymentStatus,
        submittedAt: order.submittedAt,
        reviewNote: order.reviewNote,
        name: value(student)?.name || 'Student',
        phone: value(student)?.phone,
        course: value(selectedCourse)?.title,
      };
    })));
  });
  api.post('/admin/payments/:id/approve', async (req, res) => {
    const orderRef = db.collection('orders').doc(req.params.id);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      const order = value(snapshot);
      if (!order) fail(404, 'Payment request not found.');
      if (order.paymentStatus === 'approved') return;
      if (order.paymentStatus !== 'pending') fail(409, 'Only pending requests can be approved.');
      transaction.update(orderRef, {
        payment: `manual:${order.id}`,
        paymentStatus: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewedBy: req.user.uid,
        reviewNote: '',
      });
    });
    res.sendStatus(204);
  });
  api.post('/admin/payments/:id/reject', async (req, res) => {
    const orderRef = db.collection('orders').doc(req.params.id);
    const reviewNote = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!reviewNote || reviewNote.length > 500) fail(422, 'Enter a rejection reason (maximum 500 characters).');
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      const order = value(snapshot);
      if (!order) fail(404, 'Payment request not found.');
      if (order.paymentStatus !== 'pending') fail(409, 'Only pending requests can be rejected.');
      transaction.update(orderRef, {
        payment: '',
        paymentStatus: 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewedBy: req.user.uid,
        reviewNote,
      });
    });
    res.sendStatus(204);
  });
  api.get('/admin/support', async (_req, res) => {
    const tickets = (await queryCollection('tickets')).sort(byNewest).slice(0, 100);
    res.json(await Promise.all(tickets.map(async ticket => ({
      phone: value(await db.collection('students').doc(ticket.uid).get())?.phone,
      text: ticket.text,
    }))));
  });
  api.use((_req, res) => res.status(404).json({ error: 'API route not found.' }));
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

export const api = onRequest({
  region: 'asia-south1',
  memory: '1GiB',
  timeoutSeconds: 300,
}, createApp());
