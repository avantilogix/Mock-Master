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
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fail, importQuestions, mobile, pageCount, renderPage, validateQuestions } from './documents.js';
import { paymentReference, upiDetails, upiPaymentUri } from './manual-payments.js';
import { sampleBookPdf, sampleCourses, sampleResources } from './sample-data.js';
import { registerVideoRoutes } from './chapter-videos.js';
import { registerPublishedRoutes } from './published.js';
import { courseCutoff, expiryInput, publishingMedia, requireActive } from './publishing-media.js';

initializeApp();

const db = getFirestore();
const bucket = getStorage().bucket();
const auth = getAuth();
const adminUidsParameter = defineString('ADMIN_UIDS', { default: '' });
const adminPhonesParameter = defineString('ADMIN_PHONES', { default: '' });
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

function istIso(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    fail(422, `${label} must be a valid date and time in IST.`);
  }

  const date = new Date(`${value}${value.length === 16 ? ':00' : ''}+05:30`);
  if (Number.isNaN(date.getTime())) fail(422, `${label} must be a valid date and time in IST.`);
  return date.toISOString();
}

const examChoices = new Set(['CCE', 'TET 1', 'TET 2', 'TAT S - HS', 'PSI - Constable',
  'Panchayat Talati - Clerk', 'Technical Exams', 'GPSC STI - Dyso', 'Other Exams']);
function examPreferences(value) {
  if (!Array.isArray(value)) fail(422, 'Choose one or more target exams.');
  const selected = [...new Set(value.filter(item => typeof item === 'string' && examChoices.has(item)))];
  if (!selected.length || selected.length !== value.length) fail(422, 'Choose valid target exams.');
  return selected;
}

async function protectedPdf(source, pages, phone) {
  const output = await PDFDocument.create();
  for (let page = 1; page <= pages; page++) {
    const image = await output.embedPng(await renderPage(source, page, phone));
    const target = output.addPage([595, 842]);
    const scale = Math.min(595 / image.width, 842 / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    target.drawImage(image, { x: (595 - width) / 2, y: (842 - height) / 2, width, height });
  }
  return Buffer.from(await output.save());
}

async function questionPaperPdf(test, phone) {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595, 842]);
    let y = 792;
    const wrap = (value, font, size, maxWidth) => {
      const lines = [];
      let current = '';
      for (const word of String(value || '').split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (current && font.widthOfTextAtSize(next, size) > maxWidth) {
          lines.push(current); current = word;
        } else current = next;
      }

      async function resultDocument({student, attempt, course, test, rank}) {
        const pdf = await PDFDocument.create();
        const regular = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const page = pdf.addPage([595, 842]);
        const blue = rgb(.05, .34, .72), muted = rgb(.35, .42, .52), light = rgb(.94, .97, 1);
        page.drawRectangle({x: 0, y: 770, width: 595, height: 72, color: blue});
        page.drawText('MISSION SELECTION', {x: 38, y: 810, size: 17, font: bold, color: rgb(1,1,1)});
        page.drawText('TEST PERFORMANCE REPORT', {x: 38, y: 786, size: 10, font: bold, color: rgb(.82,.92,1)});
        page.drawText(test.title, {x: 38, y: 738, size: 20, font: bold});
        page.drawText(`${student.name || 'Student'}  •  ${student.phone}`, {x: 38, y: 714, size: 10, font: regular, color: muted});
        const cards = [['SCORE', `${attempt.score}/${attempt.maxMarks || 0}`], ['RANK', rank ? `#${rank}` : '—'],
          ['ACCURACY', `${Math.round((attempt.correct / Math.max(attempt.total, 1)) * 100)}%`]];
        cards.forEach(([label, value], index) => {
          const x = 38 + index * 177;
          page.drawRectangle({x, y: 630, width: 160, height: 58, color: light, borderColor: rgb(.78,.86,.95), borderWidth: 1});
          page.drawText(label, {x: x+14, y: 667, size: 8, font: bold, color: muted});
          page.drawText(value, {x: x+14, y: 642, size: 20, font: bold, color: blue});
        });
        page.drawText('PERFORMANCE SUMMARY', {x: 38, y: 592, size: 11, font: bold, color: blue});
        [['Correct', attempt.correct], ['Incorrect', attempt.wrong], ['Unattempted', attempt.unanswered]].forEach(([label, value], index) => {
          const x = 65 + index * 165;
          page.drawText(String(value), {x, y: 536, size: 19, font: bold, color: blue});
          page.drawText(label, {x, y: 516, size: 9, font: regular, color: muted});
        });
        page.drawText('SECTION BREAKDOWN', {x: 38, y: 462, size: 11, font: bold, color: blue});
        page.drawRectangle({x: 38, y: 426, width: 519, height: 24, color: blue});
        [['Section',52],['Correct',278],['Wrong',365],['Unattempted',438]].forEach(([text,x]) =>
          page.drawText(text,{x,y:434,size:8,font:bold,color:rgb(1,1,1)}));
        let y = 401;
        for (const section of attempt.sectionScores || []) {
          if (y < 65) break;
          page.drawText(String(section.section), {x:52,y,size:9,font:regular});
          page.drawText(String(section.correct), {x:292,y,size:9,font:regular});
          page.drawText(String(section.wrong), {x:380,y,size:9,font:regular});
          page.drawText(String(section.unanswered), {x:465,y,size:9,font:regular});
          y -= 26;
        }
        page.drawText(`Course: ${course.title}  •  Submitted: ${new Date(attempt.createdAt).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})} IST`,
          {x:38,y:32,size:8,font:regular,color:muted});
        return Buffer.from(await pdf.save());
      }

      async function receiptDocument({student, order, course}) {
        const pdf = await PDFDocument.create();
        const regular = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const page = pdf.addPage([595,842]);
        const blue = rgb(.05,.34,.72), muted = rgb(.38,.45,.54);
        page.drawText('MISSION SELECTION',{x:38,y:794,size:17,font:bold,color:blue});
        page.drawText('Choose • Prepare • Achieve',{x:38,y:775,size:8,font:regular,color:muted});
        page.drawText('PAYMENT RECEIPT',{x:382,y:785,size:20,font:regular});
        page.drawText(`Receipt No.  MS-${order.id.slice(0,8).toUpperCase()}`,{x:38,y:735,size:10,font:bold});
        page.drawText(`Date  ${new Date(order.reviewedAt || order.submittedAt).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'})}`,{x:405,y:735,size:9,font:regular,color:muted});
        page.drawText('BILLED TO',{x:38,y:690,size:8,font:bold,color:muted});
        page.drawText(student.name || 'Student',{x:38,y:668,size:12,font:bold});
        page.drawText(student.phone,{x:38,y:648,size:10,font:regular,color:muted});
        page.drawRectangle({x:38,y:500,width:519,height:104,color:rgb(.96,.98,1),borderColor:rgb(.78,.86,.95),borderWidth:1});
        page.drawText('PARTICULARS',{x:55,y:580,size:8,font:bold,color:muted});
        page.drawText('AMOUNT',{x:488,y:580,size:8,font:bold,color:muted});
        page.drawText(course.title,{x:55,y:545,size:12,font:bold});
        page.drawText(`INR ${(order.amount/100).toFixed(2)}`,{x:470,y:545,size:12,font:bold,color:blue});
        page.drawText('Total Paid',{x:410,y:507,size:10,font:bold});
        page.drawText(`INR ${(order.amount/100).toFixed(2)}`,{x:470,y:507,size:12,font:bold,color:blue});
        page.drawText('PAYMENT DETAILS',{x:38,y:450,size:9,font:bold,color:muted});
        page.drawText('Method  UPI / Manual Approval',{x:38,y:425,size:10,font:regular});
        page.drawText(`Transaction  ${order.transactionRef || '—'}`,{x:38,y:402,size:10,font:regular});
        page.drawText('Status  APPROVED',{x:38,y:379,size:10,font:bold,color:rgb(.05,.45,.28)});
        page.drawRectangle({x:0,y:0,width:595,height:48,color:blue});
        page.drawText('Mission Selection • Secure course access • https://mission-selection-ba819.web.app',{x:38,y:19,size:8,font:regular,color:rgb(1,1,1)});
        return Buffer.from(await pdf.save());
      }
      if (current) lines.push(current);
      return lines;
    };
    const ensure = amount => { if (y - amount < 55) { page = pdf.addPage([595, 842]); y = 792; } };
    page.drawText('MISSION SELECTION', {x: 42, y, size: 11, font: bold}); y -= 28;
    for (const line of wrap(test.title, bold, 19, 511)) {
      page.drawText(line, {x: 42, y, size: 19, font: bold}); y -= 24;
    }
    page.drawText(`Duration: ${test.durationMinutes || 90} minutes   Marks: ${test.marksPerQuestion || 1}`,
      {x: 42, y, size: 10, font: regular}); y -= 18;
    page.drawText(`Negative marking: ${test.negativeMark || 0}   Candidate: ${phone}`,
      {x: 42, y, size: 10, font: regular}); y -= 28;
    test.questions.forEach((question, index) => {
      ensure(55);
      page.drawText(`Q${index + 1}. [${question.section || 'General'}]`, {x: 42, y, size: 10, font: bold}); y -= 17;
      for (const line of wrap(question.prompt, regular, 11, 501)) {
        ensure(18); page.drawText(line, {x: 52, y, size: 11, font: regular}); y -= 16;
      }
      question.options.forEach((option, optionIndex) => {
        for (const line of wrap(`${String.fromCharCode(65 + optionIndex)}. ${option}`, regular, 10, 485)) {
          ensure(15); page.drawText(line, {x: 66, y, size: 10, font: regular}); y -= 14;
        }
      });
      y -= 9;
    });
    for (const current of pdf.getPages()) {
      current.drawText(`Licensed to ${phone}`, {x: 210, y: 28, size: 9, font: regular, opacity: .55});
      current.drawText('Mission Selection - Protected Question Paper', {x: 42, y: 812, size: 8, font: regular, opacity: .25});
    }
    return Buffer.from(await pdf.save());
}

async function buildResultPdf({student, attempt, course, test, rank}) {
  const pdf = await PDFDocument.create(), regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595,842]), blue = rgb(.05,.34,.72), muted = rgb(.35,.42,.52);
  page.drawRectangle({x:0,y:770,width:595,height:72,color:blue});
  page.drawText('MISSION SELECTION',{x:38,y:810,size:17,font:bold,color:rgb(1,1,1)});
  page.drawText('TEST PERFORMANCE REPORT',{x:38,y:786,size:10,font:bold,color:rgb(.82,.92,1)});
  page.drawText(test.title,{x:38,y:738,size:20,font:bold});
  page.drawText(`${student.name||'Student'}  •  ${student.phone}`,{x:38,y:714,size:10,font:regular,color:muted});
  const cards=[['SCORE',`${attempt.score}/${attempt.maxMarks||0}`],['RANK',rank?`#${rank}`:'—'],['ACCURACY',`${Math.round(attempt.correct/Math.max(attempt.total,1)*100)}%`]];
  cards.forEach(([label,value],index)=>{const x=38+index*177;page.drawRectangle({x,y:630,width:160,height:58,color:rgb(.94,.97,1),borderColor:rgb(.78,.86,.95),borderWidth:1});page.drawText(label,{x:x+14,y:667,size:8,font:bold,color:muted});page.drawText(value,{x:x+14,y:642,size:20,font:bold,color:blue});});
  page.drawText('PERFORMANCE SUMMARY',{x:38,y:592,size:11,font:bold,color:blue});
  [['Correct',attempt.correct],['Incorrect',attempt.wrong],['Unattempted',attempt.unanswered]].forEach(([label,value],index)=>{const x=65+index*165;page.drawText(String(value),{x,y:536,size:19,font:bold,color:blue});page.drawText(label,{x,y:516,size:9,font:regular,color:muted});});
  page.drawText('SECTION BREAKDOWN',{x:38,y:462,size:11,font:bold,color:blue});
  let y=420; for(const section of attempt.sectionScores||[]){if(y<65)break;page.drawText(`${section.section}   ${section.correct} correct   ${section.wrong} wrong   ${section.unanswered} unattempted`,{x:45,y,size:9,font:regular});y-=26;}
  page.drawText(`Course: ${course.title}  •  ${new Date(attempt.createdAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST`,{x:38,y:32,size:8,font:regular,color:muted});
  return Buffer.from(await pdf.save());
}

async function buildReceiptPdf({student,order,course}) {
  const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const page=pdf.addPage([595,842]),blue=rgb(.05,.34,.72),muted=rgb(.38,.45,.54);
  page.drawText('MISSION SELECTION',{x:38,y:794,size:17,font:bold,color:blue});
  page.drawText('PAYMENT RECEIPT',{x:382,y:785,size:20,font:regular});
  page.drawText(`Receipt No.  MS-${order.id.slice(0,8).toUpperCase()}`,{x:38,y:735,size:10,font:bold});
  page.drawText(`Date  ${new Date(order.reviewedAt||order.submittedAt).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'})}`,{x:405,y:735,size:9,font:regular,color:muted});
  page.drawText('BILLED TO',{x:38,y:690,size:8,font:bold,color:muted});
  page.drawText(student.name||'Student',{x:38,y:668,size:12,font:bold});
  page.drawText(student.phone,{x:38,y:648,size:10,font:regular,color:muted});
  page.drawRectangle({x:38,y:500,width:519,height:104,color:rgb(.96,.98,1),borderColor:rgb(.78,.86,.95),borderWidth:1});
  page.drawText(course.title,{x:55,y:545,size:12,font:bold});
  page.drawText(`INR ${(order.amount/100).toFixed(2)}`,{x:470,y:545,size:12,font:bold,color:blue});
  page.drawText('Method  UPI / Manual Approval',{x:38,y:425,size:10,font:regular});
  page.drawText(`Transaction  ${order.transactionRef||'—'}`,{x:38,y:402,size:10,font:regular});
  page.drawText('Status  APPROVED',{x:38,y:379,size:10,font:bold,color:rgb(.05,.45,.28)});
  page.drawRectangle({x:0,y:0,width:595,height:48,color:blue});
  return Buffer.from(await pdf.save());
}

function idFor(...parts) {
  return createHash('sha256').update(parts.join('\0')).digest('base64url');
}

function referralCodeFor(uid) {
  return `MS${createHash('sha256').update(uid).digest('hex').slice(0, 6).toUpperCase()}`;
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
    downloadsEnabled: Boolean(item.downloadsEnabled),
    images: item.images || [],
    expiresOn: item.expiresOn || '',
    expired: (courseCutoff(item.expiresOn) ?? Infinity) <= Date.now(),
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
  const item = await course(courseId);
  if (allowAdmin && user.admin) return null;
  const cutoff = requireActive(item);
  if (!await owned(user.uid, courseId)) fail(403, 'Purchase this course to unlock it.');
  return cutoff;
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
    const student = value(await db.collection('students').doc(user.uid).get());
    if (student?.disabled) {
      fail(403, 'This account is disabled. Contact support to request reactivation.');
    }
    const admins = new Set(parameterValue(adminUidsParameter).split(',').map(uid => uid.trim()).filter(Boolean));
    const adminPhones = new Set(parameterValue(adminPhonesParameter).split(',')
      .map(phone => phone.trim()).filter(Boolean));
    req.user = { uid: user.uid, phone: user.phone, admin: admins.has(user.uid) || adminPhones.has(user.phone) };
    next();
  };
  const admin = (req, _res, next) => {
    if (!req.user.admin) fail(403, 'Admin access required.');
    next();
  };
  const paymentDetails = async () => {
    const setting = value(await db.collection('settings').doc('payment').get());
    const details = upiDetails({
      upiId: setting?.upiId ?? parameterValue(upiIdParameter),
      payeeName: setting?.payeeName ?? parameterValue(upiPayeeNameParameter),
    });
    const method = ['upi', 'qr', 'both'].includes(setting?.method) ? setting.method : 'upi';
    return {
      ...details, method, customQr: Boolean(setting?.customQr),
      configured: (method !== 'qr' && details.configured) || (method !== 'upi' && Boolean(setting?.customQr)),
    };
  };

  api.get('/config', async (_req, res) => {
    const social = value(await db.collection('settings').doc('social').get());
    const { id: _id, ...socialConfig } = social || {};
    res.json({
      firebase: {
        projectId: parameterValue(firebaseProjectIdParameter),
        apiKey: parameterValue(firebaseApiKeyParameter),
        authDomain: parameterValue(firebaseAuthDomainParameter),
      },
      payment: await paymentDetails(),
      social: socialConfig,
      publishingMedia: true,
    });
  });
  api.get('/social', async (_req, res) => {
    const social = value(await db.collection('settings').doc('social').get());
    res.json(Object.fromEntries(['youtube', 'instagram', 'telegram'].map(key => [key, social?.[key] || ''])));
  });
  api.get('/courses', async (_req, res) => {
    res.json((await queryCollection('courses')).sort(byNewest).map(publicCourse));
  });
  api.get('/ebooks', async (_req, res) => {
    res.json((await queryCollection('ebooks')).sort(byNewest).map(book =>
      ({ id: book.id, title: book.title, description: book.description, price: book.price,
        pages: book.pages, createdAt: book.createdAt })));
  });
  api.get('/courses/:id/payment-qr', async (req, res) => {
    const row = await course(req.params.id);
    requireActive(row);
    const payment = await paymentDetails();
    const setting = value(await db.collection('settings').doc('payment').get());
    if (setting?.customQr && payment.method !== 'upi') {
      const [qr] = await bucket.file('payment-config/qr').download();
      res.type(setting.qrType || 'png').send(qr);
      return;
    }
    const uri = upiPaymentUri(payment, row.price, `Mission Selection ${row.title}`);
    if (!uri) fail(503, 'UPI payment details are not configured.');
    res.type('svg').send(await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  });
  api.get('/payment-qr', async (_req, res) => {
    const payment = await paymentDetails();
    const setting = value(await db.collection('settings').doc('payment').get());
    if (setting?.customQr && payment.method !== 'upi') {
      const [qr] = await bucket.file('payment-config/qr').download();
      res.type(setting.qrType || 'png').send(qr);
      return;
    }
    const uri = upiPaymentUri(payment, 100, 'Mission Selection payment');
    if (!uri) fail(503, 'Payment details are not configured.');
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
  api.get('/timetable', async (_req, res) => {
    const schedules = (await queryCollection('schedules')).sort((a, b) =>
      String(a.day || '').localeCompare(String(b.day || '')) ||
      String(a.startsAt || a.starts_at || '').localeCompare(String(b.startsAt || b.starts_at || '')));
    res.json(schedules);
  });
  api.get('/physical-books', async (_req, res) => {
    const books = (await db.collection('physicalBooks').where('active', '==', true).get()).docs.map(value).sort(byNewest);
    res.json(books.map(book => ({ id: book.id, title: book.title, description: book.description, price: book.price,
      stock: book.stock, images: book.images || [] })));
  });
  api.get('/videos', async (_req, res) => {
    res.json(await Promise.all((await queryCollection('videos')).sort(byNewest).map(async video => ({
      id: video.id,
      title: video.title,
      description: video.description,
      videoId: video.videoId,
      courseTitle: video.course ? value(await db.collection('courses').doc(video.course).get())?.title : '',
      createdAt: video.createdAt,
    }))));
  });

  const media = publishingMedia(api, { bucket, processDocument });
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
      examPreference: student?.examPreference || '',
      examPreferences: student?.examPreferences || (student?.examPreference ?
        student.examPreference.split(',').map(item => item.trim()).filter(Boolean) : []),
      purchases: orders.filter(order => typeof order.payment === 'string' && order.payment.length > 0).map(order => order.course),
    });
  });
  api.put('/me', async (req, res) => {
    const ref = db.collection('students').doc(req.user.uid);
    const student = value(await ref.get()) || {};
    const updates = {
      name: req.body?.name === undefined ? student.name || '' : text(req.body.name, 'Name', 100),
      examPreferences: req.body?.examPreferences === undefined ? examPreferences(
        student.examPreferences || (student.examPreference ? student.examPreference.split(',') : [])) :
        examPreferences(req.body.examPreferences),
    };
    updates.examPreference = updates.examPreferences.join(',');
    await ref.set(updates, { merge: true });
    res.json(updates);
  });
  api.post('/me/disable', async (req, res) => {
    await db.collection('students').doc(req.user.uid).set({ disabled: true }, { merge: true });
    res.sendStatus(204);
  });
  api.get('/referral', async (req, res) => {
    const referralRef = db.collection('referrals').doc(req.user.uid);
    const referral = await db.runTransaction(async transaction => {
      const existing = value(await transaction.get(referralRef));
      if (existing) return existing;
      const code = referralCodeFor(req.user.uid);
      const duplicate = (await transaction.get(
        db.collection('referrals').where('code', '==', code).limit(1),
      )).docs.map(value)[0];
      if (duplicate) fail(409, 'Unable to generate a unique referral code. Contact support.');
      const created = { uid: req.user.uid, code, referredBy: '', credits: 0 };
      transaction.create(referralRef, created);
      return { id: req.user.uid, ...created };
    });
    res.json({
      code: referral.code,
      referred_by: referral.referredBy || referral.referred_by || '',
      credits: referral.credits || 0,
    });
  });
  api.post('/referral/apply', async (req, res) => {
    const referralRef = db.collection('referrals').doc(req.user.uid);
    const ownCode = referralCodeFor(req.user.uid);
    await db.runTransaction(async transaction => {
      const mine = value(await transaction.get(referralRef));
      if (mine?.referredBy || mine?.referred_by) {
        fail(409, 'A referral code is already linked to your account.');
      }
      const code = text(req.body?.code, 'Referral code', 20).toUpperCase();
      const matching = (await transaction.get(
        db.collection('referrals').where('code', '==', code),
      )).docs.map(value);
      const referrer = matching.find(item => item.uid !== req.user.uid);
      if (!referrer) fail(422, 'Enter a valid referral code from another student.');
      if (!mine) {
        const duplicateOwnCode = (await transaction.get(
          db.collection('referrals').where('code', '==', ownCode).limit(1),
        )).docs.map(value)[0];
        if (duplicateOwnCode) fail(409, 'Unable to generate a unique referral code. Contact support.');
      }
      transaction.set(referralRef, {
        uid: req.user.uid,
        code: mine?.code || ownCode,
        referredBy: referrer.uid,
        credits: mine?.credits || 0,
      }, { merge: true });
      transaction.set(db.collection('referrals').doc(referrer.uid), {
        credits: (referrer.credits || 0) + 100,
      }, { merge: true });
    });
    res.sendStatus(204);
  });
  api.get('/physical-orders', async (req, res) => {
    const orders = (await db.collection('physicalOrders').where('uid', '==', req.user.uid).get()).docs
      .map(value).sort(byNewest);
    res.json(await Promise.all(orders.map(async order => ({
      id: order.id,
      title: value(await db.collection('physicalBooks').doc(order.book).get())?.title,
      quantity: order.quantity,
      amount: order.amount,
      status: order.status,
      reviewNote: order.reviewNote || '',
      tracking: order.tracking || '',
      createdAt: order.createdAt,
    }))));
  });
  api.post('/physical-orders', async (req, res) => {
    const { bookId } = req.body ?? {};
    const bookRef = typeof bookId === 'string' && bookId
      ? db.collection('physicalBooks').doc(bookId)
      : null;
    const quantity = req.body?.quantity;
    const id = randomUUID();
    const orderRef = db.collection('physicalOrders').doc(id);
    const createdAt = new Date().toISOString();
    const amount = await db.runTransaction(async transaction => {
      const book = bookRef ? value(await transaction.get(bookRef)) : null;
      if (!book || book.active !== true || book.stock < 1) {
        fail(404, 'This physical book is not available.');
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > book.stock || quantity > 5) {
        fail(422, 'Choose a valid quantity.');
      }
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
      const total = quantity * book.price;
      transaction.create(orderRef, {
        uid: req.user.uid,
        book: book.id,
        quantity,
        amount: total,
        transactionRef: reference,
        address: completeAddress,
        status: 'pending',
        reviewNote: '',
        tracking: '',
        createdAt,
        updatedAt: createdAt,
      });
      return total;
    });
    res.status(201).json({ id, amount, status: 'pending' });
  });
  api.get('/courses/:id', async (req, res) => {
    const selected = await course(req.params.id);
    const { id } = selected;
    await requirePurchase(req.user, id);
    const rawTests = (await db.collection('tests').where('course', '==', id).get()).docs.map(value).sort(byNewest).reverse();
    const completed = (await db.collection('attempts').where('uid', '==', req.user.uid)
      .where('course', '==', id).get()).docs.map(value);
    const completedTests = new Set(completed.map(attempt => attempt.test));
    const tests = rawTests.map(item => ({ id: item.id, title: item.title, live: Boolean(item.live),
      startsAt: item.startsAt || '', expiresAt: item.expiresAt || '', durationMinutes: item.durationMinutes || 0,
      questionPaperDownload: Boolean(item.questionPaperDownload),
      completedAttempt: completedTests.has(item.id) }));
    const books = (await db.collection('books').where('course', '==', id).get()).docs.map(value)
      .sort((a, b) => `${a.subject || ''}${a.chapter || ''}`.localeCompare(`${b.subject || ''}${b.chapter || ''}`))
      .map(item => ({ id: item.id, title: item.title, pages: item.pages,
        subject: item.subject || 'General', chapter: item.chapter || 'Chapter 1', images: item.images || [] }));
    const videos = (await db.collection('chapterVideos').where('course', '==', id).get()).docs.map(value).sort(byNewest)
      .map(({ id, title, subject, chapter, type, size }) => ({ id, title, subject, chapter, type, size }));
    const messages = (await db.collection('messages').where('course', '==', id).get()).docs.map(value).sort(byNewest).slice(0, 100);
    const namedMessages = await Promise.all(messages.map(async message => {
      const student = value(await db.collection('students').doc(message.uid).get());
      return { name: student?.name || 'Student', text: message.text };
    }));
    res.json({ tests, books, videos, messages: namedMessages.reverse() });
  });
  api.post('/courses/:id/messages', async (req, res) => {
    const { id } = await course(req.params.id);
    await requirePurchase(req.user, id);
    const messageId = randomUUID();
    await db.collection('messages').doc(messageId).create({
      course: id,
      uid: req.user.uid,
      text: text(req.body?.text, 'Message', 1000),
      createdAt: new Date().toISOString(),
    });
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
    await db.collection('tickets').doc(id).create({
      uid: req.user.uid,
      text: text(req.body?.text, 'Support request', 2000),
      createdAt: new Date().toISOString(),
    });
    res.sendStatus(204);
  });
  api.get('/courses/:id/payment', async (req, res) => {
    const selected = await course(req.params.id);
    requireActive(selected);
    const { id, price } = selected;
    const snapshot = await db.collection('orders').where('uid', '==', req.user.uid).where('course', '==', id).limit(1).get();
    const item = snapshot.docs.map(value)[0];
    const referral = value(await db.collection('referrals').doc(req.user.uid).get());
    res.json({
      downloadsEnabled: Boolean(selected.downloadsEnabled),
      amount: price,
      credits: referral?.credits || 0,
      payment: { ...await paymentDetails(), qr: `/api/courses/${id}/payment-qr` },
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
    const selected = await course(req.params.id);
    requireActive(selected);
    const { id } = selected;
    const { uid } = req.user;
    const details = await paymentDetails();
    if (typeof req.body?.note !== 'undefined' && (typeof req.body.note !== 'string' || req.body.note.length > 500)) {
      fail(422, 'Payment note must be 500 characters or fewer.');
    }
    const note = (req.body?.note || '').trim();
    const submittedAt = new Date().toISOString();
    const orderId = idFor(uid, id);
    const orderRef = db.collection('orders').doc(orderId);
    const referralRef = db.collection('referrals').doc(uid);
    let result;
    await db.runTransaction(async transaction => {
      const [snapshot, referralSnapshot, courseSnapshot] = await Promise.all([
        transaction.get(orderRef), transaction.get(referralRef), transaction.get(db.collection('courses').doc(id)),
      ]);
      const currentCourse = value(courseSnapshot);
      if (!currentCourse) fail(404, 'Course not found.');
      requireActive(currentCourse);
      const { price } = currentCourse;
      const existing = value(snapshot);
      const referral = value(referralSnapshot);
      if (existing && typeof existing.payment === 'string' && existing.payment.length > 0) {
        fail(409, 'You already own this course.');
      }
      if (existing?.paymentStatus === 'pending') {
        throw Object.assign(new Error('A payment request is already waiting for admin review.'), { status: 409 });
      }
      const creditsUsed = req.body?.useCredits === true ?
        Math.min(Number(referral?.credits || 0), Math.ceil(price / 100)) : 0;
      const amountDue = Math.max(0, price - creditsUsed * 100);
      const reference = paymentReference(req.body?.reference);
      if (amountDue > 0 && !details.configured) fail(503, 'Payment details are not configured.');
      if (amountDue > 0 && !reference) fail(422, 'Enter a valid UPI transaction reference (4–80 characters).');
      if (creditsUsed) transaction.update(referralRef, { credits: Number(referral.credits) - creditsUsed });
      result = {
        id: orderId, amount: amountDue, creditsUsed,
        status: amountDue === 0 ? 'approved' : 'pending',
        reference: reference || 'CREDITS', submittedAt,
      };
      transaction.set(orderRef, {
        uid,
        course: id,
        amount: amountDue,
        originalAmount: price,
        creditsUsed,
        payment: amountDue === 0 ? `credits:${orderId}` : '',
        paymentStatus: result.status,
        transactionRef: result.reference,
        paymentNote: note,
        reviewNote: '',
        submittedAt,
        reviewedAt: '',
        reviewedBy: '',
        createdAt: existing?.createdAt || submittedAt,
      });
    });
    res.status(201).json(result);
  });
  api.get('/ebooks/:id/payment', async (req, res) => {
    const book = value(await db.collection('ebooks').doc(req.params.id).get());
    if (!book) fail(404, 'E-book not found.');
    const orders = (await db.collection('ebookOrders').where('uid', '==', req.user.uid)
      .where('ebook', '==', book.id).limit(1).get()).docs.map(value);
    const item = orders[0];
    res.json({
      amount: book.price,
      payment: { ...await paymentDetails(), qr: '/api/payment-qr' },
      order: item ? { id: item.id, amount: item.amount, status: item.paymentStatus,
        reference: item.transactionRef, note: item.paymentNote, reviewNote: item.reviewNote,
        submittedAt: item.submittedAt } : null,
    });
  });
  api.post('/ebooks/:id/payment', paymentLimit, async (req, res) => {
    const book = value(await db.collection('ebooks').doc(req.params.id).get());
    if (!book) fail(404, 'E-book not found.');
    const details = await paymentDetails();
    if (!details.configured) fail(503, 'Payment details are not configured.');
    const reference = paymentReference(req.body?.reference);
    if (!reference) fail(422, 'Enter a valid UPI transaction reference (4–80 characters).');
    const orderId = idFor(req.user.uid, `ebook-${book.id}`);
    const orderRef = db.collection('ebookOrders').doc(orderId);
    const submittedAt = new Date().toISOString();
    await db.runTransaction(async transaction => {
      const existing = value(await transaction.get(orderRef));
      if (existing?.paymentStatus === 'approved') fail(409, 'You already own this e-book.');
      if (existing?.paymentStatus === 'pending') fail(409, 'A payment request is already waiting for admin review.');
      transaction.set(orderRef, {
        uid: req.user.uid, ebook: book.id, amount: book.price, transactionRef: reference,
        paymentNote: typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '',
        payment: '', paymentStatus: 'pending', reviewNote: '', submittedAt,
        reviewedAt: '', reviewedBy: '', createdAt: existing?.createdAt || submittedAt,
      });
    });
    res.status(201).json({ id: orderId, amount: book.price, status: 'pending', reference, submittedAt });
  });
  api.get('/ebook-orders', async (req, res) => {
    const rows = (await db.collection('ebookOrders').where('uid', '==', req.user.uid).get()).docs
      .map(value).sort(byNewest);
    res.json(rows.map(order => ({ id: order.id, ebook: order.ebook, amount: order.amount,
      status: order.paymentStatus, reviewNote: order.reviewNote, submittedAt: order.submittedAt })));
  });
  async function ownedEbook(req, id) {
    const book = value(await db.collection('ebooks').doc(id).get());
    if (!book) fail(404, 'E-book not found.');
    if (!req.user.admin) {
      const order = await db.collection('ebookOrders').where('uid', '==', req.user.uid)
        .where('ebook', '==', id).where('paymentStatus', '==', 'approved').limit(1).get();
      if (order.empty || !order.docs.map(value)[0].payment) {
        fail(403, 'Purchase and wait for approval to unlock this e-book.');
      }
    }
    return book;
  }
  api.get('/ebooks/:id/pages/:page', async (req, res) => {
    const book = await ownedEbook(req, req.params.id);
    const page = Number(req.params.page);
    if (!Number.isInteger(page) || page < 1 || page > book.pages) fail(404, 'Page not found.');
    const [pdf] = await bucket.file(`ebooks/${book.id}.pdf`).download();
    res.type('png').send(await processDocument(() => renderPage(pdf, page, req.user.phone)));
  });
  api.get('/ebooks/:id/download', async (req, res) => {
    const book = await ownedEbook(req, req.params.id);
    const [source] = await bucket.file(`ebooks/${book.id}.pdf`).download();
    const pdf = await protectedPdf(source, book.pages, req.user.phone);
    res.attachment(`${book.title}-protected.pdf`).type('pdf').send(pdf);
  });

  async function test(id) {
    const item = value(await db.collection('tests').doc(id).get());
    if (!item) fail(404, 'Test not found.');
    return item;
  }
  api.get('/tests/:id', async (req, res) => {
    const item = await test(req.params.id);
    await requirePurchase(req.user, item.course);
    const attempts = (await db.collection('attempts').where('uid', '==', req.user.uid)
      .where('test', '==', item.id).get()).size;
    const now = Date.now();
    const starts = Date.parse(item.startsAt);
    const expires = Date.parse(item.expiresAt);
    if (item.live && Number.isFinite(starts) && now < starts) {
      fail(423, `This live test opens on ${new Date(starts).toLocaleString('en-IN')}.`);
    }
    const limited = Boolean(item.live) && (!Number.isFinite(expires) || now <= expires);
    const attemptsLimit = item.live ? (item.attemptsLimit || 2) : Infinity;
    if (limited && attempts >= attemptsLimit) {
      fail(409, `You have used ${attemptsLimit} attempts. Unlimited attempts open after the live window ends.`);
    }
    const sections = [...new Set(item.questions.map(question => question.section || 'General'))];
    res.json({
      title: item.title,
      live: Boolean(item.live),
      startsAt: item.startsAt || '',
      expiresAt: item.expiresAt || '',
      durationMinutes: item.durationMinutes || 90,
      attempts,
      attemptsLimit: item.live ? attemptsLimit : 0,
      limited,
      marksPerQuestion: item.marksPerQuestion || 1,
      negativeMark: item.negativeMark || 0,
      questionPaperDownload: Boolean(item.questionPaperDownload), completedAttempt: attempts > 0,
      sections,
      questions: item.questions.map(({ prompt, options, section }) => ({
        prompt, options, section: section || 'General',
      })),
    });
  });
  api.post('/tests/:id/start', async (req, res) => {
    const item = await test(req.params.id);
    await requirePurchase(req.user, item.course);
    const attempts = (await db.collection('attempts').where('uid', '==', req.user.uid)
      .where('test', '==', item.id).get()).size;
    const nowMs = Date.now();
    const starts = Date.parse(item.startsAt);
    const expires = Date.parse(item.expiresAt);
    if (item.live && Number.isFinite(starts) && nowMs < starts) {
      fail(423, 'This live test has not opened yet.');
    }
    const limited = Boolean(item.live) && (!Number.isFinite(expires) || nowMs <= expires);
    const attemptsLimit = item.live ? (item.attemptsLimit || 2) : Infinity;
    if (limited && attempts >= attemptsLimit) {
      fail(409, `You have used ${attemptsLimit} attempts. Unlimited attempts open after the live window ends.`);
    }
    const active = await db.collection('examSessions').where('uid', '==', req.user.uid)
      .where('test', '==', item.id).where('active', '==', true).limit(1).get();
    if (!active.empty) {
      const session = value(active.docs[0]);
      return res.json({ id: session.id, startedAt: session.startedAt,
        answers: Array.isArray(session.answers) ? session.answers : [],
        marked: Array.isArray(session.marked) ? session.marked : [] });
    }
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    await db.collection('examSessions').doc(id).create({
      uid: req.user.uid, test: item.id, startedAt, answers: [], marked: [], active: true,
    });
    res.status(201).json({ id, startedAt });
  });
  api.put('/tests/:id/progress', async (req, res) => {
    const active = await db.collection('examSessions').where('uid', '==', req.user.uid)
      .where('test', '==', req.params.id).where('active', '==', true).limit(1).get();
    if (active.empty) fail(409, 'Start the test before saving progress.');
    await active.docs[0].ref.update({
      answers: req.body?.answers || [],
      marked: req.body?.marked || [],
    });
    res.sendStatus(204);
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
    const active = await db.collection('examSessions').where('uid', '==', req.user.uid)
      .where('test', '==', item.id).where('active', '==', true).limit(1).get();
    if (active.empty) fail(409, 'Start the test before submitting.');
    const session = value(active.docs[0]);
    const maxSeconds = (item.durationMinutes || 90) * 60;
    const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(session.startedAt)) / 1000));
    const timedOut = elapsed > maxSeconds;
    const marks = item.marksPerQuestion || 1;
    const penalty = item.negativeMark || 0;
    const correct = questions.filter((question, index) => answers[index] === question.answer).length;
    const wrong = questions.filter((question, index) =>
      answers[index] !== null && answers[index] !== question.answer).length;
    const score = Math.max(0, correct * marks - wrong * penalty);
    const total = questions.length * marks;
    const sectionScores = Object.values(questions.reduce((groups, question, index) => {
      const name = question.section || 'General';
      const current = groups[name] ||= {
        section: name, correct: 0, wrong: 0, unanswered: 0, score: 0, total: 0,
      };
      current.total += marks;
      if (answers[index] === null) current.unanswered++;
      else if (answers[index] === question.answer) {
        current.correct++;
        current.score += marks;
      } else {
        current.wrong++;
        current.score -= penalty;
      }
      current.score = Math.max(0, current.score);
      return groups;
    }, {}));
    const result = {
      score,
      total,
      correct,
      wrong,
      unanswered: questions.length - correct - wrong,
      maxMarks: total,
      negative: penalty,
      elapsedSeconds: Math.min(elapsed, maxSeconds),
      sectionScores,
      timedOut,
      questionPaperDownload: Boolean(item.live && item.questionPaperDownload),
    };
    const attemptId = await createWithId('attempts', {
      uid: req.user.uid,
      course: item.course,
      test: item.id,
      title: item.title,
      score,
      total: questions.length,
      answers,
      maxMarks: total,
      negative: wrong * penalty,
      elapsedSeconds: elapsed,
      sectionScores,
    });
    await active.docs[0].ref.update({ active: false });
    res.json({...result, attemptId});
  });
  api.get('/attempts/:id/result.pdf', async (req, res) => {
    const attempt = value(await db.collection('attempts').doc(req.params.id).get());
    if (!attempt || attempt.uid !== req.user.uid) fail(404, 'Test result not found.');
    const [selectedTest, selectedCourse, student] = await Promise.all([
      test(attempt.test), course(attempt.course), db.collection('students').doc(req.user.uid).get(),
    ]);
    const questions = selectedTest.questions;
    attempt.correct = questions.filter((question,index) => attempt.answers[index] === question.answer).length;
    attempt.wrong = questions.filter((question,index) => attempt.answers[index] !== null && attempt.answers[index] !== question.answer).length;
    attempt.unanswered = questions.length - attempt.correct - attempt.wrong;
    const ranked = (await db.collection('attempts').where('test','==',attempt.test).get()).docs.map(value);
    const best = [...new Map(ranked.sort((a,b)=>b.score-a.score || a.elapsedSeconds-b.elapsedSeconds)
      .map(item => [item.uid,item])).values()].sort((a,b)=>b.score-a.score || a.elapsedSeconds-b.elapsedSeconds);
    const rank = best.findIndex(item => item.uid === req.user.uid) + 1;
    res.type('pdf').attachment(`${selectedTest.title}-result.pdf`).send(
      await buildResultPdf({student:value(student) || {phone:req.user.phone}, attempt, course:selectedCourse, test:selectedTest, rank}));
  });
  api.get('/courses/:id/receipt.pdf', async (req, res) => {
    const snapshots = (await db.collection('orders').where('uid','==',req.user.uid).where('course','==',req.params.id).get()).docs.map(value);
    const order = snapshots.find(item => Boolean(item.payment));
    if (!order) fail(404, 'Approved purchase receipt not found.');
    const [selectedCourse, student] = await Promise.all([course(req.params.id), db.collection('students').doc(req.user.uid).get()]);
    res.type('pdf').attachment(`${selectedCourse.title}-receipt.pdf`).send(
      await buildReceiptPdf({student:value(student) || {phone:req.user.phone}, order, course:selectedCourse}));
  });
  api.get('/receipts', async (req, res) => {
    const orders = (await db.collection('orders').where('uid','==',req.user.uid).get()).docs.map(value)
      .filter(order => Boolean(order.payment));
    res.json(await Promise.all(orders.map(async order => {
      const selected = value(await db.collection('courses').doc(order.course).get());
      return {id: order.id, course: order.course, title: selected?.title || 'Course',
        amount: order.amount, reference: order.transactionRef,
        reviewedAt: order.reviewedAt, submittedAt: order.submittedAt};
    })).then(rows => rows.sort((a,b) =>
      String(b.reviewedAt || b.submittedAt).localeCompare(String(a.reviewedAt || a.submittedAt)))));
  });
  api.get('/tests/:id/question-paper.pdf', async (req, res) => {
    const item = await test(req.params.id);
    await requirePurchase(req.user, item.course);
    if (!item.live) fail(404, 'Question paper download is available for live tests only.');
    if (!item.questionPaperDownload) fail(403, 'Question paper download is disabled by the admin.');
    const attempt = await db.collection('attempts').where('uid', '==', req.user.uid)
      .where('test', '==', item.id).limit(1).get();
    if (attempt.empty) fail(403, 'Complete your first test attempt before downloading the question paper.');
    const pdf = await questionPaperPdf(item, req.user.phone);
    res.type('pdf').attachment(`${item.title.replace(/[^a-z0-9 ._-]+/gi, '_')}-question-paper.pdf`).send(pdf);
  });
  api.get('/tests/:id/leaderboard', async (req, res) => {
    const item = await test(req.params.id);
    await requirePurchase(req.user, item.course);
    if (!item.live) fail(404, 'Leaderboard is available for live tests only.');
    const expires = Date.parse(item.expiresAt);
    if (!Number.isFinite(expires) || Date.now() < expires) {
      fail(423, 'The leaderboard will unlock when the live test window ends.');
    }
    const snapshots = (await db.collection('attempts').where('test', '==', item.id).get()).docs.map(value)
      .filter(attempt => Date.parse(attempt.createdAt) <= expires);
    const byBest = new Map();
    for (const attempt of snapshots.sort((a, b) => b.score - a.score ||
      a.elapsedSeconds - b.elapsedSeconds || String(a.createdAt).localeCompare(String(b.createdAt)))) {
      if (!byBest.has(attempt.uid)) byBest.set(attempt.uid, attempt);
    }
    let previous = null;
    const rows = [];
    let index = 0;
    for (const entry of [...byBest.values()]) {
      index++;
      if (!previous || entry.score !== previous.score || entry.elapsedSeconds !== previous.elapsedSeconds) {
        previous = {...entry, rank: index};
      }
      const student = value(await db.collection('students').doc(entry.uid).get());
      const name = student?.name || 'Student';
      rows.push({rank: previous.rank, name: entry.uid === req.user.uid ? name : `${name.slice(0, 1)}.`,
        score: entry.score, maxMarks: entry.maxMarks, elapsedSeconds: entry.elapsedSeconds,
        attempts: snapshots.filter(attempt => attempt.uid === entry.uid).length,
        isCurrentUser: entry.uid === req.user.uid});
    }
    res.json({title: item.title, expiresAt: item.expiresAt, participants: rows.length,
      rows, mine: rows.find(row => row.isCurrentUser) || null});
  });
  api.get('/progress', async (req, res) => {
    const attempts = (await db.collection('attempts').where('uid', '==', req.user.uid).get()).docs
      .map(value).sort(byNewest).slice(0, 100);
    const total = attempts.reduce((sum, item) => sum + item.total, 0);
    const correct = attempts.reduce((sum, item) => sum + item.score, 0);
    const output = await Promise.all(attempts.map(async attempt => ({
      ...attempt,
      courseTitle: value(await db.collection('courses').doc(attempt.course).get())?.title || 'Mission',
    })));
    const courses = Object.values(output.reduce((groups, item) => {
      const entry = groups[item.course] ||= { course: item.course, title: item.courseTitle, attempts: 0, correct: 0, total: 0, best: 0 };
      entry.attempts++;
      entry.correct += item.score;
      entry.total += item.total;
      entry.best = Math.max(entry.best, Math.round(item.score / item.total * 100));
      entry.accuracy = Math.round(entry.correct / entry.total * 100);
      return groups;
    }, {}));
    const trend = output.slice(0, 10).reverse().map(item => ({
      label: new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      value: Math.round(item.score / item.total * 100),
      title: item.title,
    }));
    res.json({ attempts: output, summary: {
      attempts: attempts.length, questions: total, correct, accuracy: total ? Math.round(correct / total * 100) : 0,
      best: attempts.length ? Math.max(...attempts.map(item => Math.round(item.score / item.total * 100))) : 0,
      courses: courses.length,
    }, courses, trend });
  });
  api.get('/notifications', async (req, res) => {
    const orders = (await db.collection('orders').where('uid', '==', req.user.uid).get()).docs.map(value)
      .sort(byNewest).slice(0, 50);
    const paymentNotices = await Promise.all(orders.map(async order => {
      const selected = value(await db.collection('courses').doc(order.course).get());
      const title = typeof selected?.title === 'string' && selected.title.trim() ? selected.title : 'Course';
      return {
        id: `payment-${order.id}`,
        title: order.paymentStatus === 'approved' ? `${title === 'null' ? 'Course' : title} is unlocked` :
          order.paymentStatus === 'rejected' ? `${title === 'null' ? 'Course' : title} payment needs attention` :
          `${title === 'null' ? 'Course' : title} payment is under review`,
        body: order.paymentStatus === 'rejected' ? order.reviewNote : order.paymentStatus === 'approved' ?
          'Your mission, tests and books are ready.' : 'The admin is verifying your UPI transaction.',
        href: `#course/${order.course}`,
        date: order.submittedAt,
        unread: order.paymentStatus === 'pending',
      };
    }));
    const owned = new Set(orders.filter(order =>
      typeof order.payment === 'string' && order.payment.length > 0).map(order => order.course));
    const liveTests = (await db.collection('tests').where('live', '==', true).get()).docs.map(value)
      .filter(test => owned.has(test.course) && (!test.expiresAt || Date.parse(test.expiresAt) > Date.now()))
      .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))).slice(0, 20)
      .map(test => ({
        id: `live-test-${test.id}`,
        title: `Live mock test: ${test.title}`,
        body: `Scheduled ${new Date(test.startsAt).toLocaleString('en-IN')}.`,
        href: `#course/${test.course}`,
        date: test.startsAt,
        unread: Date.parse(test.startsAt) > Date.now(),
      }));
    res.json([...liveTests, ...paymentNotices].sort((a, b) => String(b.date).localeCompare(String(a.date))));
  });
  api.get('/content/:kind', async (req, res) => {
    if (!['current-affairs', 'pyqs', 'syllabus', 'free-tests'].includes(req.params.kind)) fail(404, 'Content not found.');
    res.json((await db.collection('resources').where('kind', '==', req.params.kind).get()).docs
      .map(value).sort((a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt))));
  });
  api.get('/books/:id/pages/:page', async (req, res) => {
    const book = value(await db.collection('books').doc(req.params.id).get());
    if (!book) fail(404, 'Book not found.');
    await requirePurchase(req.user, book.course);
    const page = Number(req.params.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > book.pages) fail(404, 'Page not found.');
    let pdf;
    try {
      [pdf] = await bucket.file(`books/${book.id}.pdf`).download();
    } catch (error) {
      console.error('Book storage download failed', { book: book.id, message: error.message, code: error.code });
      throw error;
    }
    let png;
    try {
      png = await processDocument(() => renderPage(pdf, page, req.user.phone));
    } catch (error) {
      console.error('Book render failed', { book: book.id, page, message: error.message, stack: error.stack });
      throw error;
    }
    res.type('png').send(png);
  });
  api.get('/books/:id/pages/:page/download', async (req, res) => {
    const book = value(await db.collection('books').doc(req.params.id).get());
    if (!book) fail(404, 'Book not found.');
    await requirePurchase(req.user, book.course);
    const selectedCourse = value(await db.collection('courses').doc(book.course).get());
    if (!selectedCourse?.downloadsEnabled) fail(403, 'Downloads are disabled for this course.');
    const page = Number(req.params.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > book.pages) fail(404, 'Page not found.');
    let pdf;
    try {
      [pdf] = await bucket.file(`books/${book.id}.pdf`).download();
    } catch (error) {
      console.error('Book download storage fetch failed', { book: book.id, message: error.message, code: error.code });
      throw error;
    }
    let png;
    try {
      png = await processDocument(() => renderPage(pdf, page, req.user.phone));
    } catch (error) {
      console.error('Book download render failed', { book: book.id, page, message: error.message, stack: error.stack });
      throw error;
    }
    res.attachment(`${book.title}-page-${page}.png`).type('png').send(png);
  });
  api.get('/books/:id/download', async (req, res) => {
    const book = value(await db.collection('books').doc(req.params.id).get());
    if (!book) fail(404, 'Book not found.');
    await requirePurchase(req.user, book.course);
    const selectedCourse = value(await db.collection('courses').doc(book.course).get());
    if (!selectedCourse?.downloadsEnabled) fail(403, 'Downloads are disabled for this course.');
    const [source] = await bucket.file(`books/${book.id}.pdf`).download();
    const pdf = await protectedPdf(source, book.pages, req.user.phone);
    res.attachment(`${book.title}-protected.pdf`).type('pdf').send(pdf);
  });

  api.use('/admin', admin);
  api.get('/admin/analytics', async (_req, res) => {
    const [students, courses, orders, ebookOrders, attempts, liveTests] = await Promise.all([
      queryCollection('students'), queryCollection('courses'), queryCollection('orders'),
      queryCollection('ebookOrders'),
      queryCollection('attempts'), db.collection('tests').where('live', '==', true).get(),
    ]);
    const approved = orders.filter(order => typeof order.payment === 'string' && order.payment.length > 0);
    const since = Date.now() - 86_400_000;
    const liveRows = await Promise.all(liveTests.docs.map(value).map(async row => {
      const results = attempts.filter(attempt => attempt.test === row.id);
      const average = results.length ? Math.round(results.reduce((sum, result) =>
        sum + (Number(result.score || 0) / Number(result.maxMarks || 1) * 100), 0) / results.length * 10) / 10 : 0;
      return {id: row.id, title: row.title, startsAt: row.startsAt, expiresAt: row.expiresAt,
        students: new Set(results.map(result => result.uid)).size, attempts: results.length, average};
    }));
    res.json({
      students: students.length, courses: courses.length,
      purchases: approved.length + ebookOrders.filter(order => Boolean(order.payment)).length,
      revenue: approved.reduce((sum, order) => sum + Number(order.amount || 0), 0) +
        ebookOrders.filter(order => Boolean(order.payment)).reduce((sum, order) => sum + Number(order.amount || 0), 0),
      attempts24h: attempts.filter(item => Date.parse(item.createdAt) >= since).length,
      attempts: attempts.length, liveTests: liveRows,
    });
  });
  api.get('/admin/tests/:id/results', async (req, res) => {
    const selected = await test(req.params.id);
    const snapshots = await db.collection('attempts').where('test', '==', selected.id).get();
    const results = await Promise.all(snapshots.docs.map(value).map(async result => {
      const student = value(await db.collection('students').doc(result.uid).get());
      return {...result, name: student?.name || 'Student', phone: student?.phone || ''};
    }));
    res.json({test: {id: selected.id, title: selected.title, live: Boolean(selected.live),
      startsAt: selected.startsAt, expiresAt: selected.expiresAt, durationMinutes: selected.durationMinutes,
      attemptsLimit: selected.attemptsLimit}, results: results.sort(byNewest)});
  });
  api.get('/admin/tests/:id/results.pdf', async (req, res) => {
    const selected = await test(req.params.id);
    const snapshots = await db.collection('attempts').where('test', '==', selected.id).get();
    const entries = await Promise.all(snapshots.docs.map(value).map(async result => {
      const student = value(await db.collection('students').doc(result.uid).get());
      return {...result, name: student?.name || 'Student'};
    }));
    const best = new Map();
    for (const result of entries.sort((a,b) => b.score-a.score || String(a.createdAt).localeCompare(String(b.createdAt)))) {
      if (!best.has(result.uid)) best.set(result.uid, result);
    }
    const finalRows = [...best.values()];
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595,842]);
    const blue=rgb(.03,.2,.42);
    page.drawRectangle({x:36,y:785,width:523,height:30,color:blue});
    page.drawText(`${selected.title.toUpperCase()} — RESULT BY MISSION SELECTION`,{x:47,y:795,size:12,font:bold,color:rgb(1,1,1)});
    page.drawRectangle({x:36,y:750,width:523,height:25,color:rgb(.98,.71,.47)});
    [['Rank',48],['Name',105],['Marks',500]].forEach(([label,x])=>page.drawText(label,{x,y:758,size:9,font:bold}));
    let y=725;
    finalRows.forEach((result,index)=>{
      page.drawRectangle({x:36,y:y-8,width:523,height:24,color:index%2?rgb(1,1,1):rgb(.94,.98,.96),borderColor:rgb(.15,.25,.35),borderWidth:.35});
      page.drawText(String(index+1),{x:51,y,size:9,font:regular});
      page.drawText(result.name,{x:105,y,size:9,font:regular});
      page.drawText(`${result.score} / ${result.maxMarks||result.total||0}`,{x:480,y,size:9,font:bold});
      y-=25;
    });
    page.drawText(`Generated ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST • Admin confidential`,{x:36,y:24,size:7,font:regular,color:rgb(.35,.4,.45)});
    res.type('pdf').attachment(`${selected.title}-results.pdf`).send(Buffer.from(await pdf.save()));
  });
  api.get('/admin/payments/:id/receipt.pdf', async (req, res) => {
    const order = value(await db.collection('orders').doc(req.params.id).get());
    if (!order) fail(404, 'Payment request not found.');
    if (!order.payment || order.paymentStatus !== 'approved') fail(403, 'Receipt is available only for approved payments.');
    const [selectedCourse, student] = await Promise.all([
      course(order.course), db.collection('students').doc(order.uid).get(),
    ]);
    res.type('pdf').attachment(`${selectedCourse.title}-receipt.pdf`).send(
      await buildReceiptPdf({student:value(student)||{}, order, course:selectedCourse}));
  });
  media.adminRoutes();
  registerVideoRoutes(api, { db, bucket, value, text, course, requirePurchase });
  registerPublishedRoutes(api, { db, bucket, value, text, byNewest, queryCollection, media });
  api.post('/admin/videos', async (req, res) => {
    const input = String(req.body?.url || '');
    let videoId = '';
    try {
      const url = new URL(input);
      if (url.hostname === 'youtu.be') videoId = url.pathname.slice(1).split('/')[0];
      else if (url.hostname.endsWith('youtube.com')) videoId =
        url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).at(-1);
    } catch { /* Invalid URL rejected below. */ }
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) fail(422, 'Enter a valid YouTube video URL.');
    const selectedCourse = typeof req.body?.course === 'string' ? req.body.course : '';
    if (selectedCourse) await course(selectedCourse);
    const id = await createWithId('videos', {
      title: text(req.body?.title, 'Video title', 120),
      description: text(req.body?.description, 'Description', 1000),
      videoId, course: selectedCourse,
    });
    res.status(201).json({ id, videoId });
  });
  api.get('/admin/payment-settings', async (_req, res) => res.json(await paymentDetails()));
  api.put('/admin/payment-settings', async (req, res) => {
    const method = req.body?.method;
    if (!['upi', 'qr', 'both'].includes(method)) fail(422, 'Choose UPI, QR code, or both.');
    const existing = value(await db.collection('settings').doc('payment').get()) || {};
    const upi = upiDetails({ upiId: req.body?.upiId, payeeName: req.body?.payeeName });
    if (method !== 'qr' && !upi.configured) fail(422, 'Enter a valid UPI ID and payee name.');
    if (method !== 'upi' && !existing.customQr) fail(422, 'Upload a payment QR image before enabling QR checkout.');
    await db.collection('settings').doc('payment').set({
      method, upiId: req.body?.upiId || '', payeeName: text(req.body?.payeeName, 'Payee name', 100),
      customQr: Boolean(existing.customQr), qrType: existing.qrType || '',
    });
    res.sendStatus(204);
  });
  api.post('/admin/payment-qr', express.raw({ type: /^image\//, limit: '2mb', inflate: false }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 8) fail(400, 'Upload a non-empty PNG, JPEG, or WebP QR image.');
    const type = req.get('Content-Type') || '';
    if (!/^image\/(png|jpeg|webp)$/i.test(type)) fail(422, 'Upload a PNG, JPEG, or WebP QR image.');
    await bucket.file('payment-config/qr').save(req.body, {
      resumable: false, contentType: type, metadata: { cacheControl: 'public, max-age=300' },
    });
    await db.collection('settings').doc('payment').set({ customQr: true, qrType: type }, { merge: true });
    res.status(201).json({ configured: true });
  });
  api.get('/admin/students', async (_req, res) => {
    res.json((await queryCollection('students')).sort((a, b) =>
      String(a.name || a.phone).localeCompare(String(b.name || b.phone))).slice(0, 500)
      .map(student => ({ uid: student.id, phone: student.phone, name: student.name || '', disabled: Boolean(student.disabled) })));
  });
  api.post('/admin/students/:uid/status', async (req, res) => {
    const disabled = req.body?.disabled;
    if (typeof disabled !== 'boolean') fail(422, 'Choose a valid account status.');
    const student = db.collection('students').doc(req.params.uid);
    if (!(await student.get()).exists) fail(404, 'Student not found.');
    await student.set({ disabled }, { merge: true });
    res.sendStatus(204);
  });
  api.put('/admin/social', async (req, res) => {
    const values = req.body ?? {};
    const social = {};
    for (const key of ['youtube', 'instagram', 'telegram']) {
      const target = typeof values[key] === 'string' ? values[key].trim() : '';
      if (target && !/^https:\/\/[^/\s]+/i.test(target)) fail(422, `Enter a valid HTTPS ${key} URL.`);
      social[key] = target;
    }
    await db.collection('settings').doc('social').set(social);
    res.sendStatus(204);
  });
  api.get('/admin/timetable', async (_req, res) => {
    const schedules = (await queryCollection('schedules')).sort((a, b) =>
      String(a.day || '').localeCompare(String(b.day || '')) ||
      String(a.startsAt || a.starts_at || '').localeCompare(String(b.startsAt || b.starts_at || '')));
    res.json(schedules.map(item => ({
      id: item.id,
      title: item.title,
      day: item.day,
      starts_at: item.startsAt || item.starts_at,
      duration: item.duration,
      description: item.description,
      created_at: item.createdAt || item.created_at,
    })));
  });
  api.post('/admin/timetable', async (req, res) => {
    const id = randomUUID();
    await db.collection('schedules').doc(id).create({
      title: text(req.body?.title, 'Title', 120),
      day: text(req.body?.day, 'Day', 20),
      startsAt: text(req.body?.startsAt, 'Start time', 20),
      duration: text(req.body?.duration, 'Duration', 30),
      description: text(req.body?.description, 'Description', 1000),
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ id });
  });
  api.get('/admin/physical-books', async (_req, res) => {
    res.json((await queryCollection('physicalBooks')).sort(byNewest).map(book => ({
      id: book.id,
      title: book.title,
      description: book.description,
      price: book.price,
      stock: book.stock,
      active: book.active === true ? 1 : 0,
      created_at: book.createdAt,
    })));
  });
  api.post('/admin/physical-books', async (req, res) => {
    const { price, stock } = req.body ?? {};
    if (!Number.isInteger(price) || price < 100 || price > 10_000_000 ||
        !Number.isInteger(stock) || stock < 0 || stock > 10000) {
      fail(422, 'Enter valid stock and a price from ₹1 to ₹100,000, in paise.');
    }
    const id = randomUUID();
    await db.collection('physicalBooks').doc(id).create({
      title: text(req.body?.title, 'Title', 120),
      description: text(req.body?.description, 'Description', 2000),
      price,
      stock,
      images: await media.validate(req.body?.images),
      active: true,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ id });
  });
  api.get('/admin/physical-orders', async (_req, res) => {
    const orders = (await queryCollection('physicalOrders')).sort((a, b) => {
      const pending = Number(a.status !== 'pending') - Number(b.status !== 'pending');
      return pending || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    }).slice(0, 200);
    res.json(await Promise.all(orders.map(async order => {
      const [student, book] = await Promise.all([
        db.collection('students').doc(order.uid).get(),
        db.collection('physicalBooks').doc(order.book).get(),
      ]);
      return {
        id: order.id,
        uid: order.uid,
        book: order.book,
        quantity: order.quantity,
        amount: order.amount,
        transaction_ref: order.transactionRef,
        address: order.address,
        status: order.status,
        review_note: order.reviewNote || '',
        tracking: order.tracking || '',
        created_at: order.createdAt,
        updated_at: order.updatedAt,
        name: value(student)?.name || 'Student',
        accountPhone: value(student)?.phone,
        bookTitle: value(book)?.title,
      };
    })));
  });
  api.post('/admin/physical-orders/:id/status', async (req, res) => {
    const orderRef = db.collection('physicalOrders').doc(req.params.id);
    await db.runTransaction(async transaction => {
      const order = value(await transaction.get(orderRef));
      if (!order) fail(404, 'Order not found.');
      const status = req.body?.status;
      if (!['approved', 'shipped', 'delivered', 'cancelled'].includes(status)) {
        fail(422, 'Choose a valid order status.');
      }
      const tracking = typeof req.body?.tracking === 'string' ?
        req.body.tracking.trim().slice(0, 100) : order.tracking || '';
      const reviewNote = typeof req.body?.note === 'string' ?
        req.body.note.trim().slice(0, 500) : order.reviewNote || '';
      let bookRef;
      let book;
      if (status === 'approved' && order.status === 'pending') {
        bookRef = db.collection('physicalBooks').doc(order.book);
        book = value(await transaction.get(bookRef));
        if (!book) fail(404, 'Physical book not found.');
        if (book.stock < order.quantity) fail(409, 'This physical book no longer has enough stock.');
      }
      transaction.update(orderRef, {
        status,
        reviewNote,
        tracking,
        updatedAt: new Date().toISOString(),
      });
      if (bookRef) transaction.update(bookRef, { stock: book.stock - order.quantity });
    });
    res.sendStatus(204);
  });
  api.post('/admin/content/:kind', async (req, res) => {
    const kind = req.params.kind;
    if (!['current-affairs', 'pyqs', 'syllabus', 'free-tests'].includes(kind)) fail(422, 'Choose a valid content section.');
    const publishedAt = typeof req.body?.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.publishedAt)
      ? req.body.publishedAt : new Date().toISOString().slice(0, 10);
    const id = await createWithId('resources', {
      kind,
      title: text(req.body?.title, 'Title', 120),
      summary: text(req.body?.summary, 'Summary', 300),
      body: text(req.body?.body, 'Content', 10_000),
      publishedAt,
    });
    res.status(201).json({ id });
  });
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
          course: sample.id, title: sample.book, pages: 1, subject: 'Foundation',
          chapter: 'Chapter 1: Getting Started', createdAt,
        }, { merge: true }),
        bucket.file(`books/${bookId}.pdf`).save(await sampleBookPdf(sample.book), {
          resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'private, no-store' },
        }),
      ]);
    }));
    await Promise.all(sampleResources.map(resource => db.collection('resources').doc(resource.id).set({
      kind: resource.kind, title: resource.title, summary: resource.summary, body: resource.body,
      publishedAt: resource.publishedAt || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    }, { merge: true })));
    res.json({ courses: sampleCourses.length, resources: sampleResources.length });
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
      expiresOn: expiryInput(req.body?.expiresOn, { future: true }),
      images: await media.validate(req.body?.images),
    });
    res.status(201).json({ id });
  });
  api.post('/admin/courses/:id/tests', async (req, res) => {
    const { id: courseId } = await course(req.params.id);
    const {
      title, questions, live, startsAt, expiresAt, durationMinutes, attemptsLimit,
      marksPerQuestion, negativeMark, questionPaperDownload = false,
    } = req.body ?? {};
    let scheduled = '';
    let expiration = '';
    let duration = 0;
    duration = durationMinutes === undefined ? 90 : durationMinutes;
    if (!Number.isInteger(duration) || duration < 10 || duration > 300) {
      fail(422, 'A test needs a duration from 10–300 minutes.');
    }
    if (live) {
      scheduled = istIso(startsAt, 'Live start time');
    }
    if (expiresAt !== undefined && expiresAt !== '') {
      expiration = istIso(expiresAt, 'Live expiry time');
    }
    if (live && (!expiration || Date.parse(expiration) <= Date.parse(scheduled))) {
      fail(422, 'A live test expiry must be after its start time.');
    }
    const attempts = live ? (attemptsLimit === undefined ? 2 : attemptsLimit) : 0;
    const marks = marksPerQuestion === undefined ? 1 : marksPerQuestion;
    const negative = negativeMark === undefined ? 0 : negativeMark;
    if (live && (!Number.isInteger(attempts) || attempts < 1 || attempts > 100)) {
      fail(422, 'Attempt limit must be a whole number from 1–100.');
    }
    if (typeof marks !== 'number' || !Number.isFinite(marks) || marks <= 0 || marks > 100) {
      fail(422, 'Marks per question must be greater than zero and at most 100.');
    }
    if (typeof negative !== 'number' || !Number.isFinite(negative) || negative < 0 || negative > 100) {
      fail(422, 'Negative mark must be from 0–100.');
    }
    const validQuestions = validateQuestions(questions);
    if (typeof questionPaperDownload !== 'boolean') fail(422, 'Choose a valid question paper download option.');
    const id = await createWithId('tests', {
      course: courseId,
      title: text(title, 'Title', 120),
      questions: validQuestions,
      live: Boolean(live),
      startsAt: scheduled,
      expiresAt: expiration,
      durationMinutes: duration,
      attemptsLimit: attempts,
      marksPerQuestion: marks,
      negativeMark: negative,
      questionPaperDownload: Boolean(live) && questionPaperDownload,
      sections: [...new Set(validQuestions.map(question => question.section))],
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
    const images = await media.validate(typeof req.query.images === 'string' ? req.query.images.split(',') : []);
    if (!Buffer.isBuffer(req.body)) fail(400, 'Upload a PDF.');
    const pages = await processDocument(() => pageCount(req.body));
    const file = bucket.file(`books/${id}.pdf`);
    await file.save(req.body, { resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'private, no-store' } });
    try {
      await db.collection('books').doc(id).create({
        course: courseId, title, pages, images, subject: text(req.query.subject || 'General', 'Subject', 100),
        chapter: text(req.query.chapter || 'Chapter 1', 'Chapter', 120), createdAt: new Date().toISOString(),
      });
    } catch (error) {
      await file.delete({ ignoreNotFound: true });
      throw error;
    }
    res.status(201).json({ id, pages });
  });
  api.get('/admin/ebooks', async (_req, res) => {
    const [books, orders] = await Promise.all([queryCollection('ebooks'), queryCollection('ebookOrders')]);
    res.json(books.sort(byNewest).map(book => ({
      id: book.id, title: book.title, description: book.description, price: book.price,
      pages: book.pages, createdAt: book.createdAt,
      orders: orders.filter(order => order.ebook === book.id).length,
    })));
  });
  api.post('/admin/ebooks', raw, async (req, res) => {
    if (!Buffer.isBuffer(req.body)) fail(400, 'Upload a PDF.');
    const price = Number(req.query.price);
    if (!Number.isInteger(price) || price < 100 || price > 10_000_000) fail(422, 'Price must be ₹1–₹1,00,000.');
    const id = randomUUID();
    const pages = await processDocument(() => pageCount(req.body));
    const file = bucket.file(`ebooks/${id}.pdf`);
    await file.save(req.body, { resumable: false, contentType: 'application/pdf',
      metadata: { cacheControl: 'private, no-store' } });
    try {
      await db.collection('ebooks').doc(id).create({
        title: text(req.query.title, 'E-book title', 120),
        description: text(req.query.description, 'Description', 2000),
        price, pages, createdAt: new Date().toISOString(),
      });
    } catch (error) {
      await file.delete({ ignoreNotFound: true });
      throw error;
    }
    res.status(201).json({ id, pages });
  });
  api.delete('/admin/ebooks/:id', async (req, res) => {
    const book = await db.collection('ebooks').doc(req.params.id).get();
    if (!book.exists) fail(404, 'E-book not found.');
    const orders = await db.collection('ebookOrders').where('ebook', '==', req.params.id).limit(1).get();
    if (!orders.empty) fail(409, 'This e-book has purchase requests and cannot be deleted.');
    await Promise.all([book.ref.delete(), bucket.file(`ebooks/${req.params.id}.pdf`).delete({ ignoreNotFound: true })]);
    res.sendStatus(204);
  });
  api.get('/admin/payments', async (_req, res) => {
    const [courseOrders, ebookOrders] = await Promise.all([queryCollection('orders'), queryCollection('ebookOrders')]);
    const orders = courseOrders.sort((a, b) => {
      const pending = Number(a.paymentStatus !== 'pending') - Number(b.paymentStatus !== 'pending');
      return pending || String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));
    }).slice(0, 200);
    const courseRows = await Promise.all(orders.map(async order => {
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
        type: 'course',
      };
    }));
    const ebookRows = await Promise.all(ebookOrders.map(async order => {
      const [student, book] = await Promise.all([
        db.collection('students').doc(order.uid).get(),
        db.collection('ebooks').doc(order.ebook).get(),
      ]);
      return {id: order.id, amount: order.amount, reference: order.transactionRef, note: order.paymentNote,
        status: order.paymentStatus, submittedAt: order.submittedAt, reviewNote: order.reviewNote,
        name: value(student)?.name || 'Student', phone: value(student)?.phone,
        course: value(book)?.title || 'E-book', type: 'ebook'};
    }));
    res.json([...courseRows, ...ebookRows].sort((a, b) =>
      Number(a.status !== 'pending') - Number(b.status !== 'pending') ||
      String(b.submittedAt).localeCompare(String(a.submittedAt))).slice(0, 200));
  });
  api.post('/admin/payments/:id/approve', async (req, res) => {
    const orderRef = db.collection('orders').doc(req.params.id);
    const ebookRef = db.collection('ebookOrders').doc(req.params.id);
    const ref = (await orderRef.get()).exists ? orderRef : ebookRef;
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const order = value(snapshot);
      if (!order) fail(404, 'Payment request not found.');
      if (order.paymentStatus === 'approved') return;
      if (order.paymentStatus !== 'pending') fail(409, 'Only pending requests can be approved.');
      if (ref.id === orderRef.id && ref.path === orderRef.path) {
        const selected = value(await transaction.get(db.collection('courses').doc(order.course)));
        if (!selected) fail(404, 'Course not found.');
        requireActive(selected);
      } else {
        const selected = value(await transaction.get(db.collection('ebooks').doc(order.ebook)));
        if (!selected) fail(404, 'E-book not found.');
      }
      transaction.update(ref, {
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
    const ebookRef = db.collection('ebookOrders').doc(req.params.id);
    const ref = (await orderRef.get()).exists ? orderRef : ebookRef;
    const reviewNote = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!reviewNote || reviewNote.length > 500) fail(422, 'Enter a rejection reason (maximum 500 characters).');
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const order = value(snapshot);
      if (!order) fail(404, 'Payment request not found.');
      if (!['pending', 'approved'].includes(order.paymentStatus)) fail(409, 'This payment was already rejected.');
      const referralRef = order.creditsUsed ? db.collection('referrals').doc(order.uid) : null;
      if (referralRef) {
        const referral = value(await transaction.get(referralRef));
        transaction.set(referralRef, { credits: Number(referral?.credits || 0) + order.creditsUsed }, { merge: true });
      }
      transaction.update(ref, {
        payment: '',
        paymentStatus: 'rejected',
        creditsUsed: 0,
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
