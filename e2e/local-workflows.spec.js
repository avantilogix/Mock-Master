import { test, expect } from '@playwright/test';

const signedInPages = new WeakSet();

function samplePdf() {
  const content = 'BT /F1 18 Tf 72 720 Td (Sample resource) Tj ET';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(document));
    document += object;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document);
}

function questionPdf() {
  const content = 'BT /F1 14 Tf 50 750 Td (1. What is 2 + 2?) Tj 0 -25 Td (A. 3) Tj 0 -25 Td (B. 4) Tj 0 -25 Td (Answer: B) Tj ET';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(document));
    document += object;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document);
}

async function signIn(page, phone = '98765 43210') {
  if (signedInPages.has(page)) {
    await page.evaluate(() => localStorage.removeItem('mission-selection-dummy-phone'));
    await page.reload({waitUntil: 'domcontentloaded'});
  } else {
    await page.goto('/#signin', {waitUntil: 'domcontentloaded'});
  }
  await page.getByLabel('Mobile Number').fill(phone);
  await page.getByRole('checkbox', { name: 'CCE' }).check();
  await page.getByRole('button', { name: 'Send OTP' }).click();
  await page.getByLabel('6-Digit OTP').fill('123456');
  await page.getByRole('button', { name: 'Verify and Sign In' }).click();
  await expect(page).not.toHaveURL(/#signin/);
  signedInPages.add(page);
}

test('notification bell is in the mobile header instead of quick access', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await signIn(page);
  await page.goto('/#home');
  const bell = page.locator('.site-header').getByRole('link', {name: 'Notifications'});
  await expect(bell.locator('use')).toHaveAttribute('href', /#bell$/);
  await expect(bell).toBeVisible();
  await expect(page.locator('.shortcut-grid').getByRole('link', {name: /Notifications/})).toHaveCount(0);
  const bounds = await bell.boundingBox();
  expect(bounds.x + bounds.width).toBeGreaterThan(330);
  await bell.click();
  await expect(page).toHaveURL(/#notifications$/);
  const heading = page.locator('.site-header').getByRole('heading', {name: 'Notifications'});
  const back = page.locator('.site-header').getByRole('button', {name: 'Back'});
  await expect(heading).toBeVisible();
  await expect(back).toBeVisible();
  const headingBox = await heading.boundingBox();
  const backBox = await back.boundingBox();
  expect(headingBox.x).toBeGreaterThan(backBox.x + backBox.width);
  expect(Math.abs((headingBox.y + headingBox.height / 2) - (backBox.y + backBox.height / 2))).toBeLessThan(8);
});

test('exam navigation asks before submitting and protects browser back', async ({page, request}) => {
  const admin = {Authorization: 'Bearer dummy:+919999999999'};
  const student = {Authorization: 'Bearer dummy:+919876543210'};
  const created = await request.post('/api/admin/free-tests', {headers: admin,
    data: {title: `Exit guard ${Date.now()}`, questions: [{prompt: 'Pick four', options: ['3', '4'], answer: 1}]}});
  expect(created.status()).toBe(201);
  const {id} = await created.json();
  try {
    await signIn(page);
    await page.goto('/#free-tests');
    await page.locator('article').filter({hasText: 'Exit guard'}).getByRole('link', {name: 'Start Test'}).click();
    await page.locator('.exam-option').nth(1).click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('link', {name: 'Back to Free Test Series'}).click();
    await expect(page.getByRole('button', {name: 'Submit Exam'})).toBeVisible();
    page.once('dialog', dialog => dialog.dismiss());
    await page.goBack();
    await expect(page.getByRole('button', {name: 'Submit Exam'})).toBeVisible();
    expect((await (await request.get('/api/progress', {headers: student})).json()).attempts
      .filter(attempt => attempt.test === id)).toHaveLength(0);
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('.site-header').getByRole('link', {name: 'Notifications'}).click();
    await expect(page.getByRole('button', {name: 'Submit Exam'})).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.goBack();
    await expect(page.getByRole('heading', {name: 'Your Result'})).toBeVisible();
    await expect(page.getByRole('img', {name: 'Score 1 out of 1 marks'})).toBeVisible();
    await page.locator('.site-header').getByRole('link', {name: 'Notifications'}).click();
    await expect(page).toHaveURL(/#notifications$/);
  } finally {
    await request.delete(`/api/admin/published/tests/${id}`, {headers: admin});
  }
});

test('mobile header back preserves the exam submission confirmation', async ({page, request}) => {
  await page.setViewportSize({width: 390, height: 844});
  const admin = {Authorization: 'Bearer dummy:+919999999999'};
  const created = await request.post('/api/admin/free-tests', {headers: admin,
    data: {title: `Mobile exit ${Date.now()}`, questions: [{prompt: 'Pick four', options: ['3', '4'], answer: 1}]}});
  expect(created.status()).toBe(201);
  const {id} = await created.json();
  try {
    await signIn(page);
    await page.goto('/#free-tests');
    await page.locator('article').filter({hasText: 'Mobile exit'}).getByRole('link', {name: 'Start Test'}).click();
    await page.locator('.exam-option').nth(1).click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('.site-header').getByRole('button', {name: 'Back to Free Test Series'}).click();
    await expect(page.getByRole('button', {name: 'Submit Exam'})).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.site-header').getByRole('button', {name: 'Back to Free Test Series'}).click();
    await expect(page.getByRole('heading', {name: 'Your Result'})).toBeVisible();
    await expect(page.getByRole('img', {name: 'Score 1 out of 1 marks'})).toBeVisible();
  } finally {
    await request.delete(`/api/admin/published/tests/${id}`, {headers: admin});
  }
});

test('second background switch submits once and retries a failed submission', async ({page, request}) => {
  const admin = {Authorization: 'Bearer dummy:+919999999999'};
  const student = {Authorization: 'Bearer dummy:+919876543210'};
  const created = await request.post('/api/admin/free-tests', {headers: admin,
    data: {title: `Switch guard ${Date.now()}`, questions: [{prompt: 'Pick four', options: ['3', '4'], answer: 1}]}});
  expect(created.status()).toBe(201);
  const {id} = await created.json();
  try {
    await signIn(page);
    await page.goto('/#free-tests');
    await page.locator('article').filter({hasText: 'Switch guard'}).getByRole('link', {name: 'Start Test'}).click();
    await page.locator('.exam-option').nth(1).click();
    const visibility = state => page.evaluate(value => {
      Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => value});
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    await visibility('hidden');
    await visibility('hidden');
    await visibility('visible');
    await expect(page.getByRole('alert')).toContainText('A second switch will submit');
    expect((await (await request.get('/api/progress', {headers: student})).json()).attempts
      .filter(attempt => attempt.test === id)).toHaveLength(0);
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('A second switch will submit');
    let failed = false;
    await page.route(`**/api/tests/${id}/submit`, async route => {
      if (!failed) {
        failed = true;
        await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Test failure'})});
      } else await route.continue();
    });
    await visibility('hidden');
    await expect(page.getByRole('button', {name: 'Retry Submission'})).toBeVisible();
    await expect(page.locator('.exam-option input').first()).toBeDisabled();
    await visibility('visible');
    await expect(page.getByRole('heading', {name: 'Your Result'})).toBeVisible();
    await expect(page.getByText('Your test was submitted automatically after a second tab or app switch.')).toBeVisible();
    await expect(page.getByRole('img', {name: 'Score 1 out of 1 marks'})).toBeVisible();
    expect((await (await request.get('/api/progress', {headers: student})).json()).attempts
      .filter(attempt => attempt.test === id)).toHaveLength(1);
  } finally {
    await request.delete(`/api/admin/published/tests/${id}`, {headers: admin});
  }
});

test('free study material can be published, viewed, updated and deleted', async ({page, request}) => {
  await page.setViewportSize({width: 390, height: 844});
  const title = `Free PDF ${Date.now()}`;
  const admin = {Authorization: 'Bearer dummy:+919999999999'};
  const student = {Authorization: 'Bearer dummy:+919876543210'};
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Free Study Material/}).click();
  await page.getByRole('button', {name: 'Add Free Study Material'}).click();
  await page.getByLabel('Title', {exact: true}).fill(title);
  await page.getByLabel('Choose File').setInputFiles({name: 'sample.pdf', mimeType: 'application/pdf', buffer: samplePdf()});
  await page.getByRole('button', {name: 'Publish Material'}).click();
  const card = page.locator('.manage-item').filter({hasText: title});
  await expect(card).toBeVisible();
  const item = (await (await request.get('/api/free-materials', {headers: admin})).json()).find(row => row.title === title);
  expect(item).toBeTruthy();
  expect((await request.get(`/api/free-materials/${item.id}/download`, {headers: student})).status()).toBe(403);
  await card.getByRole('button', {name: 'Edit'}).click();
  await card.getByLabel('Title', {exact: true}).fill(`${title} edited`);
  await card.getByLabel('Replace PDF (optional)').setInputFiles({name: 'replacement.pdf', mimeType: 'application/pdf', buffer: samplePdf()});
  await card.getByRole('switch', {name: 'Allow PDF download'}).check();
  await card.getByRole('button', {name: 'Save Changes'}).click();
  const edited = page.locator('.manage-item').filter({hasText: `${title} edited`});
  await expect(edited).toBeVisible();
  expect((await request.get(`/api/free-materials/${item.id}/download`, {headers: student})).status()).toBe(200);
  await signIn(page);
  await page.goto('/#home');
  await page.getByRole('link', {name: /Free Study Material/}).click();
  await expect(page.locator('.site-header').getByRole('heading', {name: 'Free study material'})).toBeVisible();
  await expect(page.locator('.site-header .brand')).toBeHidden();
  const material = page.locator('article').filter({hasText: `${title} edited`});
  await expect(material.getByRole('button', {name: 'Download'})).toBeVisible();
  expect((await material.boundingBox()).height).toBeLessThan(350);
  const downloadPromise = page.waitForEvent('download');
  await material.getByRole('button', {name: 'Download'}).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.pdf$/);
  await material.getByRole('link', {name: 'View PDF'}).click();
  await expect(page.locator('.site-header').getByRole('heading', {name: `${title} edited`})).toBeVisible();
  await expect(page.getByRole('region', {name: `${title} edited PDF pages`})).toBeVisible();
  await expect(page.locator('.pdf-reader-pages img').first()).toBeVisible();
  await page.locator('.site-header').getByRole('button', {name: 'Back to Free study material'}).click();
  await expect(page).toHaveURL(/#free-materials$/);
  await expect(page.locator('article').filter({hasText: `${title} edited`})).toBeVisible();
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Free Study Material/}).click();
  const toDelete = page.locator('.manage-item').filter({hasText: `${title} edited`});
  await toDelete.getByRole('button', {name: 'Edit'}).click();
  await toDelete.getByRole('switch', {name: 'Allow PDF download'}).uncheck();
  await toDelete.getByRole('button', {name: 'Save Changes'}).click();
  await expect(toDelete).toContainText('View only');
  expect((await request.get(`/api/free-materials/${item.id}/download`, {headers: student})).status()).toBe(403);
  await signIn(page);
  await page.goto('/#free-materials');
  const viewOnly = page.locator('article').filter({hasText: `${title} edited`});
  await expect(viewOnly).toBeVisible();
  await expect(viewOnly.getByRole('button', {name: 'Download'})).toHaveCount(0);
  await viewOnly.getByRole('link', {name: 'View PDF'}).click();
  await expect(page.locator('.pdf-reader-pages img').first()).toBeVisible();
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Free Study Material/}).click();
  const finalCard = page.locator('.manage-item').filter({hasText: `${title} edited`});
  await finalCard.getByRole('button', {name: 'Delete'}).click();
  await finalCard.getByRole('button', {name: 'Yes, Delete'}).click();
  await expect(finalCard).toHaveCount(0);
  expect((await request.get(`/api/free-materials/${item.id}`, {headers: student})).status()).toBe(404);
});

test('mobile page and admin back buttons return to the correct level', async ({page}) => {
  await page.setViewportSize({width: 320, height: 740});
  await signIn(page, '99999 99999');
  await page.goto('/#home');
  await page.getByRole('link', {name: /Free Test Series/}).click();
  await expect(page.locator('.site-header').getByRole('heading', {name: 'Free test series'})).toBeVisible();
  await page.locator('.site-header').getByRole('button', {name: 'Back'}).click();
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('.site-header .brand')).toBeVisible();
  await page.goto('/#admin');
  const area = page.getByRole('button', {name: /Free Study Material/});
  await expect(page.locator('.admin-analytics')).toBeVisible();
  await area.hover();
  await expect(area.locator('small')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await area.click();
  await expect(page.locator('.site-header').getByRole('heading', {name: 'Free Study Material'})).toBeVisible();
  await expect(page.locator('.admin-analytics')).toBeHidden();
  await expect(page.locator('main > .lead')).toBeHidden();
  await page.getByRole('button', {name: 'Filter Free Study Material'}).click();
  await expect(page.getByRole('searchbox', {name: 'Filter Free Study Material'})).toBeVisible();
  await page.getByRole('button', {name: 'Filter Free Study Material'}).click();
  await page.getByRole('button', {name: 'Add Free Study Material'}).click();
  await expect(page.getByRole('button', {name: 'Publish Material'})).toBeVisible();
  await page.locator('.site-header').getByRole('button', {name: 'All Areas'}).click();
  await expect(page.getByRole('button', {name: 'Publish Material'})).toBeHidden();
  await expect(page.getByRole('button', {name: 'Add Free Study Material'})).toBeVisible();
  await page.locator('.site-header').getByRole('button', {name: 'All Areas'}).click();
  await expect(page.getByRole('button', {name: /Free Study Material/})).toBeVisible();
  await expect(page.locator('.admin-analytics')).toBeVisible();
  await expect(page.locator('.site-header').getByRole('heading', {name: 'Admin workspace'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('desktop admin sections have one back button and return through each level', async ({page}) => {
  await page.setViewportSize({width: 1024, height: 768});
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  const workspaceBack = page.locator('main > .page-heading-row > .page-back');
  await expect(workspaceBack).toBeVisible();
  for (const label of ['Free Study Material', 'Courses', 'Free Test Series', 'Support']) {
    await page.locator('.admin-area-card').filter({hasText: label}).click();
    await expect(workspaceBack).toBeHidden();
    const sectionBack = page.getByRole('button', {name: 'All Areas'});
    await expect(sectionBack).toHaveCount(1);
    await expect(sectionBack).toBeVisible();
    if (label === 'Free Study Material') {
      await page.getByRole('button', {name: 'Add Free Study Material'}).click();
      await expect(page.getByRole('button', {name: 'Publish Material'})).toBeVisible();
      await sectionBack.click();
      await expect(page.getByRole('button', {name: 'Publish Material'})).toBeHidden();
      await expect(page.getByRole('button', {name: 'Add Free Study Material'})).toBeVisible();
    }
    await sectionBack.click();
    await expect(workspaceBack).toBeVisible();
    await expect(page.locator('.admin-area-grid')).toBeVisible();
  }
});

test('mobile home shortcuts remain readable without clipping', async ({page}) => {
  await signIn(page);
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({width, height: 800});
    await page.goto('/#home');
    const descriptions = page.locator('.shortcut-grid .shortcut small');
    await expect(descriptions).toHaveCount(12);
    for (const description of await descriptions.all()) {
      const layout = await description.evaluate(element => ({
        fontSize: parseFloat(getComputedStyle(element).fontSize),
        clipped: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      }));
      expect(layout.fontSize).toBeGreaterThanOrEqual(12.8);
      expect(layout.clipped).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test('mobile back follows the current affairs archive levels', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await signIn(page);
  await page.route('**/api/content/current-affairs', route => route.fulfill({json: [
    {id: 'archive-example', title: 'Archive example', publishedAt: '2026-03-10'},
  ]}));
  await page.goto('/#home');
  await page.getByRole('link', {name: /Current Affairs/}).click();
  await page.getByRole('button', {name: '2026', exact: true}).click();
  await page.getByRole('button', {name: /March-2026/}).click();
  await expect(page.getByText('Archive example')).toBeVisible();
  await page.locator('.site-header').getByRole('button', {name: '2026 Months'}).click();
  await expect(page.getByRole('button', {name: /March-2026/})).toBeVisible();
  await page.locator('.site-header').getByRole('button', {name: 'All Years'}).click();
  await expect(page.getByRole('button', {name: '2026', exact: true})).toBeVisible();
  await page.locator('.site-header').getByRole('button', {name: 'Back'}).click();
  await expect(page).toHaveURL(/#home$/);
});

test('ebook details keep the page heading and back button after loading', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await signIn(page);
  await page.route('**/api/ebooks', route => route.fulfill({json: [
    {id: 'ebook-example', title: 'Example e-book', description: 'Study notes', price: 10000, pages: 1},
  ]}));
  await page.route('**/api/ebook-orders', route => route.fulfill({json: [
    {ebook: 'ebook-example', status: 'pending', reference: 'TEST123'},
  ]}));
  await page.route('**/api/ebooks/ebook-example/payment', route => route.fulfill({json: {
    amount: 10000, order: {status: 'pending', reference: 'TEST123'},
  }}));
  await page.goto('/#book-store');
  await page.getByRole('link', {name: 'View Payment Status'}).click();
  await expect(page.locator('.site-header').getByRole('heading', {name: 'Example e-book'})).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', {name: 'Close payment options'}).click();
  await page.locator('.site-header').getByRole('button', {name: 'Back'}).click();
  await expect(page).toHaveURL(/#book-store$/);
  await expect(page.getByRole('link', {name: 'View Payment Status'})).toBeVisible();
});

test('free tests reuse manual and imported questions and respect publication', async ({page, request}) => {
  await page.setViewportSize({width: 390, height: 844});
  const suffix = Date.now();
  const manualTitle = `Free manual ${suffix}`;
  const importTitle = `Free import ${suffix}`;
  const admin = {Authorization: 'Bearer dummy:+919999999999'};
  const student = {Authorization: 'Bearer dummy:+919876543210'};
  try {
    await signIn(page, '99999 99999');
    await page.goto('/#admin');
    await page.getByRole('button', {name: /Free Test Series/}).click();
    await page.getByRole('button', {name: 'Add Free Test'}).click();
    const form = page.locator('.publish-test-panel');
    await form.getByLabel('Test Creation Method').selectOption('manual');
    await form.getByLabel('Test Title').fill(manualTitle);
    const manual = form.locator('.manual-questions:not(.imported-question-review)');
    await manual.getByLabel('Question Text').fill('What is 2 + 2?');
    await manual.getByLabel('Option A', {exact: true}).fill('3');
    await manual.getByLabel('Option B', {exact: true}).fill('4');
    await manual.getByLabel('Option C', {exact: true}).fill('5');
    await manual.getByLabel('Option D', {exact: true}).fill('6');
    await manual.getByLabel('Correct Answer').selectOption('1');
    await form.getByRole('button', {name: 'Publish Test'}).click();
    const manualCard = page.locator('.manage-item').filter({hasText: manualTitle});
    await expect(manualCard).toBeVisible();
    await manualCard.locator('summary').click();
    await manualCard.getByRole('button', {name: 'Unpublish'}).click();
    await expect(manualCard.getByRole('button', {name: 'Publish', exact: true})).toBeVisible();
    const adminList = await (await request.get('/api/admin/published', {headers: admin})).json();
    const id = adminList.freeTests.find(item => item.title === manualTitle).id;
    expect(adminList.tests.some(item => item.id === id)).toBe(false);
    expect((await request.get(`/api/tests/${id}`, {headers: student})).status()).toBe(404);
    await manualCard.getByRole('button', {name: 'Publish', exact: true}).click();
    await expect(manualCard.getByRole('button', {name: 'Unpublish'})).toBeVisible();
    await manualCard.getByRole('button', {name: 'Edit', exact: true}).click();
    await manualCard.getByLabel('Test Title').fill(`${manualTitle} edited`);
    await manualCard.getByRole('button', {name: 'Save Changes'}).click();
    await expect(page.locator('.manage-item').filter({hasText: `${manualTitle} edited`})).toBeVisible();

    await form.getByLabel('Test Creation Method').selectOption('existing');
    await form.getByLabel('Test Title').fill(importTitle);
    await form.getByLabel('Question File', {exact: false}).first().setInputFiles({
      name: 'questions.txt', mimeType: 'text/plain',
      buffer: Buffer.from('1. What is 2 + 2?\nA. 3\nB. 4\nAnswer: B'),
    });
    await form.locator('.publish-test-import').getByRole('button', {name: 'Import', exact: true}).click();
    await expect(form.locator('.publish-test-import')).toContainText('Imported 1 questions');
    await form.getByRole('button', {name: 'Publish Test'}).click();
    await expect(page.locator('.manage-item').filter({hasText: importTitle})).toBeVisible();

    await signIn(page);
    await page.goto('/#home');
    await page.getByRole('link', {name: /Free Test Series/}).click();
    const card = page.locator('article').filter({hasText: `${manualTitle} edited`});
    await expect(card).toContainText('1 question');
    await card.getByRole('link', {name: 'Start Test'}).click();
    await page.getByText('4', {exact: true}).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', {name: 'Submit Exam'}).click();
    await expect(page.getByRole('heading', {name: 'Your Result'})).toBeVisible();
    await expect(page.getByRole('img', {name: 'Score 1 out of 1 marks'})).toBeVisible();
    await page.getByRole('button', {name: 'Return to Free Test Series'}).click();
    await expect(page.locator('article').filter({hasText: `${manualTitle} edited`})).toContainText('First attempt: 1/1');
    await signIn(page, '99999 99999');
    await page.goto('/#admin');
    await page.getByRole('button', {name: /Free Test Series/}).click();
    const deleteCard = page.locator('.manage-item').filter({hasText: `${manualTitle} edited`});
    await deleteCard.locator('summary').click();
    await deleteCard.getByRole('button', {name: 'Delete', exact: true}).click();
    await deleteCard.getByRole('button', {name: 'Yes, Delete'}).click();
    await expect(deleteCard).toHaveCount(0);
    expect((await request.get(`/api/tests/${id}`, {headers: student})).status()).toBe(404);
  } finally {
    const response = await request.get('/api/admin/published', {headers: admin});
    if (response.ok()) {
      const data = await response.json();
      for (const item of data.freeTests.filter(row => row.title.includes(String(suffix)))) {
        await request.delete(`/api/admin/published/tests/${item.id}`, {headers: admin});
      }
    }
  }
});

test('admin can remove a test with results and hide its course', async ({page, request}) => {
  const suffix = Date.now().toString();
  const title = `Deletion Course ${suffix}`;
  const admin = {Authorization: 'Bearer dummy:+919999999999'};
  const created = await request.post('/api/admin/courses', {headers: admin,
    data: {title, description: 'Deletion workflow', price: 14900}});
  expect(created.status()).toBe(201);
  const {id} = await created.json();
  const madeTest = await request.post(`/api/admin/courses/${id}/tests`, {headers: admin,
    data: {title: 'Completed test', questions: [{prompt: '2 + 2?', options: ['3', '4'], answer: 1}]}});
  const testId = (await madeTest.json()).id;
  expect((await request.post(`/api/tests/${testId}/start`, {headers: admin})).status()).toBe(201);
  expect((await request.post(`/api/tests/${testId}/submit`, {headers: admin, data: {answers: [1]}})).status()).toBe(200);
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Mock Tests/}).click();
  const testCard = page.locator('.manage-item').filter({hasText: title});
  await testCard.locator('summary').click();
  await expect(testCard.getByText('1 student attempt')).toBeVisible();
  await testCard.getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(testCard.getByRole('alert')).toContainText('student attempts, results and active sessions');
  await testCard.getByRole('button', {name: 'Yes, Delete'}).click();
  await expect(testCard).toHaveCount(0);
  expect((await request.get(`/api/tests/${testId}`, {headers: admin})).status()).toBe(404);
  await page.getByRole('button', {name: /All Areas/}).click();
  await page.getByRole('button', {name: /^Courses/}).click();
  const courseCard = page.locator('.manage-item').filter({hasText: title});
  await courseCard.locator('summary').click();
  await courseCard.getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(courseCard.getByRole('alert')).toContainText('payment records will be retained');
  await courseCard.getByRole('button', {name: 'Yes, Delete'}).click();
  await expect(courseCard).toHaveCount(0);
  expect((await (await request.get('/api/courses')).json()).some(course => course.id === id)).toBe(false);
});

test('first test score stays beside start while later attempts reach progress', async ({page, request}) => {
  const suffix = Date.now().toString();
  const phone = `98768${suffix.slice(-5)}`;
  const admin = {Authorization: 'Bearer dummy:+919999999999'};
  const student = {Authorization: `Bearer dummy:+91${phone}`};
  const title = `First Score ${suffix}`;
  const created = await request.post('/api/admin/courses', {headers: admin,
    data: {title, description: 'First score workflow', price: 14900}});
  const {id} = await created.json();
  const madeTest = await request.post(`/api/admin/courses/${id}/tests`, {headers: admin,
    data: {title: 'First score test', questions: [{prompt: '2 + 2?', options: ['3', '4'], answer: 1}]}});
  const testId = (await madeTest.json()).id;
  expect((await request.get('/api/me', {headers: student})).status()).toBe(200);
  const payment = await request.post(`/api/courses/${id}/payment`, {headers: student,
    data: {reference: `TEST${suffix}`}});
  expect(payment.status()).toBe(201);
  expect((await request.post(`/api/admin/payments/${(await payment.json()).id}/approve`, {headers: admin, data: {}})).status()).toBe(204);
  for (const answer of [0, 1]) {
    expect((await request.post(`/api/tests/${testId}/start`, {headers: student})).status()).toBe(201);
    expect((await request.post(`/api/tests/${testId}/submit`, {headers: student, data: {answers: [answer]}})).status()).toBe(200);
  }
  await signIn(page, phone);
  await page.goto(`/#course/${id}`);
  await page.getByRole('tab', {name: 'Test', exact: true}).click();
  const row = page.locator('.test-series-row').filter({hasText: 'First score test'});
  await expect(row.getByText('First attempt: 0/1')).toBeVisible();
  await expect(row.getByRole('link', {name: 'Start test'})).toBeVisible();
  await page.goto('/#test-series');
  await page.getByRole('button', {name: `Open tests for ${title}`}).click();
  await expect(page.locator('.test-series-row').filter({hasText: 'First score test'})
    .getByText('First attempt: 0/1')).toBeVisible();
  const progress = await (await request.get('/api/progress', {headers: student})).json();
  expect(progress.attempts.filter(attempt => attempt.test === testId)).toHaveLength(2);
});

test('study timetable shows admin-published sessions only', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/timetable', route => route.fulfill({json: [{
    title: 'Admin Study Session', day: 'Monday', startsAt: '09:00', duration: '60 minutes', description: 'Revision',
  }]}));
  await page.goto('/#timetable');
  await expect(page.getByRole('heading', { name: 'Study timetable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Published Sessions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Admin Study Session' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add a Study Session' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Add to Timetable/ })).toHaveCount(0);
});

test('locked course tabs keep their labels on one line on mobile', async ({page}) => {
  await signIn(page);
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({width, height: 800});
    await page.goto('/#course/sample-bank-exam');
    const tabs = page.getByRole('tablist', {name: 'Course sections'}).getByRole('tab');
    await expect(tabs).toHaveCount(3);
    for (const tab of await tabs.all()) {
      const layout = await tab.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element.firstChild);
        const text = [...range.getClientRects()];
        const box = element.getBoundingClientRect();
        return {lines: text.length, left: text[0]?.left, right: text[0]?.right,
          boxLeft: box.left, boxRight: box.right};
      });
      expect(layout.lines).toBe(1);
      expect(layout.left).toBeGreaterThanOrEqual(layout.boxLeft);
      expect(layout.right).toBeLessThanOrEqual(layout.boxRight);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('tab', {name: 'Content - locked'}).click();
    await expect(page.getByText('Course Content', {exact: true})).toBeVisible();
  }
});

test('dummy student sign-in and protected course access', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/#catalog');
  await expect(page.getByRole('heading', { name: 'All courses' })).toBeVisible();
  await page.goto('/#course/sample-bank-exam');
  await page.getByRole('tab', { name: 'Content - locked' }).click();
  await expect(page.getByText('Course Content', {exact: true})).toBeVisible();
  await expect(page.getByText(/You need to purchase .* to unlock its study materials and discussions\./)).toBeVisible();
  await expect(page.locator('.course-content .course-locked-folder')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.course-content .course-locked-folder a, .course-content .course-locked-folder button')).toHaveCount(0);
  await expect(page.locator('.course-content .course-lock-thumbnail')).toBeVisible();
  await expect(page.locator('.course-content .course-lock-icon use')).toHaveAttribute('href', /#lock$/);
  await expect(page.locator('.course-tab[aria-label="Content - locked"] svg use')).toHaveAttribute('href', /#lock$/);
  await page.getByRole('tab', { name: 'Test - locked' }).click();
  await expect(page.getByText(/You need to purchase .* to access practice and live tests\./)).toBeVisible();
  await expect(page.locator('.course-test-panel .course-lock-thumbnail')).toBeVisible();
  await expect(page.locator('.course-tab[aria-label="Test - locked"] svg use')).toHaveAttribute('href', /#lock$/);
  await page.getByRole('tab', { name: 'Content - locked' }).click();
  await page.locator('.course-content .course-content-buy').click();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.course-purchase-notice')).toContainText('Select Buy Now on the overview to continue.');
  await expect(page.getByRole('button', { name: 'Buy Now' }).first()).toBeVisible();
  const direct = await request.get('/api/courses/sample-bank-exam', {
    headers: { Authorization: 'Bearer dummy:+919876543210' },
  });
  expect(direct.status()).toBe(403);
});

test('student can submit course payment and remain locked until approval', async ({ page, request }) => {
  const phone = `98765${Date.now().toString().slice(-5)}`;
  const reference = Date.now().toString().slice(-12);
  await signIn(page, phone);
  await page.goto('/#course/sample-bank-exam');
  await page.getByRole('button', { name: 'Buy Now' }).first().click();
  await page.getByLabel('UPI Transaction Reference').fill(reference);
  await page.getByRole('button', { name: 'Submit for Admin Approval' }).click();
  await expect(page.getByRole('heading', { name: 'Payment Submitted' })).toBeVisible();
  const direct = await request.get('/api/courses/sample-bank-exam', {
    headers: { Authorization: `Bearer dummy:+91${phone}` },
  });
  expect(direct.status()).toBe(403);
});

test('admin can approve a pending course payment and grant only that user', async ({ page, request }) => {
  const phone = `98766${Date.now().toString().slice(-5)}`;
  const reference = Date.now().toString().slice(-12);
  await signIn(page, phone);
  await page.goto('/#course/sample-bank-exam');
  await page.getByRole('button', { name: 'Buy Now' }).first().click();
  await page.getByLabel('UPI Transaction Reference').fill(reference);
  await page.getByRole('button', { name: 'Submit for Admin Approval' }).click();
  await expect(page.getByRole('heading', { name: 'Payment Submitted' })).toBeVisible();

  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await expect(page.getByRole('heading', { name: 'Admin workspace' })).toBeVisible();
  await page.getByRole('button', { name: /Course Payments/ }).click();
  await page.locator('.admin-payment-group').filter({hasText: reference}).locator(':scope > summary').click();
  const payment = page.locator('.payment-request').filter({ hasText: reference });
  await payment.locator('summary').first().click();
  await payment.getByRole('button', { name: 'Approve and Unlock' }).click();
  await expect(payment.getByText(/is now unlocked for/)).toBeVisible();

  await signIn(page, phone);
  await page.goto('/#course/sample-bank-exam');
  await expect(page.getByRole('button', { name: 'Buy Now' })).toHaveCount(0);
  const owned = await request.get('/api/courses/sample-bank-exam', {
    headers: { Authorization: `Bearer dummy:+91${phone}` },
  });
  expect(owned.status()).toBe(200);
});

test('another student cannot access direct course, test, PDF or video APIs', async ({ request }) => {
  const unauthorized = [
    '/api/courses/sample-bank-exam',
    '/api/courses/sample-bank-exam/receipt.pdf',
    '/api/tests/sample-bank-exam-test-01',
    '/api/tests/sample-bank-exam-test-01/question-paper.pdf',
  ];
  for (const path of unauthorized) {
    const response = await request.get(path, {
      headers: { Authorization: 'Bearer dummy:+919876543299' },
    });
    expect([403, 404]).toContain(response.status());
  }
});

test('course payment approval controls every course resource after refresh and sign-out', async ({ page, request }) => {
  test.setTimeout(90_000);
  const suffix = Date.now().toString();
  const title = `Approval Course ${suffix}`;
  const phone = `98767${suffix.slice(-5)}`;
  const buyer = {Authorization: `Bearer dummy:+91${phone}`};
  const other = {Authorization: 'Bearer dummy:+919876543298'};
  const admin = {Authorization: 'Bearer dummy:+919999999999'};
  const created = await request.post('/api/admin/courses', {headers: admin,
    data: {title, description: 'Protected course content', price: 14900, downloadsEnabled: true}});
  expect(created.status()).toBe(201);
  const {id} = await created.json();
  const coursePath = `/api/courses/${id}`;
  const createFolder = await request.post(`/api/admin/courses/${id}/folders`, {headers: admin,
    data: {kind: 'content', name: 'Private folder'}});
  const folderId = (await createFolder.json()).id;
  const bookResponse = await request.post(`/api/admin/courses/${id}/books?title=Private%20PDF&folderId=${folderId}`,
    {headers: {...admin, 'Content-Type': 'application/octet-stream'}, data: samplePdf()});
  expect(bookResponse.status()).toBe(201);
  const bookId = (await bookResponse.json()).id;
  const videoResponse = await request.post(`/api/admin/courses/${id}/videos?title=Private%20Video&subject=General&chapter=One&folderId=${folderId}`,
    {headers: {...admin, 'Content-Type': 'video/mp4'},
      data: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64, 1)])});
  expect(videoResponse.status()).toBe(201);
  const videoId = (await videoResponse.json()).id;
  const testResponse = await request.post(`/api/admin/courses/${id}/tests`, {headers: admin,
    data: {title: 'Private Test', questions: [{prompt: 'What is 2 + 2?', options: ['3', '4'], answer: 1}]}});
  expect(testResponse.status()).toBe(201);
  const testId = (await testResponse.json()).id;
  const youtube = await request.post('/api/admin/videos', {headers: admin,
    data: {course: id, title: 'Private YouTube lesson', description: 'Course lesson', url: 'https://youtu.be/dQw4w9WgXcQ'}});
  expect(youtube.status()).toBe(201);
  const youtubeId = (await youtube.json()).id;
  const protectedPaths = [coursePath, `/api/tests/${testId}`, `/api/tests/${testId}/question-paper.pdf`,
    `/api/tests/${testId}/leaderboard`, `/api/books/${bookId}/pages/1`, `/api/videos/${videoId}/link`];
  const blocked = async headers => {
    for (const path of protectedPaths) expect((await request.get(path, {headers})).status(), path).toBe(403);
    expect((await request.post(`/api/tests/${testId}/start`, {headers})).status()).toBe(403);
    expect((await request.put(`/api/tests/${testId}/progress`, {headers, data: {answers: []}})).status()).toBe(403);
    expect((await request.post(`/api/tests/${testId}/submit`, {headers, data: {answers: [1]}})).status()).toBe(403);
    expect((await request.post(`${coursePath}/messages`, {headers, data: {text: 'Denied'}})).status()).toBe(403);
    const list = await (await request.get('/api/videos/accessible', {headers})).json();
    expect(list.some(video => video.id === youtubeId)).toBe(false);
  };
  for (const path of protectedPaths) expect((await request.get(path)).status(), path).toBe(401);
  expect((await request.get(`/api/videos/${videoId}/file`)).status()).toBe(403);
  expect((await (await request.get('/api/videos')).json()).some(video => video.id === youtubeId)).toBe(false);
  await blocked(buyer);
  await blocked(other);
  expect((await request.get(`/api/admin/courses/${id}/workspace?kind=content`, {headers: buyer})).status()).toBe(403);
  expect((await request.get(coursePath, {headers: admin})).status()).toBe(200);

  await signIn(page, phone);
  await page.goto('/#catalog');
  await page.getByRole('link', {name: `Open course: ${title}`}).click();
  await page.getByRole('button', {name: 'Buy Now'}).first().click();
  await expect(page.getByText('Payment Pending', {exact: true})).toBeVisible();
  await expect(page.getByText('Not Purchased', {exact: true})).toBeVisible();
  for (const route of [`book/${id}/${bookId}`, `video/${id}/${videoId}`, `test/${id}/${testId}`]) {
    await page.goto(`/#${route}`);
    await expect(page.getByText('Purchase this course to unlock it.')).toBeVisible();
  }
  await page.goto(`/#course/${id}`);
  const reference = `UPI${suffix}`;
  await page.getByRole('button', {name: 'Buy Now'}).first().click();
  await page.getByLabel('UPI Transaction Reference').fill(reference);
  await page.getByLabel('Payment Note').fill('Payment submitted for review');
  await page.getByRole('button', {name: 'Submit for Admin Approval'}).click();
  await expect(page.getByText('Awaiting Admin Approval')).toBeVisible();
  await page.reload();
  await page.getByRole('button', {name: 'Buy Now'}).first().click();
  await expect(page.getByText('Awaiting Admin Approval')).toBeVisible();
  await blocked(buyer);

  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Course Payments/}).click();
  let payment = page.locator('.payment-request').filter({hasText: reference});
  await payment.locator('summary').first().click();
  await expect(payment.getByRole('heading', {name: title})).toBeVisible();
  await expect(payment.getByText(`+91${phone}`)).toBeVisible();
  await expect(payment.getByText('Payment submitted for review')).toBeVisible();
  await payment.getByLabel('Rejection Reason').fill('Reference not verified');
  await payment.getByRole('button', {name: 'Reject', exact: true}).click();
  await expect(payment.getByText('Request rejected. The student can resubmit payment proof.')).toBeVisible();

  await signIn(page, phone);
  await page.goto(`/#course/${id}`);
  await page.getByRole('button', {name: 'Buy Now'}).first().click();
  await expect(page.getByText('Rejected', {exact: true})).toBeVisible();
  await expect(page.getByText('Reference not verified')).toBeVisible();
  await blocked(buyer);
  await page.getByLabel('UPI Transaction Reference').fill(`${reference}R`);
  await page.getByRole('button', {name: 'Submit for Admin Approval'}).click();
  await expect(page.getByText('Awaiting Admin Approval')).toBeVisible();
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Course Payments/}).click();
  payment = page.locator('.payment-request').filter({hasText: `${reference}R`});
  await payment.locator('summary').first().click();
  await payment.getByRole('button', {name: 'Approve and Unlock'}).click();
  await expect(payment.getByText(/is now unlocked/)).toBeVisible();

  await signIn(page, phone);
  await page.goto(`/#course/${id}`);
  await expect(page.getByText('Purchased · Approved')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Study Materials', exact: true})).toBeVisible();
  await page.getByLabel('Your Review').fill('A helpful course.');
  await page.getByRole('button', {name: 'Save Review'}).click();
  await expect(page.getByText('Choose a rating before saving your review.')).toBeVisible();
  await page.getByRole('radio', {name: '5 stars'}).check();
  await page.getByRole('button', {name: 'Save Review'}).click();
  await expect(page.getByText('Review saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Private folder')).toBeVisible();
  for (const path of [coursePath, `/api/tests/${testId}`, `/api/books/${bookId}/pages/1`, `/api/videos/${videoId}/link`]) {
    expect((await request.get(path, {headers: buyer})).status(), path).toBe(200);
  }
  const link = await (await request.get(`/api/videos/${videoId}/link`, {headers: buyer})).json();
  expect((await request.get(link.url)).status()).toBe(200);
  const studentStatus = `/api/admin/students/dummy-91${phone}/status`;
  expect((await request.post(studentStatus, {headers: admin, data: {disabled: true}})).status()).toBe(204);
  expect((await request.get(coursePath, {headers: buyer})).status()).toBe(403);
  expect((await request.get(link.url)).status()).toBe(403);
  expect((await request.post(studentStatus, {headers: admin, data: {disabled: false}})).status()).toBe(204);
  expect((await request.get(coursePath, {headers: buyer})).status()).toBe(200);
  expect((await request.post(`/api/tests/${testId}/start`, {headers: buyer})).status()).toBe(201);
  const submittedAttempt = await request.post(`/api/tests/${testId}/submit`, {headers: buyer, data: {answers: [1]}});
  expect(submittedAttempt.status()).toBe(200);
  const {attemptId} = await submittedAttempt.json();
  expect((await request.get(`/api/attempts/${attemptId}/result.pdf`, {headers: buyer})).status()).toBe(200);
  expect((await request.post(`/api/tests/${testId}/start`, {headers: buyer})).status()).toBe(201);
  expect((await (await request.get('/api/videos/accessible', {headers: buyer})).json()).some(video => video.id === youtubeId)).toBe(true);
  await blocked(other);
  await page.goto('/#profile');
  await page.getByRole('button', {name: 'Sign Out'}).click();
  await page.goto('/#signin');
  await signIn(page, phone);
  await page.goto(`/#course/${id}`);
  await expect(page.getByRole('heading', {name: 'Study Materials', exact: true})).toBeVisible();
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Course Payments/}).click();
  payment = page.locator('.payment-request').filter({hasText: `${reference}R`});
  await payment.locator('summary').first().click();
  await payment.getByLabel('Revocation Reason').fill('Payment reversed');
  await payment.getByRole('button', {name: 'Reject and Revoke Access'}).click();
  await expect(payment.getByText('Request rejected. The student can resubmit payment proof.')).toBeVisible();
  await blocked(buyer);
  expect((await request.get(link.url)).status()).toBe(403);
  expect((await request.get(`/api/attempts/${attemptId}/result.pdf`, {headers: buyer})).status()).toBe(403);
});

test('downloads page exposes separate PDF and Video tabs and persists items', async ({ page }) => {
  await signIn(page);
  await page.goto('/#downloads');
  await expect(page.getByRole('tab', { name: 'PDF' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Video' })).toBeVisible();
  await page.getByRole('tab', { name: 'Video' }).click();
  await expect(page.getByText('Nothing saved yet')).toBeVisible();
});

test('downloads search filters PDFs and videos independently and preserves actions', async ({page}) => {
  await page.setViewportSize({width: 360, height: 800});
  await signIn(page);
  await page.goto('/#downloads');
  await expect(page.getByText('Nothing saved yet')).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open('mission-selection-saved-content', 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = [
      {uid: 'dummy-919876543210', type: 'course-pdf', id: 'pdf-1', title: 'Algebra Notes', parts: 1},
      {uid: 'dummy-919876543210', type: 'course-pdf', id: 'pdf-2', title: 'History Notes', parts: 2},
      {uid: 'dummy-919876543210', type: 'course-video', id: 'video-1', title: 'Algebra Lesson', parts: 1},
      {uid: 'dummy-919876543210', type: 'course-video', id: 'video-2', title: 'History Lesson', parts: 1},
      {uid: 'dummy-910000000000', type: 'course-pdf', id: 'other', title: 'Private Notes', parts: 1},
    ];
    await new Promise((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      rows.forEach(item => tx.objectStore('items').put({...item, key: JSON.stringify([item.uid, item.type, item.id])}));
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  const pdfSearch = page.getByLabel('Search PDFs');
  await expect(page.getByText('Algebra Notes')).toBeVisible();
  await expect(page.getByText('Private Notes')).toHaveCount(0);
  await pdfSearch.fill('  ALGEBRA  ');
  await expect(page.getByText('Algebra Notes')).toBeVisible();
  await expect(page.getByText('History Notes')).toHaveCount(0);
  await expect(page.getByRole('link', {name: 'Open Algebra Notes'})).toBeVisible();
  await page.getByRole('tab', {name: 'Video'}).click();
  const videoSearch = page.getByLabel('Search videos');
  await expect(videoSearch).toHaveValue('');
  await videoSearch.fill('history');
  await expect(page.getByText('History Lesson')).toBeVisible();
  await expect(page.getByText('Algebra Lesson')).toHaveCount(0);
  await videoSearch.fill('not found');
  await expect(page.getByText('No saved videos match your search.')).toBeVisible();
  await videoSearch.fill('history');
  await page.getByRole('button', {name: 'Delete'}).click();
  await page.getByRole('button', {name: 'Yes, Delete'}).click();
  await expect(page.getByText('No saved videos match your search.')).toBeVisible();
  await page.getByRole('tab', {name: 'PDF'}).click();
  await expect(pdfSearch).toHaveValue('  ALGEBRA  ');
  await expect(page.getByText('Algebra Notes')).toBeVisible();
  await pdfSearch.clear();
  await expect(page.getByText('History Notes')).toBeVisible();
  await page.getByRole('tab', {name: 'Video'}).click();
  await expect(videoSearch).toHaveValue('history');
  await videoSearch.clear();
  await expect(page.getByText('Algebra Lesson')).toBeVisible();
  await expect(page.getByText('History Lesson')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('admin reviews imported Gujarati questions, fixes missing answers, and publishes without JSON editing', async ({page, request}) => {
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Mock Tests/}).first().click();
  await page.getByRole('button', {name: 'Add Mock Test'}).click();
  const panel = page.locator('.publish-test-panel');
  const file = `પ્રશ્ન ૧. ગુજરાતની રાજધાની કઈ છે?
(A) અમદાવાદ (B) ગાંધીનગર
જવાબ: (B) ગાંધીનગર
પ્રશ્ન ૨. ૨ + ૨ = ?
(A) ૩ (B) ૪`;
  await panel.getByLabel('Question File', {exact: false}).first().setInputFiles({
    name: 'gujarati-questions.txt', mimeType: 'text/plain', buffer: Buffer.from(file),
  });
  await panel.locator('.publish-test-import').getByRole('button', {name: 'Import', exact: true}).click();
  await expect(panel.getByText('Imported 2 questions. 1 highlighted questions need review.')).toBeVisible();
  const review = panel.locator('.imported-question-review');
  await expect(review.locator('.imported-question')).toHaveCount(2);
  const missing = review.locator('.imported-question').nth(1);
  await expect(missing).toHaveClass(/needs-review/);
  await expect(missing.getByLabel('Question Text')).toHaveValue('૨ + ૨ = ?');
  const json = panel.getByLabel('Questions (JSON)', {exact: false});
  const pending = JSON.parse(await json.inputValue());
  expect(pending[1].answer).toBeNull();
  const headers = {Authorization: 'Bearer dummy:+919999999999'};
  const blocked = await request.post('/api/admin/courses/sample-bank-exam/tests', {
    headers, data: {title: 'Must not publish', questions: pending},
  });
  expect(blocked.status()).toBe(422);
  await missing.getByLabel('Correct Answer').selectOption('1');
  await expect(missing).not.toHaveClass(/needs-review/);
  await expect(review.getByText('2 of 200 questions · 0 need review')).toBeVisible();
  const resolved = JSON.parse(await json.inputValue());
  expect(resolved.map(question => question.answer)).toEqual([1, 1]);
  expect(resolved[1].reviewIssues).toBeUndefined();
  await panel.getByLabel('Course', {exact: false}).first().selectOption('sample-bank-exam');
  const title = `Reviewed Gujarati mock ${Date.now()}`;
  await panel.getByLabel('Test Title').fill(title);
  await panel.getByRole('button', {name: 'Publish Test', exact: true}).click();
  await expect(panel.getByText('Test published.', {exact: true})).toBeVisible();
  const published = await (await request.get('/api/admin/published', {headers})).json();
  expect(published.tests.some(test => test.title === title && test.questions.length === 2)).toBe(true);

  await panel.getByLabel('Test Creation Method').selectOption('manual');
  const manual = panel.locator('.manual-questions:not(.imported-question-review)');
  await expect(manual).toBeVisible();
  await manual.getByLabel('Question Text').fill('Manual draft remains independent?');
  await manual.getByLabel('Option A', {exact: true}).fill('Yes');
  await manual.getByLabel('Option B', {exact: true}).fill('No');
  await manual.getByLabel('Correct Answer').selectOption('1');
  await manual.getByRole('button', {name: 'Remove option a', exact: true}).click();
  await expect(manual.getByLabel('Correct Answer')).toHaveValue('0');
  await panel.getByLabel('Test Creation Method').selectOption('sectionwise');
  const section = panel.locator('.subject-question-card').first();
  await section.getByLabel('Question File').setInputFiles({
    name: 'review.txt', mimeType: 'text/plain',
    buffer: Buffer.from('1. Repair \u0000 text?\n(A) One\n(C) Two\nAnswer: C'),
  });
  await section.getByRole('button', {name: /Import questions for/}).click();
  const damaged = review.locator('.imported-question').first();
  await expect(damaged).toHaveClass(/needs-review/);
  await expect(damaged.getByText(/Unreadable characters/)).toBeVisible();
  await damaged.getByLabel('Question Text').fill('Repaired text?');
  await expect(damaged).toHaveClass(/needs-review/);
  await damaged.getByLabel('I checked this source question and its choice order.').check();
  await expect(damaged).not.toHaveClass(/needs-review/);
  await expect(damaged.getByLabel('Correct Answer')).toHaveValue('1');
  expect(JSON.parse(await json.inputValue())[0].reviewIssues).toBeUndefined();
});

test('admin can create and edit course details locally', async ({ page }) => {
  const suffix = Date.now();
  const title = `Local Course ${suffix}`;
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', { name: /Courses Course list/ }).click();
  await page.getByRole('button', { name: 'Add Course' }).click();
  await page.getByRole('textbox', { name: 'Course Title *' }).fill(title);
  await page.getByRole('textbox', { name: 'Description *' }).fill('Before edit');
  await page.getByRole('spinbutton', { name: 'Price (₹) *' }).fill('245');
  await page.getByLabel('Allow students to download course PDFs and chapter videos').check();
  await page.getByRole('button', { name: 'Create Live Course' }).click();
  await expect(page.getByText('Course created and available in the catalog.')).toBeVisible();

  const course = page.locator('.manage-item').filter({hasText: title});
  await expect(course).toBeVisible();
  await course.locator('summary').first().click();
  await course.getByRole('button', { name: 'Edit' }).click();
  await course.getByRole('textbox', { name: 'Course Title *' }).fill(title + ' Updated');
  await course.getByRole('textbox', { name: 'Description *' }).fill('After edit');
  await course.getByRole('spinbutton', { name: 'Price (₹) *' }).fill('275');
  await course.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText(`“${title}” was updated.`)).toBeVisible();
  await expect(page.getByRole('heading', { name: `${title} Updated` })).toBeVisible();
  await expect(course.getByText('Downloads enabled')).toBeVisible();
});

test('admin can create, edit and delete course content folders locally', async ({ page, request }) => {
  const suffix = Date.now();
  const parentName = `Parent ${suffix}`;
  const initialName = `Folder ${suffix}`;
  const editedName = `Edited ${suffix}`;
  const childName = `Child ${suffix}`;
  const bookName = `Folder book ${suffix}`;
  const videoName = `Folder video ${suffix}`;
  const chapterBook = `Chapter book ${suffix}`;
  await page.setViewportSize({width: 1100, height: 800});
  await signIn(page, '99999 99999');
  await page.goto('/#admin-course/sample-bank-exam');
  const create = page.locator('.folder-create-form');
  await expect(create).toBeVisible();
  for (const width of [1100, 390]) {
    await page.setViewportSize({width, height: 800});
    const panel = await create.locator('..').boundingBox();
    const control = await create.getByRole('button', {name: 'Create Folder'}).boundingBox();
    expect(control.width).toBeGreaterThan(90);
    expect(control.height).toBeLessThan(80);
    expect(control.x + control.width).toBeLessThanOrEqual(panel.x + panel.width);
  }
  await page.setViewportSize({width: 1100, height: 800});
  await create.getByLabel('New Folder Name').fill(parentName);
  await create.getByRole('button', {name: 'Create Folder'}).click();
  await expect(page.getByText('Folder created.')).toBeVisible();
  await page.getByRole('button', {name: 'Refresh folders and content'}).click();
  await expect(page.locator('.workspace-folder summary strong').filter({hasText: parentName})).toBeVisible();
  await create.getByLabel('New Folder Name').fill(initialName);
  await create.getByRole('button', {name: 'Create Folder'}).click();
  await expect(page.getByText('Folder created.')).toBeVisible();

  const folder = name => page.locator('.workspace-folder').filter({
    has: page.locator(':scope > details > summary > strong', {hasText: name}),
  });
  let target = folder(initialName);
  await target.getByRole('button', {name: 'Edit Folder'}).first().click();
  const edit = target.locator(':scope > details > .folder-edit-form');
  const fields = form => form.locator('input, select').evaluateAll(nodes =>
    nodes.map(node => ({tag: node.tagName, type: node.type, required: node.required,
      maxLength: node.maxLength, label: node.labels[0].textContent})));
  expect(await fields(edit)).toEqual(await fields(create));
  await expect(edit.getByLabel('New Folder Name')).toHaveValue(initialName);
  await expect(edit.getByLabel('Create Inside').locator('option:checked')).toHaveText('Course root');
  await edit.getByLabel('New Folder Name').fill('Discarded change');
  await target.getByRole('button', {name: 'Cancel Edit'}).first().click();
  await target.getByRole('button', {name: 'Edit Folder'}).first().click();
  await expect(edit.getByLabel('New Folder Name')).toHaveValue(initialName);
  await edit.getByLabel('New Folder Name').fill(editedName);
  await edit.getByLabel('Create Inside').selectOption({label: parentName});
  await edit.getByRole('button', {name: 'Save'}).click();
  await expect(page.getByText('Folder updated.')).toBeVisible();
  await page.reload();
  target = folder(editedName);
  await target.getByRole('button', {name: 'Edit Folder'}).first().click();
  await expect(target.locator(':scope > details > .folder-edit-form').getByLabel('New Folder Name')).toHaveValue(editedName);
  await expect(target.locator(':scope > details > .folder-edit-form').getByLabel('Create Inside').locator('option:checked')).toHaveText(parentName);

  await create.getByLabel('New Folder Name').fill(childName);
  await create.getByLabel('Create Inside').selectOption({label: `${parentName} / ${editedName}`});
  await create.getByRole('button', {name: 'Create Folder'}).click();
  const child = folder(childName);
  const upload = child.locator(':scope > details > form.section');
  await upload.getByLabel('Title').fill(bookName);
  await upload.getByLabel('PDF File').setInputFiles({name: 'book.pdf', mimeType: 'application/pdf', buffer: samplePdf()});
  await upload.getByRole('button', {name: 'Upload PDF to Folder'}).click();
  await expect(page.getByText('PDF uploaded to the folder.')).toBeVisible();
  const videoUpload = child.locator(':scope > details > form.section');
  await videoUpload.getByLabel('Content Type').selectOption('video');
  await videoUpload.getByLabel('Title').fill(videoName);
  await videoUpload.getByLabel('Video File').setInputFiles({name: 'lesson.mp4', mimeType: 'video/mp4',
    buffer: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64, 1)])});
  await videoUpload.getByRole('button', {name: 'Upload Video to Folder'}).click();
  await expect(page.getByText('Video uploaded to the folder.')).toBeVisible();
  const chapterUpload = child.locator(':scope > details > form.section');
  await chapterUpload.getByLabel('Title').fill(chapterBook);
  await chapterUpload.getByLabel('Chapter (optional)').fill('Chapter Two');
  await chapterUpload.getByLabel('PDF File').setInputFiles({name: 'chapter.pdf', mimeType: 'application/pdf', buffer: samplePdf()});
  await chapterUpload.getByRole('button', {name: 'Upload PDF to Folder'}).click();
  await expect(page.getByText('PDF uploaded to the folder.')).toBeVisible();
  const headers = {Authorization: 'Bearer dummy:+919999999999'};
  const workspace = async () => (await (await request.get('/api/admin/courses/sample-bank-exam/workspace?kind=content', {headers})).json());
  expect((await workspace()).items.some(item => item.title === bookName)).toBe(true);
  const content = await (await request.get('/api/courses/sample-bank-exam', {headers})).json();
  expect(content.books.find(item => item.title === bookName).chapter).toBe('');
  expect(content.videos.find(item => item.title === videoName).chapter).toBe('');
  await page.goto('/#course/sample-bank-exam');
  await page.getByRole('tab', {name: 'Content'}).click();
  for (const name of [parentName, editedName, childName]) {
    await page.getByRole('button', {name: `Open folder ${name}`, exact: false}).click();
  }
  await page.getByRole('button', {name: 'Open subject General', exact: false}).click();
  await expect(page.getByRole('link', {name: `Open PDF ${bookName}`})).toBeVisible();
  await expect(page.getByRole('link', {name: `Open Video ${videoName}`})).toBeVisible();
  await expect(page.getByRole('button', {name: /Open chapter Chapter 1/})).toHaveCount(0);
  await page.getByRole('button', {name: 'Open chapter Chapter Two', exact: false}).click();
  await expect(page.getByRole('link', {name: `Open PDF ${chapterBook}`})).toBeVisible();
  await page.goto('/#admin-course/sample-bank-exam');

  page.once('dialog', dialog => dialog.dismiss());
  await folder(editedName).getByRole('button', {name: 'Delete Folder'}).first().click();
  await expect(folder(childName)).toBeVisible();
  page.once('dialog', dialog => {
    expect(dialog.message()).toContain('all its subfolders, books, and videos');
    return dialog.accept();
  });
  await folder(editedName).getByRole('button', {name: 'Delete Folder'}).first().click();
  await expect(page.getByText('Folder deleted.')).toBeVisible();
  await page.reload();
  await expect(folder(editedName)).toHaveCount(0);
  await expect(folder(childName)).toHaveCount(0);
  await expect(folder(parentName)).toBeVisible();
  expect((await workspace()).items.some(item => item.title === bookName)).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await folder(parentName).getByRole('button', {name: 'Delete Folder'}).first().click();
  await expect(page.getByText('Folder deleted.')).toBeVisible();
  await page.getByRole('tab', {name: 'Mock Tests'}).click();
  await expect(page.getByRole('tab', {name: 'Mock Tests'})).toHaveAttribute('aria-selected', 'true');
  await create.getByLabel('New Folder Name').fill(`Test folder ${suffix}`);
  await create.getByRole('button', {name: 'Create Folder'}).click();
  const testFolder = folder(`Test folder ${suffix}`);
  await testFolder.getByLabel(`Folder name: Test folder ${suffix}`).fill(`Renamed test folder ${suffix}`);
  await testFolder.getByRole('button', {name: 'Save'}).click();
  await expect(folder(`Renamed test folder ${suffix}`)).toBeVisible();
});

test('Free Tests are removed while other public learning resources remain available', async ({ page, request }) => {
  const suffix = Date.now();
  const title = `Local Syllabus ${suffix}`;
  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', { name: /Learning Resources/ }).click();
  await page.getByRole('button', { name: 'Add Resource' }).click();
  const section = page.getByRole('combobox', { name: /Section/ });
  await expect(section.locator('option')).toHaveText([
    'Current affairs', 'Previous year questions', 'Syllabus',
  ]);
  await section.selectOption('syllabus');
  await expect(page.getByRole('textbox', {name: 'Short Summary *'})).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Content *'})).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Resource Title *' }).fill(title);
  await page.getByRole('button', { name: 'Publish Resource' }).click();
  await expect(page.getByText('Learning resource published.')).toBeVisible();

  const adminHeaders = {Authorization: 'Bearer dummy:+919999999999'};
  const managed = await request.get('/api/admin/published', {headers: adminHeaders});
  expect(managed.ok()).toBeTruthy();
  expect((await managed.json()).resources.some(item => item.kind === 'free-tests')).toBe(false);
  expect((await request.get('/api/content/free-tests', {headers: adminHeaders})).status()).toBe(404);
  expect((await request.post('/api/admin/content/free-tests', {
    headers: adminHeaders,
    data: {title, summary: 'removed', body: 'removed', publishedAt: '2026-01-01'},
  })).status()).toBe(422);

  await signIn(page);
  await page.goto('/#home');
  await expect(page.getByRole('link', {name: /Free Tests/})).toHaveCount(0);
  await expect(page.getByRole('link', {name: /Test Series/})).toBeVisible();
  await expect(page.getByRole('link', {name: /Previous Year Questions/})).toBeVisible();
  await page.goto('/#free-tests');
  await expect(page.getByRole('heading', {name: 'Page not found'})).toBeVisible();
  await page.goto('/#syllabus');
  await expect(page.getByRole('heading', {name: 'Syllabus', exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: title})).toBeVisible();
});

test('PYQs and Syllabus PDFs respect save permissions and appear in Downloads', async ({ page }) => {
  const suffix = Date.now();
  const pyqTitle = `Local PYQ PDF ${suffix}`;
  const syllabusTitle = `Local Syllabus PDF ${suffix}`;
  const file = {name: 'resource.pdf', mimeType: 'application/pdf', buffer: samplePdf()};

  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Learning Resources/}).click();
  await page.getByRole('button', {name: 'Add Resource'}).click();

  const section = page.getByRole('combobox', {name: /Section/});
  await section.selectOption('pyqs');
  await expect(page.getByRole('textbox', {name: 'Short Summary *'})).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Content *'})).toHaveCount(0);
  await page.getByRole('textbox', {name: 'Resource Title *'}).fill(pyqTitle);
  await page.getByLabel('PDF File (optional)').setInputFiles(file);
  await page.getByLabel('Allow PDF downloads').check();
  await page.getByRole('button', {name: 'Publish Resource'}).click();
  await expect(page.getByText('Learning resource published.')).toBeVisible();

  await section.selectOption('syllabus');
  await expect(page.getByRole('textbox', {name: 'Short Summary *'})).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Content *'})).toHaveCount(0);
  await page.getByRole('textbox', {name: 'Resource Title *'}).fill(syllabusTitle);
  await page.getByLabel('PDF File (optional)').setInputFiles(file);
  await page.getByRole('button', {name: 'Publish Resource'}).click();
  await expect(page.getByText('Learning resource published.')).toBeVisible();

  const pyqManageItem = page.locator('.manage-item').filter({hasText: pyqTitle});
  await expect(pyqManageItem).toBeVisible();
  await pyqManageItem.getByRole('button', {name: 'Edit'}).click();
  const pyqEditor = pyqManageItem.locator('.manage-editor');
  await expect(pyqEditor.getByText('Short Summary', {exact: true})).toHaveCount(0);
  await expect(pyqEditor.getByText('Content', {exact: true})).toHaveCount(0);
  await pyqEditor.getByRole('button', {name: 'Save Changes'}).click();
  await expect(page.getByText(`“${pyqTitle}” was updated.`)).toBeVisible();

  await signIn(page);
  await page.goto('/#pyqs');
  const pyqCard = page.locator('.resource-card').filter({hasText: pyqTitle});
  await expect(pyqCard.locator('.lead')).toHaveCount(0);
  await expect(pyqCard.getByText('Open Resource')).toHaveCount(0);
  await pyqCard.getByRole('link', {name: 'View PDF'}).click();
  await expect(page.getByRole('heading', {name: pyqTitle})).toBeVisible();
  await expect(page.getByRole('region', {name: `${pyqTitle} PDF pages`})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Previous page'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Next page'})).toHaveCount(0);
  await expect(page.getByRole('spinbutton', {name: 'Go to page'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Zoom in'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Save to Downloads'})).toBeVisible();
  const topbarBox = await page.locator('.pdf-reader-topbar').boundingBox();
  const downloadBox = await page.getByRole('button', {name: 'Save to Downloads'}).boundingBox();
  expect(Math.abs(topbarBox.x + topbarBox.width - downloadBox.x - downloadBox.width)).toBeLessThan(8);
  await page.getByRole('button', {name: 'Save to Downloads'}).click();
  await expect(page.getByText('Saved inside the app. Open it from Downloads.')).toBeVisible();
  await page.goto('/#downloads');
  await expect(page.locator('.download-row').filter({hasText: pyqTitle})).toBeVisible();
  await page.locator('.download-row').filter({hasText: pyqTitle}).getByRole('link', {name: 'Open'}).click();
  await expect(page.getByRole('heading', {name: pyqTitle})).toBeVisible();

  await page.goto('/#syllabus');
  const syllabusCard = page.locator('.resource-card').filter({hasText: syllabusTitle});
  await expect(syllabusCard.locator('.lead')).toHaveCount(0);
  await expect(syllabusCard.getByText('Open Resource')).toHaveCount(0);
  await syllabusCard.getByRole('link', {name: 'View PDF'}).click();
  await expect(page.getByText('View in the app. Downloads are disabled.')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Save to Downloads'})).toHaveCount(0);
});

test('Current Affairs supports imported mock and limited live tests in the date archive', async ({ page, request }) => {
  const suffix = Date.now();
  const mockTitle = `Current Affairs Mock ${suffix}`;
  const liveTitle = `Current Affairs Live ${suffix}`;
  const questions = [{prompt: 'What is 2 + 2?', options: ['3', '4'], answer: 1, section: 'General'}];
  const adminHeaders = {Authorization: 'Bearer dummy:+919999999999'};

  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await page.getByRole('button', {name: /Learning Resources/}).click();
  await page.getByRole('button', {name: 'Add Resource'}).click();
  const section = page.getByRole('combobox', {name: /Section/});
  const contentType = page.getByRole('combobox', {name: /Content Type/});
  await section.selectOption('current-affairs');
  await contentType.selectOption('test');
  await page.getByRole('textbox', {name: 'Resource Title *'}).fill(mockTitle);
  await page.locator('form').last().locator('input[type="date"]').fill('2025-06-15');
  await page.getByRole('combobox', {name: /Test Type/}).selectOption('mock');
  await page.locator('.question-import-panel input[type="file"]').setInputFiles({
    name: 'questions.pdf', mimeType: 'application/pdf', buffer: questionPdf(),
  });
  await page.getByRole('button', {name: 'Import Questions', exact: true}).click();
  await expect(page.locator('.question-import-panel .status')).toContainText('1 questions imported');
  const editor = page.getByRole('textbox', {name: 'Questions (JSON) *'});
  await expect(editor).toHaveValue(/What is 2 \+ 2/);
  await expect(editor).toBeEnabled();
  await page.getByRole('switch', {name: /Enable Question Paper Download/}).check();
  await page.getByRole('button', {name: 'Publish Current Affairs Test'}).click();
  await expect(page.getByText('Learning resource published.')).toBeVisible();

  await page.getByRole('button', {name: 'Add Resource'}).click();
  await section.selectOption('current-affairs');
  await contentType.selectOption('test');
  await page.getByRole('textbox', {name: 'Resource Title *'}).fill(liveTitle);
  await page.locator('form').last().locator('input[type="date"]').fill('2025-06-15');
  await page.getByRole('combobox', {name: /Test Type/}).selectOption('live');
  await page.getByRole('textbox', {name: 'Questions (JSON) *'}).fill(JSON.stringify(questions));
  const toIstInput = timestamp => new Date(timestamp + 330 * 60_000).toISOString().slice(0, 16);
  await page.locator('.current-affairs-test-fields input[type="datetime-local"]').nth(0).fill(toIstInput(Date.now() - 10 * 60_000));
  await page.locator('.current-affairs-test-fields input[type="datetime-local"]').nth(1).fill(toIstInput(Date.now() + 60 * 60_000));
  await page.locator('.current-affairs-test-fields input[type="number"]').nth(3).fill('1');
  await page.getByRole('button', {name: 'Publish Current Affairs Test'}).click();
  await expect(page.getByText('Learning resource published.')).toBeVisible();

  const archiveResponse = await request.get('/api/content/current-affairs', {headers: adminHeaders});
  expect(archiveResponse.ok()).toBeTruthy();
  const archive = await archiveResponse.json();
  const mockResource = archive.find(item => item.title === mockTitle);
  const liveResource = archive.find(item => item.title === liveTitle);
  expect(mockResource.test.live).toBe(false);
  expect(liveResource.test.live).toBe(true);
  const published = await (await request.get('/api/admin/published', {headers: adminHeaders})).json();
  const mock = published.tests.find(item => item.id === mockResource.test.id);
  const live = published.tests.find(item => item.id === liveResource.test.id);
  expect(mock.resourceId).toBe(mockResource.id);
  expect(live.courseTitle).toBe('Current Affairs');
  expect(published.courses.some(item => item.id === mock.course)).toBe(false);

  await signIn(page);
  await page.goto('/#current-affairs');
  await page.getByRole('button', {name: /2025/}).click();
  await page.getByRole('button', {name: /June/}).click();
  const day = page.locator('.affairs-day').filter({hasText: '15 June 2025'});
  await expect(day).toBeVisible();

  for (const [resource, buttonName] of [[mockResource, 'Take Mock Test'], [liveResource, 'Take Live Test']]) {
    await page.goto('/#current-affairs');
    await page.getByRole('button', {name: /2025/}).click();
    await page.getByRole('button', {name: /June/}).click();
    const resourceCard = page.locator('.affairs-resource-card').filter({hasText: resource.title});
    await resourceCard.getByRole('link', {name: buttonName}).click();
    await expect(page.getByRole('heading', {name: resource.title})).toBeVisible();
    await page.locator('.exam-option').nth(1).click();
    page.once('dialog', dialog => dialog.accept());
    const submissionResponse = page.waitForResponse(response =>
      response.url().endsWith(`/api/tests/${resource.test.id}/submit`) && response.request().method() === 'POST');
    await page.getByRole('button', {name: 'Submit Exam'}).click();
    const submission = await (await submissionResponse).json();
    await expect(page.getByRole('heading', {name: 'Your Result'})).toBeVisible();
    const headers = {Authorization: 'Bearer dummy:+919876543210'};
    const details = await request.get(`/api/tests/${resource.test.id}`, {headers});
    if (resource.test.id === mockResource.test.id) {
      expect(details.status()).toBe(200);
      expect((await details.json()).attempts).toBe(1);
      expect((await request.get(`/api/tests/${resource.test.id}/question-paper.pdf`, {headers})).status()).toBe(200);
      expect((await request.get(`/api/attempts/${submission.attemptId}/result.pdf`, {headers})).status()).toBe(200);
    } else {
      expect(details.status()).toBe(409);
      expect((await request.get(`/api/tests/${resource.test.id}/question-paper.pdf`, {headers})).status()).toBe(403);
    }
  }
});
