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
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fail, importQuestions, mobile, pageCount, renderPage, validateQuestions } from './documents.js';
import { paymentReference, upiDetails, upiPaymentUri } from './manual-payments.js';

function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(422, `${label} is required (maximum ${max} characters).`);
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
    const width = 595;
    const height = 842;
    let page = pdf.addPage([width, height]);
    let y = 792;
    const addPage = () => {
      page = pdf.addPage([width, height]);
      y = 792;
    };
    const ensure = needed => { if (y - needed < 55) addPage(); };
    const wrap = (value, font, size, maxWidth) => {
      const words = String(value || '').split(/\s+/);
      const lines = [];
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
          lines.push(line);
          line = word;
        } else line = candidate;
      }

      async function resultDocument({student, attempt, course, test, rank}) {
        const pdf = await PDFDocument.create();
        const regular = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const page = pdf.addPage([595, 842]);
        const blue = rgb(.05, .34, .72);
        const light = rgb(.94, .97, 1);
        const muted = rgb(.35, .42, .52);
        page.drawRectangle({x: 0, y: 770, width: 595, height: 72, color: blue});
        page.drawText('MISSION SELECTION', {x: 38, y: 810, size: 17, font: bold, color: rgb(1, 1, 1)});
        page.drawText('TEST PERFORMANCE REPORT', {x: 38, y: 786, size: 10, font: bold, color: rgb(.82, .92, 1)});
        page.drawText(test.title, {x: 38, y: 738, size: 20, font: bold, color: rgb(.08, .13, .24)});
        page.drawText(`${student.name || 'Student'}  •  ${student.phone}`, {x: 38, y: 714, size: 10, font: regular, color: muted});
        const cards = [
          ['SCORE', `${attempt.score}/${attempt.max_marks || attempt.maxMarks || 0}`],
          ['RANK', rank ? `#${rank}` : '—'],
          ['ACCURACY', `${Math.round((attempt.correct / Math.max(attempt.total, 1)) * 100)}%`],
        ];
        cards.forEach(([label, value], index) => {
          const x = 38 + index * 177;
          page.drawRectangle({x, y: 630, width: 160, height: 58, color: light, borderColor: rgb(.78, .86, .95), borderWidth: 1});
          page.drawText(label, {x: x + 14, y: 667, size: 8, font: bold, color: muted});
          page.drawText(value, {x: x + 14, y: 642, size: 20, font: bold, color: blue});
        });
        page.drawText('PERFORMANCE SUMMARY', {x: 38, y: 592, size: 11, font: bold, color: blue});
        const stats = [['Correct', attempt.correct], ['Incorrect', attempt.wrong], ['Unattempted', attempt.unanswered]];
        page.drawRectangle({x: 38, y: 492, width: 519, height: 78, color: rgb(1, 1, 1), borderColor: rgb(.82, .88, .94), borderWidth: 1});
        stats.forEach(([label, value], index) => {
          const x = 65 + index * 165;
          page.drawText(String(value), {x, y: 536, size: 19, font: bold, color: blue});
          page.drawText(label, {x, y: 516, size: 9, font: regular, color: muted});
        });
        page.drawText('SECTION BREAKDOWN', {x: 38, y: 462, size: 11, font: bold, color: blue});
        page.drawRectangle({x: 38, y: 426, width: 519, height: 24, color: blue});
        [['Section', 52], ['Correct', 278], ['Wrong', 365], ['Unattempted', 438]].forEach(([text, x]) =>
          page.drawText(text, {x, y: 434, size: 8, font: bold, color: rgb(1, 1, 1)}));
        let y = 401;
        for (const section of attempt.sectionScores || []) {
          if (y < 65) break;
          page.drawText(String(section.section), {x: 52, y, size: 9, font: regular, color: rgb(.12, .16, .23)});
          page.drawText(String(section.correct), {x: 292, y, size: 9, font: regular});
          page.drawText(String(section.wrong), {x: 380, y, size: 9, font: regular});
          page.drawText(String(section.unanswered), {x: 465, y, size: 9, font: regular});
          page.drawLine({start: {x: 38, y: y - 7}, end: {x: 557, y: y - 7}, thickness: .5, color: rgb(.86, .9, .94)});
          y -= 26;
        }
        page.drawText(`Course: ${course.title}  •  Submitted: ${new Date(attempt.createdAt || attempt.created_at).toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})} IST`,
          {x: 38, y: 32, size: 8, font: regular, color: muted});
        return Buffer.from(await pdf.save());
      }

      async function receiptDocument({student, order, course}) {
        const pdf = await PDFDocument.create();
        const regular = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const page = pdf.addPage([595, 842]);
        const blue = rgb(.05, .34, .72);
        const muted = rgb(.38, .45, .54);
        page.drawText('MISSION SELECTION', {x: 38, y: 794, size: 17, font: bold, color: blue});
        page.drawText('Choose • Prepare • Achieve', {x: 38, y: 775, size: 8, font: regular, color: muted});
        page.drawText('PAYMENT RECEIPT', {x: 382, y: 785, size: 20, font: regular, color: rgb(.08, .13, .24)});
        page.drawText(`Receipt No.  MS-${order.id.slice(0, 8).toUpperCase()}`, {x: 38, y: 735, size: 10, font: bold});
        page.drawText(`Date  ${new Date(order.reviewed_at || order.reviewedAt || order.submitted_at || order.submittedAt).toLocaleDateString('en-IN', {timeZone: 'Asia/Kolkata'})}`,
          {x: 405, y: 735, size: 9, font: regular, color: muted});
        page.drawText('BILLED TO', {x: 38, y: 690, size: 8, font: bold, color: muted});
        page.drawText(student.name || 'Student', {x: 38, y: 668, size: 12, font: bold});
        page.drawText(student.phone, {x: 38, y: 648, size: 10, font: regular, color: muted});
        page.drawRectangle({x: 38, y: 500, width: 519, height: 104, color: rgb(.96, .98, 1), borderColor: rgb(.78, .86, .95), borderWidth: 1});
        page.drawText('PARTICULARS', {x: 55, y: 580, size: 8, font: bold, color: muted});
        page.drawText('AMOUNT', {x: 488, y: 580, size: 8, font: bold, color: muted});
        page.drawText(course.title, {x: 55, y: 545, size: 12, font: bold, color: rgb(.08, .13, .24)});
        page.drawText(`INR ${(order.amount / 100).toFixed(2)}`, {x: 470, y: 545, size: 12, font: bold, color: blue});
        page.drawLine({start: {x: 55, y: 525}, end: {x: 540, y: 525}, thickness: 1, color: rgb(.82, .88, .94)});
        page.drawText('Total Paid', {x: 410, y: 507, size: 10, font: bold});
        page.drawText(`INR ${(order.amount / 100).toFixed(2)}`, {x: 470, y: 507, size: 12, font: bold, color: blue});
        page.drawText('PAYMENT DETAILS', {x: 38, y: 450, size: 9, font: bold, color: muted});
        page.drawText(`Method  UPI / Manual Approval`, {x: 38, y: 425, size: 10, font: regular});
        page.drawText(`Transaction  ${order.transaction_ref || order.transactionRef || '—'}`, {x: 38, y: 402, size: 10, font: regular});
        page.drawText(`Status  APPROVED`, {x: 38, y: 379, size: 10, font: bold, color: rgb(.05, .45, .28)});
        page.drawText('Thank you for choosing Mission Selection.', {x: 38, y: 105, size: 11, font: bold, color: blue});
        page.drawText('This receipt is computer generated and valid after admin approval.', {x: 38, y: 85, size: 8, font: regular, color: muted});
        page.drawRectangle({x: 0, y: 0, width: 595, height: 48, color: blue});
        page.drawText('Mission Selection • Secure course access • https://mission-selection-ba819.web.app', {x: 38, y: 19, size: 8, font: regular, color: rgb(1,1,1)});
        return Buffer.from(await pdf.save());
      }
      if (line) lines.push(line);
      return lines;
    };
    page.drawText('MISSION SELECTION', {x: 42, y, size: 11, font: bold});
    y -= 28;
    for (const line of wrap(test.title, bold, 19, width - 84)) {
      page.drawText(line, {x: 42, y, size: 19, font: bold});
      y -= 24;
    }
    page.drawText(`Duration: ${test.durationMinutes || test.duration_minutes || 90} minutes   Marks: ${(test.marksPerQuestion || test.marks_per_question || 1)}`,
      {x: 42, y, size: 10, font: regular});
    y -= 18;
    page.drawText(`Negative marking: ${(test.negativeMark || test.negative_mark || 0)}   Candidate: ${phone}`,
      {x: 42, y, size: 10, font: regular});
    y -= 28;
    const questions = Array.isArray(test.questions) ? test.questions : JSON.parse(test.questions);
    questions.forEach((question, index) => {
      ensure(55);
      const heading = `Q${index + 1}. [${question.section || 'General'}]`;
      page.drawText(heading, {x: 42, y, size: 10, font: bold}); y -= 17;
      for (const line of wrap(question.prompt, regular, 11, width - 94)) {
        ensure(18);
        page.drawText(line, {x: 52, y, size: 11, font: regular}); y -= 16;
      }
      question.options.forEach((option, optionIndex) => {
        for (const line of wrap(`${String.fromCharCode(65 + optionIndex)}. ${option}`, regular, 10, width - 110)) {
          ensure(15);
          page.drawText(line, {x: 66, y, size: 10, font: regular}); y -= 14;
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
  const cards = [['SCORE', `${attempt.score}/${attempt.max_marks || attempt.maxMarks || 0}`],
    ['RANK', rank ? `#${rank}` : '—'], ['ACCURACY', `${Math.round(attempt.correct / Math.max(attempt.total, 1) * 100)}%`]];
  cards.forEach(([label, value], index) => {
    const x = 38 + index * 177;
    page.drawRectangle({x, y: 630, width: 160, height: 58, color: light, borderColor: rgb(.78,.86,.95), borderWidth: 1});
    page.drawText(label, {x: x + 14, y: 667, size: 8, font: bold, color: muted});
    page.drawText(value, {x: x + 14, y: 642, size: 20, font: bold, color: blue});
  });
  page.drawText('PERFORMANCE SUMMARY', {x: 38, y: 592, size: 11, font: bold, color: blue});
  [['Correct', attempt.correct], ['Incorrect', attempt.wrong], ['Unattempted', attempt.unanswered]].forEach(([label, value], index) => {
    const x = 65 + index * 165;
    page.drawText(String(value), {x, y: 536, size: 19, font: bold, color: blue});
    page.drawText(label, {x, y: 516, size: 9, font: regular, color: muted});
  });
  page.drawText('SECTION BREAKDOWN', {x: 38, y: 462, size: 11, font: bold, color: blue});
  page.drawRectangle({x: 38, y: 426, width: 519, height: 24, color: blue});
  [['Section',52], ['Correct',278], ['Wrong',365], ['Unattempted',438]].forEach(([text,x]) =>
    page.drawText(text, {x,y:434,size:8,font:bold,color:rgb(1,1,1)}));
  let y = 401;
  for (const section of attempt.sectionScores || []) {
    if (y < 65) break;
    page.drawText(String(section.section), {x:52,y,size:9,font:regular});
    page.drawText(String(section.correct), {x:292,y,size:9,font:regular});
    page.drawText(String(section.wrong), {x:380,y,size:9,font:regular});
    page.drawText(String(section.unanswered), {x:465,y,size:9,font:regular});
    y -= 26;
  }
  page.drawText(`Course: ${course.title}  •  ${new Date(attempt.createdAt || attempt.created_at).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})} IST`,
    {x:38,y:32,size:8,font:regular,color:muted});
  return Buffer.from(await pdf.save());
}

async function buildReceiptPdf({student, order, course}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595,842]);
  const blue = rgb(.05,.34,.72), muted = rgb(.38,.45,.54);
  page.drawText('MISSION SELECTION',{x:38,y:794,size:17,font:bold,color:blue});
  page.drawText('PAYMENT RECEIPT',{x:382,y:785,size:20,font:regular});
  page.drawText(`Receipt No.  MS-${order.id.slice(0,8).toUpperCase()}`,{x:38,y:735,size:10,font:bold});
  page.drawText(`Date  ${new Date(order.reviewed_at || order.reviewedAt || order.submitted_at || order.submittedAt).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'})}`,
    {x:405,y:735,size:9,font:regular,color:muted});
  page.drawText('BILLED TO',{x:38,y:690,size:8,font:bold,color:muted});
  page.drawText(student.name || 'Student',{x:38,y:668,size:12,font:bold});
  page.drawText(student.phone,{x:38,y:648,size:10,font:regular,color:muted});
  page.drawRectangle({x:38,y:500,width:519,height:104,color:rgb(.96,.98,1),borderColor:rgb(.78,.86,.95),borderWidth:1});
  page.drawText(course.title,{x:55,y:545,size:12,font:bold});
  page.drawText(`INR ${(order.amount/100).toFixed(2)}`,{x:470,y:545,size:12,font:bold,color:blue});
  page.drawText('Total Paid',{x:410,y:507,size:10,font:bold});
  page.drawText(`INR ${(order.amount/100).toFixed(2)}`,{x:470,y:507,size:12,font:bold,color:blue});
  page.drawText(`Method  UPI / Manual Approval`,{x:38,y:425,size:10,font:regular});
  page.drawText(`Transaction  ${order.transaction_ref || order.transactionRef || '—'}`,{x:38,y:402,size:10,font:regular});
  page.drawText('Status  APPROVED',{x:38,y:379,size:10,font:bold,color:rgb(.05,.45,.28)});
  page.drawRectangle({x:0,y:0,width:595,height:48,color:blue});
  page.drawText('Mission Selection • Secure course access',{x:38,y:19,size:8,font:regular,color:rgb(1,1,1)});
  return Buffer.from(await pdf.save());
}

export function createApp({ db, verifyToken, manualPayment = {}, firebase = {}, adminUids = [], adminPhones = [],
  trustLocalProxy = false,
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
  const adminMobiles = new Set(adminPhones);
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
    req.user = { ...user, admin: admins.has(user.uid) || adminMobiles.has(user.phone) };
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
  const owns = (uid, id) => one("SELECT 1 FROM orders WHERE uid=? AND course=? AND payment IS NOT NULL AND payment!=''", uid, id);
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
  api.get('/courses', (_req, res) => res.json(all(`SELECT id, title, description, price,
    downloads_enabled AS downloadsEnabled FROM courses ORDER BY rowid DESC`)));
  api.get('/ebooks', (_req, res) => res.json(all(
    'SELECT id, title, description, price, pages, created_at AS createdAt FROM ebooks ORDER BY rowid DESC')));
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
    if (req.query.download === '1') {
      const selectedCourse = one('SELECT downloads_enabled FROM courses WHERE id=?', video.course);
      if (!selectedCourse?.downloads_enabled) fail(403, 'Downloads are disabled for this course.');
      res.attachment(`${video.title.replace(/[^\w .-]+/g, '_')}.${videoTypes[video.type] || 'mp4'}`);
    }
    res.sendFile(videoPath(video.id), { headers: { 'Content-Type': video.type } });
  });
  api.use(authLimit, login);
  api.get('/me', (req, res) => {
    const { uid, phone, admin } = req.user;
    const { name, exam_preference: examPreference } = one('SELECT name, exam_preference FROM students WHERE uid=?', uid);
    res.json({ uid, name, phone, admin, examPreference,
      examPreferences: examPreference ? examPreference.split(',').map(item => item.trim()).filter(Boolean) : [],
      purchases: all("SELECT course FROM orders WHERE uid=? AND payment IS NOT NULL AND payment!=''", uid).map(p => p.course) });
  });
  api.put('/me', (req, res) => {
    const current = one('SELECT name, exam_preference FROM students WHERE uid=?', req.user.uid);
    const name = req.body?.name === undefined ? current.name : text(req.body.name, 'Name', 100);
    const selectedExams = req.body?.examPreferences === undefined ?
      (current.exam_preference ? current.exam_preference.split(',').map(item => item.trim()).filter(Boolean) : []) :
      examPreferences(req.body.examPreferences);
    const examPreference = selectedExams.join(',');
    run('UPDATE students SET name=?, exam_preference=? WHERE uid=?', name, examPreference, req.user.uid);
    res.json({name, examPreference, examPreferences: selectedExams});
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
    const { id, downloads_enabled: downloadsEnabled } = course(req.params.id);
    requirePurchase(req, id);
    res.json({
      downloadsEnabled: Boolean(downloadsEnabled),
      tests: all(`SELECT t.id, t.title, t.live, t.starts_at AS startsAt, t.expires_at AS expiresAt,
        t.duration_minutes AS durationMinutes, t.question_paper_download AS questionPaperDownload,
        EXISTS(SELECT 1 FROM attempts a WHERE a.test=t.id AND a.uid=?) AS completedAttempt
        FROM tests t WHERE t.course=? ORDER BY t.rowid`, req.user.uid, id),
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
  api.get('/ebooks/:id/payment', (req, res) => {
    const book = one('SELECT id, title, price FROM ebooks WHERE id=?', req.params.id);
    if (!book) fail(404, 'E-book not found.');
    const order = one(`SELECT id, amount, payment_status AS status, transaction_ref AS reference,
      payment_note AS note, review_note AS reviewNote, submitted_at AS submittedAt
      FROM ebook_orders WHERE uid=? AND ebook=?`, req.user.uid, book.id);
    res.json({ amount: book.price, payment: { ...runtimePayment(), qr: '/api/payment-qr' }, order });
  });
  api.post('/ebooks/:id/payment', paymentLimit, (req, res) => {
    const book = one('SELECT id, title, price FROM ebooks WHERE id=?', req.params.id);
    if (!book) fail(404, 'E-book not found.');
    const existing = one('SELECT id, payment_status FROM ebook_orders WHERE uid=? AND ebook=?', req.user.uid, book.id);
    if (existing && ['pending', 'approved'].includes(existing.payment_status)) {
      if (existing.payment_status === 'approved') fail(409, 'You already own this e-book.');
      fail(409, 'A payment request is already waiting for admin review.');
    }
    if (!runtimePayment().configured) fail(503, 'Payment details are not configured.');
    const reference = paymentReference(req.body?.reference);
    if (!reference) fail(422, 'Enter a valid UPI transaction reference (4–80 characters).');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    const id = existing?.id || randomUUID();
    const submittedAt = new Date().toISOString();
    run(`INSERT INTO ebook_orders (id, uid, ebook, amount, transaction_ref, payment_note, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uid, ebook) DO UPDATE SET
      amount=excluded.amount, transaction_ref=excluded.transaction_ref, payment_note=excluded.payment_note,
      payment='', payment_status='pending', review_note='', submitted_at=excluded.submitted_at`,
    id, req.user.uid, book.id, book.price, reference, note, submittedAt);
    res.status(201).json({ id, amount: book.price, status: 'pending', reference, submittedAt });
  });
  api.get('/ebook-orders', (req, res) => res.json(all(
    `SELECT id, ebook, amount, payment_status AS status, review_note AS reviewNote,
      submitted_at AS submittedAt FROM ebook_orders WHERE uid=? ORDER BY submitted_at DESC`, req.user.uid)));
  function ownedEbook(req, id) {
    const book = one('SELECT * FROM ebooks WHERE id=?', id);
    if (!book) fail(404, 'E-book not found.');
    if (!req.user.admin && !one("SELECT 1 FROM ebook_orders WHERE uid=? AND ebook=? AND payment_status='approved' AND payment<>''",
      req.user.uid, id)) fail(403, 'Purchase and wait for approval to unlock this e-book.');
    return book;
  }
  api.get('/ebooks/:id/pages/:page', async (req, res) => {
    const book = ownedEbook(req, req.params.id);
    const page = Number(req.params.page);
    if (!Number.isInteger(page) || page < 1 || page > book.pages) fail(404, 'Page not found.');
    res.type('png').send(await processDocument(() => renderPage(Buffer.from(book.pdf), page, req.user.phone)));
  });
  api.get('/ebooks/:id/download', async (req, res) => {
    const book = ownedEbook(req, req.params.id);
    const pdf = await protectedPdf(Buffer.from(book.pdf), book.pages, req.user.phone);
    res.attachment(`${book.title}-protected.pdf`).type('pdf').send(pdf);
  });

  function test(id) {
    const row = one('SELECT * FROM tests WHERE id=?', id);
    if (!row) fail(404, 'Test not found.');
    return row;
  }
  api.get('/tests/:id', (req, res) => {
    const row = test(req.params.id);
    requirePurchase(req, row.course);
    const attempts = one('SELECT COUNT(*) AS count FROM attempts WHERE uid=? AND test=?', req.user.uid, row.id)?.count || 0;
    const now = Date.now();
    const starts = Date.parse(row.starts_at);
    const expires = Date.parse(row.expires_at);
    if (row.live && Number.isFinite(starts) && now < starts) fail(423, `This live test opens on ${new Date(starts).toLocaleString('en-IN')}.`);
    const limited = row.live && (!Number.isFinite(expires) || now <= expires);
    const attemptsLimit = row.live ? (row.attempts_limit || 2) : Infinity;
    if (limited && attempts >= attemptsLimit) fail(409,
      `You have used ${attemptsLimit} attempts. Unlimited attempts open after the live window ends.`);
    const sections = [...new Set(JSON.parse(row.questions).map(question => question.section || 'General'))];
    res.json({
      title: row.title, live: Boolean(row.live), startsAt: row.starts_at, expiresAt: row.expires_at,
      durationMinutes: row.duration_minutes || 90, attempts, attemptsLimit: row.live ? (row.attempts_limit || 2) : 0,
      limited: Boolean(limited), marksPerQuestion: row.marks_per_question || 1, negativeMark: row.negative_mark || 0, sections,
      questionPaperDownload: Boolean(row.question_paper_download), completedAttempt: attempts > 0,
      questions: JSON.parse(row.questions).map(({ prompt, options, section }) => ({ prompt, options, section: section || 'General' })),
    });
  });
  api.post('/tests/:id/start', (req, res) => {
    const row = test(req.params.id);
    requirePurchase(req, row.course);
    const attempts = one('SELECT COUNT(*) AS count FROM attempts WHERE uid=? AND test=?', req.user.uid, row.id)?.count || 0;
    const nowMs = Date.now();
    const starts = Date.parse(row.starts_at);
    const expires = Date.parse(row.expires_at);
    if (row.live && Number.isFinite(starts) && nowMs < starts) fail(423, 'This live test has not opened yet.');
    const limited = row.live && (!Number.isFinite(expires) || nowMs <= expires);
    const attemptsLimit = row.live ? (row.attempts_limit || 2) : Infinity;
    if (limited && attempts >= attemptsLimit) fail(409,
      `You have used ${attemptsLimit} attempts. Unlimited attempts open after the live window ends.`);
    const now = new Date().toISOString();
    const active = one('SELECT id, started_at FROM exam_sessions WHERE uid=? AND test=? AND active=1',
      req.user.uid, row.id);
    if (active) {
      const saved = one('SELECT answers, marked FROM exam_sessions WHERE id=?', active.id);
      return res.json({id: active.id, startedAt: active.started_at,
        answers: JSON.parse(saved.answers || '[]'), marked: JSON.parse(saved.marked || '[]')});
    }
    const id = randomUUID();
    run('INSERT INTO exam_sessions (id, uid, test, started_at) VALUES (?, ?, ?, ?)', id, req.user.uid, row.id, now);
    res.status(201).json({ id, startedAt: now });
  });
  api.put('/tests/:id/progress', (req, res) => {
    const session = one('SELECT id FROM exam_sessions WHERE uid=? AND test=? AND active=1', req.user.uid, req.params.id);
    if (!session) fail(409, 'Start the test before saving progress.');
    run('UPDATE exam_sessions SET answers=?, marked=? WHERE id=?', JSON.stringify(req.body?.answers || []),
      JSON.stringify(req.body?.marked || []), session.id);
    res.sendStatus(204);
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
    const session = one('SELECT * FROM exam_sessions WHERE uid=? AND test=? AND active=1', req.user.uid, row.id);
    if (!session) fail(409, 'Start the test before submitting.');
    const maxSeconds = (row.duration_minutes || 90) * 60;
    const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(session.started_at)) / 1000));
    const timedOut = elapsed > maxSeconds;
    const marks = row.marks_per_question || 1;
    const penalty = row.negative_mark || 0;
    const correct = questions.filter((q, i) => answers[i] === q.answer).length;
    const wrong = questions.filter((q, i) => answers[i] !== null && answers[i] !== q.answer).length;
    const score = Math.max(0, correct * marks - wrong * penalty);
    const total = questions.length * marks;
    const sectionScores = Object.values(questions.reduce((groups, question, index) => {
      const name = question.section || 'General';
      const current = groups[name] ||= {section: name, correct: 0, wrong: 0, unanswered: 0, score: 0, total: 0};
      current.total += marks;
      if (answers[index] === null) current.unanswered++;
      else if (answers[index] === question.answer) { current.correct++; current.score += marks; }
      else { current.wrong++; current.score -= penalty; }
      current.score = Math.max(0, current.score);
      return groups;
    }, {}));
    const result = { score, total, correct, wrong, unanswered: questions.length - correct - wrong,
      maxMarks: total, negative: penalty, elapsedSeconds: Math.min(elapsed, maxSeconds),
      sectionScores, timedOut, questionPaperDownload: Boolean(row.live && row.question_paper_download) };
    const attemptId = randomUUID();
    run('INSERT INTO attempts (id, uid, course, test, title, score, total, created_at, answers, max_marks, negative, elapsed_seconds, section_scores) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      attemptId, req.user.uid, row.course, row.id, row.title, score, questions.length, new Date().toISOString(),
      JSON.stringify(answers), total, wrong * penalty, elapsed, JSON.stringify(sectionScores));
    run('UPDATE exam_sessions SET active=0 WHERE id=?', session.id);
    res.json({...result, attemptId});
  });
  api.get('/attempts/:id/result.pdf', async (req, res) => {
    const attempt = one(`SELECT a.*, t.title AS testTitle, t.questions, t.duration_minutes, c.title AS courseTitle
      FROM attempts a JOIN tests t ON t.id=a.test JOIN courses c ON c.id=a.course
      WHERE a.id=? AND a.uid=?`, req.params.id, req.user.uid);
    if (!attempt) fail(404, 'Test result not found.');
    const answers = JSON.parse(attempt.answers || '[]');
    const questions = JSON.parse(attempt.questions || '[]');
    attempt.correct = questions.filter((question, index) => answers[index] === question.answer).length;
    attempt.wrong = questions.filter((question, index) => answers[index] !== null && answers[index] !== question.answer).length;
    attempt.unanswered = questions.length - attempt.correct - attempt.wrong;
    attempt.sectionScores = JSON.parse(attempt.section_scores || '[]');
    const student = one('SELECT name, phone FROM students WHERE uid=?', req.user.uid);
    const rank = all('SELECT uid, MAX(score) AS score FROM attempts WHERE test=? GROUP BY uid ORDER BY score DESC, MIN(elapsed_seconds) ASC',
      attempt.test).findIndex(row => row.uid === req.user.uid) + 1;
    const pdf = await buildResultPdf({student, attempt: {...attempt, createdAt: attempt.created_at},
      test: {title: attempt.testTitle}, course: {title: attempt.courseTitle}, rank});
    res.type('pdf').attachment(`${attempt.testTitle}-result.pdf`).send(pdf);
  });
  api.get('/courses/:id/receipt.pdf', async (req, res) => {
    const order = one(`SELECT * FROM orders WHERE uid=? AND course=? AND payment IS NOT NULL AND payment!=''`, req.user.uid, req.params.id);
    if (!order) fail(404, 'Approved purchase receipt not found.');
    const selectedCourse = course(req.params.id);
    const student = one('SELECT name, phone FROM students WHERE uid=?', req.user.uid);
    const pdf = await buildReceiptPdf({student, order, course: selectedCourse});
    res.type('pdf').attachment(`${selectedCourse.title}-receipt.pdf`).send(pdf);
  });
  api.get('/receipts', (req, res) => {
    res.json(all(`SELECT o.id, o.course, c.title AS title, o.amount, o.transaction_ref AS reference,
      o.reviewed_at AS reviewedAt, o.submitted_at AS submittedAt
      FROM orders o JOIN courses c ON c.id=o.course
      WHERE o.uid=? AND o.payment IS NOT NULL AND o.payment!=''
      ORDER BY COALESCE(NULLIF(o.reviewed_at,''), o.submitted_at) DESC`, req.user.uid));
  });
  api.get('/tests/:id/question-paper.pdf', async (req, res) => {
    const row = test(req.params.id);
    requirePurchase(req, row.course);
    if (!row.live) fail(404, 'Question paper download is available for live tests only.');
    if (!row.question_paper_download) fail(403, 'Question paper download is disabled by the admin.');
    if (!one('SELECT 1 FROM attempts WHERE uid=? AND test=?', req.user.uid, row.id)) {
      fail(403, 'Complete your first test attempt before downloading the question paper.');
    }
    const pdf = await questionPaperPdf({...row, questions: JSON.parse(row.questions)}, req.user.phone);
    res.type('pdf').attachment(`${row.title.replace(/[^a-z0-9 ._-]+/gi, '_')}-question-paper.pdf`).send(pdf);
  });
  api.get('/tests/:id/leaderboard', (req, res) => {
    const row = test(req.params.id);
    requirePurchase(req, row.course);
    if (!row.live) fail(404, 'Leaderboard is available for live tests only.');
    const expires = Date.parse(row.expires_at);
    if (!Number.isFinite(expires) || Date.now() < expires) {
      fail(423, 'The leaderboard will unlock when the live test window ends.');
    }
    const attempts = all(`SELECT a.uid, a.score, a.max_marks AS maxMarks, a.elapsed_seconds AS elapsedSeconds,
      a.created_at AS createdAt, COALESCE(NULLIF(s.name, ''), 'Student') AS name
      FROM attempts a JOIN students s ON s.uid=a.uid WHERE a.test=? AND a.created_at<=? ORDER BY a.score DESC,
      a.elapsed_seconds ASC, a.created_at ASC`, row.id, row.expires_at);
    const best = new Map();
    for (const attempt of attempts) {
      if (!best.has(attempt.uid)) best.set(attempt.uid, attempt);
    }
    const ranked = [...best.values()].sort((a, b) => b.score - a.score ||
      a.elapsedSeconds - b.elapsedSeconds || String(a.createdAt).localeCompare(String(b.createdAt)));
    let previous = null;
    const rows = ranked.map((entry, index) => {
      if (!previous || entry.score !== previous.score || entry.elapsedSeconds !== previous.elapsedSeconds) {
        previous = {...entry, rank: index + 1};
      }
      return {
        rank: previous.rank, name: entry.uid === req.user.uid ? entry.name : `${entry.name.slice(0, 1)}.` || 'Student',
        score: entry.score, maxMarks: entry.maxMarks, elapsedSeconds: entry.elapsedSeconds,
        attempts: attempts.filter(item => item.uid === entry.uid).length,
        isCurrentUser: entry.uid === req.user.uid,
      };
    });
    const mine = rows.find(entry => entry.isCurrentUser) || null;
    res.json({title: row.title, expiresAt: row.expires_at, participants: rows.length, rows, mine});
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
    const paymentNotices = orders.map(order => ({
      id: `payment-${order.id}`,
      title: order.status === 'approved' ? `${order.title || 'Course'} is unlocked` :
        order.status === 'rejected' ? `${order.title} payment needs attention` :
        `${order.title} payment is under review`,
      body: order.status === 'rejected' ? order.reviewNote : order.status === 'approved' ?
        'Your mission, tests and books are ready.' : 'The admin is verifying your UPI transaction.',
      href: `#course/${order.course}`,
      date: order.date,
      unread: order.status === 'pending',
    }));
    const testNotices = all(`SELECT t.id, t.title, t.starts_at AS startsAt, t.expires_at AS expiresAt, t.course
      FROM tests t JOIN orders o ON o.course=t.course
      WHERE t.live=1 AND o.uid=? AND o.payment IS NOT NULL AND o.payment!=''
        AND (t.expires_at='' OR datetime(t.expires_at)>datetime('now','localtime'))
      ORDER BY t.starts_at LIMIT 20`, req.user.uid).map(test => ({
      id: `live-test-${test.id}`,
      title: `Live mock test: ${test.title}`,
      body: `Scheduled ${new Date(test.startsAt).toLocaleString('en-IN')}.`,
      href: `#course/${test.course}`,
      date: test.startsAt,
      unread: Date.parse(test.startsAt) > Date.now(),
    }));
    res.json([...testNotices, ...paymentNotices].sort((a, b) => String(b.date).localeCompare(String(a.date))));
  });
  api.get('/content/:kind', (req, res) => {
    if (!['current-affairs', 'pyqs', 'syllabus', 'free-tests'].includes(req.params.kind)) fail(404, 'Content not found.');
    res.json(all(`SELECT id, kind, title, summary, body, created_at AS createdAt,
      published_at AS publishedAt FROM resources WHERE kind=?
      ORDER BY CASE WHEN published_at='' THEN created_at ELSE published_at END DESC`,
      req.params.kind));
  });
  api.get('/books/:id/pages/:page', async (req, res) => {
    const book = one(`SELECT b.course, b.pages, c.downloads_enabled FROM books b
      JOIN courses c ON c.id=b.course WHERE b.id=?`, req.params.id);
    if (!book) fail(404, 'Book not found.');
    requirePurchase(req, book.course);
    const page = Number(req.params.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > book.pages) fail(404, 'Page not found.');
    const png = await processDocument(() => renderPage(Buffer.from(one('SELECT pdf FROM books WHERE id=?', req.params.id).pdf), page, req.user.phone));
    res.type('png').send(png);
  });
  api.get('/books/:id/pages/:page/download', async (req, res) => {
    const book = one(`SELECT b.id, b.course, b.title, b.pages, b.pdf, c.downloads_enabled
      FROM books b JOIN courses c ON c.id=b.course WHERE b.id=?`, req.params.id);
    if (!book) fail(404, 'Book not found.');
    requirePurchase(req, book.course);
    if (!book.downloads_enabled) fail(403, 'Downloads are disabled for this course.');
    const page = Number(req.params.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > book.pages) fail(404, 'Page not found.');
    const png = await processDocument(() => renderPage(Buffer.from(book.pdf), page, req.user.phone));
    res.attachment(`${book.title}-page-${page}.png`).type('png').send(png);
  });
  api.get('/books/:id/download', async (req, res) => {
    const book = one(`SELECT b.id, b.course, b.title, b.pages, b.pdf, c.downloads_enabled
      FROM books b JOIN courses c ON c.id=b.course WHERE b.id=?`, req.params.id);
    if (!book) fail(404, 'Book not found.');
    requirePurchase(req, book.course);
    if (!book.downloads_enabled) fail(403, 'Downloads are disabled for this course.');
    const pdf = await protectedPdf(Buffer.from(book.pdf), book.pages, req.user.phone);
    res.attachment(`${book.title}-protected.pdf`).type('pdf').send(pdf);
  });
  api.get('/videos/:id/link', (req, res) => {
    const video = one('SELECT id, course, title, type FROM chapter_videos WHERE id=?', req.params.id);
    if (!video) fail(404, 'Video not found.');
    requirePurchase(req, video.course);
    if (req.query.download === '1' &&
        !one('SELECT downloads_enabled FROM courses WHERE id=?', video.course)?.downloads_enabled) {
      fail(403, 'Downloads are disabled for this course.');
    }
    const expires = String(Math.floor(Date.now() / 1000) + VIDEO_LINK_SECONDS);
    const query = new URLSearchParams({ uid: req.user.uid, expires, signature: videoSignature(video.id, req.user.uid, expires) });
    if (req.query.download === '1') query.set('download', '1');
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
  api.get('/admin/analytics', (_req, res) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    res.json({
      students: one('SELECT COUNT(*) AS count FROM students').count,
      courses: one('SELECT COUNT(*) AS count FROM courses').count,
      purchases: one("SELECT COUNT(*) AS count FROM orders WHERE payment IS NOT NULL AND payment!=''").count +
        one("SELECT COUNT(*) AS count FROM ebook_orders WHERE payment<>''").count,
      revenue: one("SELECT COALESCE(SUM(amount),0) AS amount FROM orders WHERE payment IS NOT NULL AND payment!=''").amount +
        one("SELECT COALESCE(SUM(amount),0) AS amount FROM ebook_orders WHERE payment<>''").amount,
      attempts24h: one('SELECT COUNT(*) AS count FROM attempts WHERE created_at>=?', since).count,
      attempts: one('SELECT COUNT(*) AS count FROM attempts').count,
      liveTests: all(`SELECT t.id, t.title, t.starts_at AS startsAt, t.expires_at AS expiresAt,
        COUNT(DISTINCT a.uid) AS students, COUNT(a.id) AS attempts, COALESCE(ROUND(AVG(a.score * 100.0 / NULLIF(a.max_marks,0)),1),0) AS average
        FROM tests t LEFT JOIN attempts a ON a.test=t.id WHERE t.live=1
        GROUP BY t.id ORDER BY t.starts_at DESC LIMIT 100`),
    });
  });
  api.get('/admin/tests/:id/results', (req, res) => {
    const row = test(req.params.id);
    res.json({
      test: {id: row.id, title: row.title, live: Boolean(row.live), startsAt: row.starts_at, expiresAt: row.expires_at,
        durationMinutes: row.duration_minutes, attemptsLimit: row.attempts_limit},
      results: all(`SELECT a.id, a.uid, s.name, s.phone, a.score, a.total, a.max_marks AS maxMarks,
        a.elapsed_seconds AS elapsedSeconds, a.section_scores AS sectionScores, a.created_at AS createdAt
        FROM attempts a JOIN students s ON s.uid=a.uid WHERE a.test=? ORDER BY a.created_at DESC`, row.id)
        .map(result => ({...result, sectionScores: JSON.parse(result.sectionScores || '[]')})),
    });
  });
  api.get('/admin/tests/:id/results.pdf', async (req, res) => {
    const row = test(req.params.id);
    const results = all(`SELECT a.score, a.max_marks AS maxMarks, a.created_at AS createdAt,
      s.name, s.phone FROM attempts a JOIN students s ON s.uid=a.uid WHERE a.test=? ORDER BY a.created_at DESC`, row.id);
    const ranked = results;
    const best = new Map();
    for (const result of ranked.sort((a, b) => b.score - a.score || String(a.createdAt).localeCompare(String(b.createdAt)))) {
      if (!best.has(result.phone)) best.set(result.phone, result);
    }
    const finalRows = [...best.values()].map((result, index) => ({...result, rank: index + 1}));
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595, 842]);
    const blue = rgb(.03, .2, .42);
    page.drawRectangle({x: 36, y: 785, width: 523, height: 30, color: blue});
    page.drawText(`${row.title.toUpperCase()} — RESULT BY MISSION SELECTION`, {x: 47, y: 795, size: 12, font: bold, color: rgb(1,1,1)});
    page.drawRectangle({x: 36, y: 750, width: 523, height: 25, color: rgb(.98,.71,.47)});
    [['Rank', 48], ['Name', 105], ['Marks', 500]].forEach(([label, x]) =>
      page.drawText(label, {x, y: 758, size: 9, font: bold}));
    let y = 725;
    for (const result of finalRows) {
      if (y < 52) {
        page = pdf.addPage([595, 842]); y = 792;
      }
      const shade = result.rank % 2 ? rgb(.94, .98, .96) : rgb(1, 1, 1);
      page.drawRectangle({x: 36, y: y - 8, width: 523, height: 24, color: shade, borderColor: rgb(.15,.25,.35), borderWidth: .35});
      page.drawText(String(result.rank), {x: 51, y, size: 9, font: regular});
      page.drawText(result.name || 'Student', {x: 105, y, size: 9, font: regular});
      page.drawText(`${result.score} / ${result.maxMarks || 0}`, {x: 480, y, size: 9, font: bold});
      y -= 25;
    }
    page.drawText(`Generated ${new Date().toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})} IST • Admin confidential`, {x: 36, y: 24, size: 7, font: regular, color: rgb(.35,.4,.45)});
    res.type('pdf').attachment(`${row.title}-results.pdf`).send(Buffer.from(await pdf.save()));
  });
  api.get('/admin/payments/:id/receipt.pdf', async (req, res) => {
    const order = one(`SELECT o.*, c.title AS courseTitle FROM orders o JOIN courses c ON c.id=o.course WHERE o.id=?`, req.params.id);
    if (!order) fail(404, 'Payment request not found.');
    if (!order.payment || order.payment_status !== 'approved') fail(403, 'Receipt is available only for approved payments.');
    const student = one('SELECT name, phone FROM students WHERE uid=?', order.uid);
    const pdf = await buildReceiptPdf({student, order, course: {title: order.courseTitle}});
    res.type('pdf').attachment(`${order.courseTitle}-receipt.pdf`).send(pdf);
  });
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
    const { title, questions, live, startsAt, expiresAt, durationMinutes, questionPaperDownload = false,
      attemptsLimit = 2, marksPerQuestion = 1, negativeMark = 0 } = req.body ?? {};
    let scheduled = '';
    let duration = 0;
    duration = durationMinutes === undefined ? 90 : durationMinutes;
    if (!Number.isInteger(duration) || duration < 10 || duration > 300) {
      fail(422, 'A test needs a duration from 10–300 minutes.');
    }
    if (live) {
      const scheduledDate = istIso(startsAt, 'Live start time');
      scheduled = scheduledDate;
    }
    const expires = live ? istIso(expiresAt, 'Live expiry time') : '';
    if (live && (Number.isNaN(Date.parse(expires)) || Date.parse(expires) <= Date.parse(scheduled) ||
        !Number.isInteger(attemptsLimit) || attemptsLimit < 1 || attemptsLimit > 10)) {
      fail(422, 'Live expiry must be after the start time, with 1–10 attempts allowed.');
    }
    if (!Number.isFinite(marksPerQuestion) || marksPerQuestion <= 0 || marksPerQuestion > 10 ||
        !Number.isFinite(negativeMark) || negativeMark < 0 || negativeMark > marksPerQuestion) {
      fail(422, 'Enter valid marks per question and negative marking.');
    }
    const parsedQuestions = validateQuestions(questions);
    const sections = [...new Set(parsedQuestions.map(question => question.section || 'General'))];
    if (typeof questionPaperDownload !== 'boolean') fail(422, 'Choose a valid question paper download option.');
    run(`INSERT INTO tests (id, course, title, questions, created_at, live, starts_at, duration_minutes,
      expires_at, attempts_limit, marks_per_question, negative_mark, sections, question_paper_download)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, courseId, text(title, 'Title', 120),
    JSON.stringify(parsedQuestions), new Date().toISOString(), live ? 1 : 0, scheduled, live ? duration : durationMinutes || 90,
    expires, live ? attemptsLimit : 0, marksPerQuestion, negativeMark, JSON.stringify(sections),
    live && questionPaperDownload ? 1 : 0);
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
  api.get('/admin/ebooks', (_req, res) => res.json(all(
    `SELECT id, title, description, price, pages, created_at AS createdAt,
      (SELECT COUNT(*) FROM ebook_orders o WHERE o.ebook=ebooks.id) AS orders
      FROM ebooks ORDER BY rowid DESC`)));
  api.post('/admin/ebooks', raw, async (req, res) => {
    if (!Buffer.isBuffer(req.body)) fail(400, 'Upload a PDF.');
    const pages = await processDocument(() => pageCount(req.body));
    const id = randomUUID();
    run('INSERT INTO ebooks (id, title, description, price, pages, pdf, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, text(req.query.title, 'E-book title', 120), text(req.query.description, 'Description', 2000),
      priceInput(Number(req.query.price)), pages, req.body, new Date().toISOString());
    res.status(201).json({ id, pages });
  });
  api.delete('/admin/ebooks/:id', (req, res) => {
    const book = one('SELECT 1 FROM ebooks WHERE id=?', req.params.id);
    if (!book) fail(404, 'E-book not found.');
    if (one('SELECT 1 FROM ebook_orders WHERE ebook=?', req.params.id)) {
      fail(409, 'This e-book has purchase requests and cannot be deleted.');
    }
    run('DELETE FROM ebooks WHERE id=?', req.params.id);
    res.sendStatus(204);
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
    const courses = all(`SELECT o.id, o.amount, o.transaction_ref AS reference, o.payment_note AS note,
      o.payment_status AS status, o.submitted_at AS submittedAt, o.review_note AS reviewNote,
      COALESCE(NULLIF(s.name, ''), 'Student') AS name, s.phone, c.title AS course, 'course' AS type
      FROM orders o JOIN students s ON s.uid=o.uid JOIN courses c ON c.id=o.course
      ORDER BY CASE WHEN o.payment_status='pending' THEN 0 ELSE 1 END, o.submitted_at DESC LIMIT 200`);
    const ebooks = all(`SELECT o.id, o.amount, o.transaction_ref AS reference, o.payment_note AS note,
      o.payment_status AS status, o.submitted_at AS submittedAt, o.review_note AS reviewNote,
      COALESCE(NULLIF(s.name, ''), 'Student') AS name, s.phone, b.title AS course, 'ebook' AS type
      FROM ebook_orders o JOIN students s ON s.uid=o.uid JOIN ebooks b ON b.id=o.ebook
      ORDER BY CASE WHEN o.payment_status='pending' THEN 0 ELSE 1 END, o.submitted_at DESC LIMIT 200`);
    res.json([...courses, ...ebooks].sort((a, b) =>
      Number(a.status !== 'pending') - Number(b.status !== 'pending') ||
      String(b.submittedAt).localeCompare(String(a.submittedAt))).slice(0, 200));
  });
  api.post('/admin/payments/:id/approve', (req, res) => {
    const courseOrder = one('SELECT id, payment_status FROM orders WHERE id=?', req.params.id);
    const ebookOrder = one('SELECT id, payment_status FROM ebook_orders WHERE id=?', req.params.id);
    const order = courseOrder || ebookOrder;
    if (!order) fail(404, 'Payment request not found.');
    if (order.payment_status === 'approved') return res.sendStatus(204);
    if (order.payment_status !== 'pending') fail(409, 'Only pending requests can be approved.');
    const reviewedAt = new Date().toISOString();
    run(`UPDATE ${courseOrder ? 'orders' : 'ebook_orders'} SET payment=?, payment_status='approved',
      reviewed_at=?, reviewed_by=?, review_note='' WHERE id=? AND payment_status='pending'`,
    `manual:${order.id}`, reviewedAt, req.user.uid, order.id);
    res.sendStatus(204);
  });
  api.post('/admin/payments/:id/reject', (req, res) => {
    const courseOrder = one('SELECT id, uid, payment_status, credits_used FROM orders WHERE id=?', req.params.id);
    const ebookOrder = one(`SELECT id, uid, payment_status, 0 AS credits_used
      FROM ebook_orders WHERE id=?`, req.params.id);
    const order = courseOrder || ebookOrder;
    if (!order) fail(404, 'Payment request not found.');
    if (!['pending', 'approved'].includes(order.payment_status)) fail(409, 'This payment was already rejected.');
    const reviewNote = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!reviewNote || reviewNote.length > 500) fail(422, 'Enter a rejection reason (maximum 500 characters).');
    if (order.credits_used) run('UPDATE referrals SET credits=credits+? WHERE uid=?',
      order.credits_used, order.uid);
    run(`UPDATE ${courseOrder ? 'orders' : 'ebook_orders'} SET payment='', payment_status='rejected',
      ${courseOrder ? 'credits_used=0, ' : ''}reviewed_at=?, reviewed_by=?, review_note=?
      WHERE id=? AND payment_status IN ('pending','approved')`,
    new Date().toISOString(), req.user.uid, reviewNote, order.id);
    res.sendStatus(204);
  });
  const priceInput = value => {
    if (!Number.isInteger(value) || value < 100 || value > 10_000_000) fail(422, 'Price must be ₹1–₹1,00,000.');
    return value;
  };
  api.get('/admin/published', (_req, res) => {
    const tests = all(`SELECT t.id, t.course, c.title AS courseTitle, t.title, t.questions, t.created_at AS createdAt,
      t.duration_minutes AS durationMinutes, t.marks_per_question AS marksPerQuestion, t.negative_mark AS negativeMark,
      (SELECT COUNT(*) FROM attempts a WHERE a.test=t.id) AS attempts, t.live,
      t.question_paper_download AS questionPaperDownload
      FROM tests t JOIN courses c ON c.id=t.course ORDER BY t.created_at DESC, t.rowid DESC`)
      .map(test => ({ ...test, questions: JSON.parse(test.questions) }));
    res.json({
      courses: all(`SELECT c.id, c.title, c.description, c.price, c.downloads_enabled AS downloadsEnabled,
        c.created_at AS createdAt,
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
      if (body.downloadsEnabled !== undefined && typeof body.downloadsEnabled !== 'boolean') {
        fail(422, 'Choose whether course downloads are allowed.');
      }
      run('UPDATE courses SET title=?, description=?, price=?, downloads_enabled=? WHERE id=?', text(body.title, 'Title', 120),
        text(body.description, 'Description', 2000), priceInput(body.price), body.downloadsEnabled === true ? 1 : 0, id);
    },
    tests(id, body) {
      found('tests', id, 'Test');
      const row = found('tests', id, 'Test');
      if (typeof body.questionPaperDownload !== 'boolean') fail(422, 'Choose a valid question paper download option.');
      const selectedCourse = course(body.course || row.course);
      if ((body.durationMinutes !== undefined && (!Number.isInteger(body.durationMinutes) || body.durationMinutes < 10 || body.durationMinutes > 300)) ||
          (body.marksPerQuestion !== undefined && (!Number.isFinite(body.marksPerQuestion) || body.marksPerQuestion <= 0 || body.marksPerQuestion > 100)) ||
          (body.negativeMark !== undefined && (!Number.isFinite(body.negativeMark) || body.negativeMark < 0 ||
            body.negativeMark > (body.marksPerQuestion ?? row.marks_per_question)))) {
        fail(422, 'Enter valid duration and marking values.');
      }
      run(`UPDATE tests SET course=?, title=?, questions=?, duration_minutes=?, marks_per_question=?,
        negative_mark=?, question_paper_download=?, starts_at=?, expires_at=?, attempts_limit=? WHERE id=?`,
      selectedCourse.id, text(body.title, 'Title', 120), JSON.stringify(validateQuestions(body.questions)),
      body.durationMinutes ?? row.duration_minutes, body.marksPerQuestion ?? row.marks_per_question,
      body.negativeMark ?? row.negative_mark, row.live && body.questionPaperDownload ? 1 : 0,
      row.live && body.startsAt !== undefined ? istIso(body.startsAt, 'Live start time') : row.starts_at,
      row.live && body.expiresAt !== undefined ? istIso(body.expiresAt, 'Live expiry time') : row.expires_at,
      row.live ? (body.attemptsLimit ?? row.attempts_limit) : 0, id);
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
