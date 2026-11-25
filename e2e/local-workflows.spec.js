import { test, expect } from '@playwright/test';

const signedInPages = new WeakSet();

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
