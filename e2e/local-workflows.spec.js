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
  await expect(page.getByRole('heading', { name: 'Admin Workspace' })).toBeVisible();
  await page.getByRole('button', { name: /Course Payments/ }).click();
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
  await signIn(page, '99999 99999');
  await page.goto('/#admin-course/sample-bank-exam');
  const create = page.locator('.folder-create-form');
  await expect(create).toBeVisible();
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
  const headers = {Authorization: 'Bearer dummy:+919999999999'};
  const workspace = async () => (await (await request.get('/api/admin/courses/sample-bank-exam/workspace?kind=content', {headers})).json());
  expect((await workspace()).items.some(item => item.title === bookName)).toBe(true);

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
  await expect(page.getByRole('button', {name: 'Previous page'})).toBeVisible();
  await page.getByRole('button', {name: 'Zoom in'}).click();
  await expect(page.getByText('125%', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Save to Downloads'})).toBeVisible();
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
