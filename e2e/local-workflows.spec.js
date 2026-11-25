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

test('dummy student sign-in and protected course access', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/#catalog');
  await expect(page.getByRole('heading', { name: 'All Courses' })).toBeVisible();
  await page.goto('/#course/sample-bank-exam');
  await expect(page.getByRole('heading', { name: 'Pay ₹149.00' }).or(
    page.getByRole('heading', { name: 'Course Access' }),
  ).first()).toBeVisible();
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
  await page.getByLabel('UPI Transaction Reference').fill(reference);
  await page.getByRole('button', { name: 'Submit for Admin Approval' }).click();

  await signIn(page, '99999 99999');
  await page.goto('/#admin');
  await expect(page.getByRole('heading', { name: 'Admin Workspace' })).toBeVisible();
  await page.getByRole('button', { name: /Course Payments/ }).click();
  const payment = page.locator('.payment-request').filter({ hasText: reference });
  await payment.getByRole('button', { name: 'Approve and Unlock' }).click();

  await signIn(page, phone);
  await page.goto('/#course/sample-bank-exam');
  await expect(page.getByRole('heading', { name: 'Practice & Live Tests' }).or(page.getByText('Practice & Live Tests'))).toBeVisible();
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

test('downloads page exposes separate PDF and Video tabs and persists items', async ({ page }) => {
  await signIn(page);
  await page.goto('/#downloads');
  await expect(page.getByRole('tab', { name: 'PDF' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Video' })).toBeVisible();
  await page.getByRole('tab', { name: 'Video' }).click();
  await expect(page.getByText('Nothing saved yet')).toBeVisible();
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
  await course.getByRole('button', { name: 'Edit' }).click();
  await course.getByRole('textbox', { name: 'Course Title *' }).fill(title + ' Updated');
  await course.getByRole('textbox', { name: 'Description *' }).fill('After edit');
  await course.getByRole('spinbutton', { name: 'Price (₹) *' }).fill('275');
  await course.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText(`“${title}” was updated.`)).toBeVisible();
  await expect(page.getByRole('heading', { name: `${title} Updated` })).toBeVisible();
  await expect(course.getByText('Downloads enabled')).toBeVisible();
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
    'Current Affairs', 'Previous Year Questions', 'Syllabus',
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
  await expect(page.getByRole('heading', {name: 'Page Not Found'})).toBeVisible();
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
  await expect(page.getByRole('button', {name: 'Save to Downloads'})).toBeVisible();
  await page.getByRole('button', {name: 'Save to Downloads'}).click();
  await expect(page.getByText('Saved inside the app. Open it from Downloads.')).toBeVisible();
  await page.getByRole('link', {name: 'Open Downloads'}).click();
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
