import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function makeProtectedPdf(source, pages, phone, renderPage, copyright = false) {
  const output = await PDFDocument.create();
  const font = copyright ? await output.embedFont(StandardFonts.Helvetica) : null;
  if (copyright) {
    output.setAuthor('Mission Selection');
    output.setSubject('Personal use only. Redistribution is not permitted.');
  }
  for (let page = 1; page <= pages; page++) {
    const image = await output.embedPng(await renderPage(source, page, phone));
    const target = output.addPage([595, 842]);
    const bottom = copyright ? 24 : 0;
    const scale = Math.min(595 / image.width, (842 - bottom) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    target.drawImage(image, { x: (595 - width) / 2, y: bottom + (842 - bottom - height) / 2, width, height });
    if (font) target.drawText('Copyright Mission Selection and licensors. Personal use only.', {
      x: 20, y: 8, size: 9, font, color: rgb(.2, .2, .2),
    });
  }
  return Buffer.from(await output.save());
}
