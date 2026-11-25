import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeProtectedPdf } from '../firebase-functions/protected-pdf.js';
import { renderPage } from '../server/documents.js';

test('protected external PDFs watermark every page and do not expose source text', async () => {
  const source = await PDFDocument.create();
  for (let page = 1; page <= 2; page++) {
    source.addPage().drawText(`Original secret page ${page}`, {x: 40, y: 700});
  }
  const input = Buffer.from(await source.save());
  const first = await makeProtectedPdf(input, 2, '+919000000001', renderPage, true);
  const second = await makeProtectedPdf(input, 2, '+919000000002', renderPage, true);
  assert.notDeepEqual(first, second);
  const document = await getDocument({data: new Uint8Array(first), useSystemFonts: true, isEvalSupported: false}).promise;
  try {
    assert.equal(document.numPages, 2);
    for (let page = 1; page <= 2; page++) {
      const text = (await (await document.getPage(page)).getTextContent()).items.map(item => item.str).join(' ');
      assert.match(text, /Copyright Mission Selection and licensors/);
      assert.doesNotMatch(text, /Original secret/);
    }
  } finally { await document.destroy(); }
});
