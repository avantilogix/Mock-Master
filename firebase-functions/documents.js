import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sax from 'sax';
import sharp from 'sharp';
import { parseQuestions, pdfQuestionText } from './question-import.js';

export { parseQuestions } from './question-import.js';

export const mobile = /^\+91[6-9][0-9]{9}$/;

export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function documentError(error) {
  if (error.code === 'ENOENT') fail(503, 'Document processing is not configured on the server.');
  if (error.status) throw error;
  fail(422, 'Could not process this document.');
}

async function docxText(file) {
  const archive = await JSZip.loadAsync(file);
  const xml = await archive.file('word/document.xml')?.async('string');
  if (!xml) fail(422, 'Invalid DOCX document.');
  const parser = sax.parser(true, { xmlns: true });
  const parts = [];
  const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  let inText = false;
  parser.ondoctype = () => fail(422, 'Invalid DOCX document.');
  parser.onopentag = tag => {
    if (tag.uri !== namespace) return;
    if (tag.local === 't') inText = true;
    if (tag.local === 'br') parts.push('\n');
    if (tag.local === 'tab') parts.push(' ');
  };
  parser.onclosetag = name => {
    const tag = parser.tag;
    if (tag.name !== name || tag.uri !== namespace) return;
    if (tag.local === 't') inText = false;
    if (tag.local === 'p') parts.push('\n');
  };
  parser.ontext = value => { if (inText) parts.push(value); };
  parser.write(xml).close();
  return parts.join('');
}

export async function pageCount(pdf) {
  if (!Buffer.isBuffer(pdf) || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail(422, 'Expected a PDF.');
  try {
    const document = await PDFDocument.load(pdf, { ignoreEncryption: false, updateMetadata: false });
    const pages = document.getPageCount();
    if (!(pages >= 1 && pages <= 500)) fail(422, 'Expected an unencrypted PDF with 1–500 pages.');
    return pages;
  } catch (error) {
    if (error.status) throw error;
    fail(422, 'Expected a valid, unencrypted PDF with 1–500 pages.');
  }
}

const MAX_PAGE_PIXELS = 3_000_000;

export async function renderPage(pdf, page, phone) {
  if (!mobile.test(phone)) fail(403, 'A verified Indian mobile number is required.');
  return renderPdfPage(pdf, page, phone);
}

export async function renderUnmarkedPage(pdf, page) {
  return renderPdfPage(pdf, page, null);
}

export async function renderDemoPage(pdf, page) {
  return renderPdfPage(pdf, page, 'DEMO - Mission Selection');
}

async function renderPdfPage(pdf, page, label) {
  let loading;
  let png;
  try {
    loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, isEvalSupported: false });
    const document = await loading.promise;
    const pdfPage = await document.getPage(page);
    const source = pdfPage.getViewport({ scale: 1 });
    // Keep the rendered page within the watermark pixel budget (an A4 page at 2x exceeds 2 MP).
    const scale = Math.min(2, 1400 / source.width, Math.sqrt(MAX_PAGE_PIXELS / (source.width * source.height)));
    const viewport = pdfPage.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    try {
      await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      png = canvas.toBuffer('image/png');
    } catch (renderError) {
      const text = await pdfPage.getTextContent();
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#15244c';
      context.font = 'bold 34px sans-serif';
      context.fillText('Mission Selection', 48, 62);
      context.font = '24px sans-serif';
      const items = text.items.filter(item => typeof item.str === 'string' && item.str.trim());
      let y = 125;
      for (const item of items) {
        const words = item.str.split(/\s+/);
        let line = '';
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (context.measureText(candidate).width > canvas.width - 96 && line) {
            context.fillText(line, 48, y);
            y += 38;
            line = word;
          } else line = candidate;
        }
        if (line) {
          context.fillText(line, 48, y);
          y += 38;
        }
        if (y > canvas.height - 70) break;
      }
      png = canvas.toBuffer('image/png');
      console.warn('Book rendered with text fallback', { page, message: renderError.message });
    }
  } catch (error) {
    if (error.status) throw error;
    fail(422, 'Could not render this PDF page.');
  } finally {
    await loading?.destroy();
  }
  if (label === null) return png;
  const image = sharp(png, { limitInputPixels: MAX_PAGE_PIXELS + 100_000 });
  const { width, height } = await image.metadata();
  const labels = [];
  for (const [x, y] of [[width * .18, height * .22], [width * .55, height * .53], [width * .28, height * .84]]) {
    labels.push(`<text x="${x}" y="${y}" transform="rotate(-23 ${x} ${y})">${label}</text>`);
  }
  const watermark = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g font-family="sans-serif" font-size="24" fill="#12204d" fill-opacity="0.35" stroke="white" stroke-width="1" paint-order="stroke">${labels.join('')}</g></svg>`);
  return image.composite([{ input: watermark }]).png().toBuffer();
}

export function validateQuestions(questions) {
  if (Array.isArray(questions) && questions.some(question => question?.reviewIssues?.length)) {
    fail(422, 'Resolve imported question review warnings before publishing.');
  }
  const isText = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !/[\u0000\ufffd]/.test(value);
  if (!Array.isArray(questions) || !questions.length || questions.length > 200 ||
      questions.some(q => !isText(q?.prompt, 2000) || !Array.isArray(q.options) ||
        q.options.length < 2 || q.options.length > 6 || q.options.some(o => !isText(o, 500)) ||
        !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length ||
        (typeof q.section === 'string' && /[\u0000\ufffd]/.test(q.section)) ||
        (q.questionNumber !== undefined &&
          !((typeof q.questionNumber === 'string' && /^\d{1,10}$/.test(q.questionNumber) && Number(q.questionNumber) > 0) ||
            (Number.isSafeInteger(q.questionNumber) && q.questionNumber > 0))))) {
    fail(422, 'Provide 1–200 questions, each with 2–6 options and a valid answer index.');
  }
  return questions.map(({ prompt, options, answer, section, questionNumber }) => ({
    prompt: prompt.trim(),
    options: options.map(o => o.trim()),
    answer,
    section: typeof section === 'string' && section.trim() ? section.trim().slice(0, 100) : 'General',
    ...(questionNumber === undefined ? {} : {questionNumber: String(questionNumber)}),
  }));
}

export async function importQuestions(file, format) {
  if (!Buffer.isBuffer(file) || !file.length) fail(400, 'Upload a non-empty document.');
  try {
    let text;
    if (format === 'pdf') text = await pdfQuestionText(file, getDocument);
    else if (format === 'docx') text = await docxText(file);
    else if (format === 'txt') text = new TextDecoder('utf-8', { fatal: true }).decode(file);
    else fail(400, 'Choose PDF, DOCX or UTF-8 text.');
    return parseQuestions(text);
  } catch (error) {
    documentError(error);
  }
}
