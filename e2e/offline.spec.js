import {test, expect} from '@playwright/test';

async function prepare(page) {
  await page.goto('/#signin');
  await expect(page.getByLabel('Mobile Number')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
}

async function expectOffline(page) {
  await expect(page.getByText('No internet connection')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Retry', exact: true})).toBeVisible();
  const visibleText = await page.locator('body').evaluate(body => body.innerText);
  expect(visibleText).not.toMatch(/saved content|webpage not available|net::err_|failed to fetch|stack trace/i);
}

test('sign-in requires a connection and resumes when the network returns', async ({page, context}) => {
  await prepare(page);
  await page.getByLabel('Mobile Number').fill('98765 43210');
  await page.getByRole('checkbox', {name: 'CCE'}).check();
  await context.setOffline(true);
  await expectOffline(page);
  await expect(page.getByText('An internet connection is required to log in.')).toBeVisible();
  await page.locator('#auth-form form').evaluate(form => form.requestSubmit());
  await expect(page.getByRole('button', {name: 'Send OTP', includeHidden: true})).toBeEnabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mission-selection-dummy-phone'))).toBeNull();
  await page.getByRole('button', {name: 'Retry', exact: true}).click();
  await expectOffline(page);
  await context.setOffline(false);
  await expect(page.getByLabel('Mobile Number')).toBeVisible();
  await page.getByRole('button', {name: 'Send OTP'}).click();
  await page.getByLabel('6-Digit OTP').fill('123456');
  await page.getByRole('button', {name: 'Verify and Sign In'}).click();
  await expect(page).not.toHaveURL(/#signin/);
});

test('offline launch uses the cached fallback and reconnects automatically', async ({page, context}) => {
  await prepare(page);
  await context.setOffline(true);
  await page.reload();
  await expectOffline(page);
  await expect(page.getByText('An internet connection is required to log in.')).toBeVisible();
  expect(await page.evaluate(() => fetch('/api/config').then(() => true, () => false))).toBe(false);
  await context.setOffline(false);
  await expect(page.getByLabel('Mobile Number')).toBeVisible({timeout: 15000});
  await expect(page.getByText('No internet connection')).toBeHidden();
});

test('signed-in users see the offline notice without losing their session', async ({page, context}) => {
  await prepare(page);
  await page.getByLabel('Mobile Number').fill('98765 43211');
  await page.getByRole('checkbox', {name: 'CCE'}).check();
  await page.getByRole('button', {name: 'Send OTP'}).click();
  await page.getByLabel('6-Digit OTP').fill('123456');
  await page.getByRole('button', {name: 'Verify and Sign In'}).click();
  await expect(page).not.toHaveURL(/#signin/);
  await context.setOffline(true);
  await expectOffline(page);
  await expect(page.getByText('Please check your connection and try again.')).toBeVisible();
  await page.reload();
  await expectOffline(page);
  await context.setOffline(false);
  await expect(page.getByRole('link', {name: 'Profile'})).toBeVisible({timeout: 15000});
  await page.reload();
  await expect(page.getByRole('link', {name: 'Profile'})).toBeVisible();
});

test('a submitted OTP cannot complete sign-in while offline', async ({page, context}) => {
  await prepare(page);
  await page.getByLabel('Mobile Number').fill('98765 43213');
  await page.getByRole('checkbox', {name: 'CCE'}).check();
  await page.getByRole('button', {name: 'Send OTP'}).click();
  await page.getByLabel('6-Digit OTP').fill('123456');
  await context.setOffline(true);
  await expectOffline(page);
  await page.locator('#auth-form form').evaluate(form => form.requestSubmit());
  await expect(page.getByRole('button', {name: 'Verify and Sign In', includeHidden: true})).toBeEnabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mission-selection-dummy-phone'))).toBeNull();
  await context.setOffline(false);
  await expect(page.getByLabel('6-Digit OTP')).toBeVisible();
  await page.getByRole('button', {name: 'Verify and Sign In'}).click();
  await expect(page).not.toHaveURL(/#signin/);
});

test('unreachable service blocks login even when the browser reports online', async ({page}) => {
  await prepare(page);
  await page.getByLabel('Mobile Number').fill('98765 43212');
  await page.getByRole('checkbox', {name: 'CCE'}).check();
  await page.route('**/api/config', route => route.abort('namenotresolved'));
  await page.getByRole('button', {name: 'Send OTP'}).click();
  await expectOffline(page);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('mission-selection-dummy-phone'))).toBeNull();
  await page.unroute('**/api/config');
  await page.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(page.getByLabel('Mobile Number')).toBeVisible();
  await page.getByRole('button', {name: 'Send OTP'}).click();
  await expect(page.getByLabel('6-Digit OTP')).toBeVisible();
});

test('service failures show a friendly message and can be retried', async ({page}) => {
  await prepare(page);
  await page.getByLabel('Mobile Number').fill('98765 43214');
  await page.getByRole('checkbox', {name: 'CCE'}).check();
  await page.getByRole('button', {name: 'Send OTP'}).click();
  await page.getByLabel('6-Digit OTP').fill('123456');
  await page.getByRole('button', {name: 'Verify and Sign In'}).click();
  await expect(page).not.toHaveURL(/#signin/);
  await page.route('**/api/courses', route => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({error: 'net::ERR_NAME_NOT_RESOLVED'}),
  }));
  await page.goto('/#catalog');
  await expect(page.getByText('Something went wrong. Please try again later.')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/net::err_|failed to fetch|stack trace/i);
  await page.unroute('**/api/courses');
  await page.getByRole('button', {name: 'Try Again'}).click();
  await expect(page.getByRole('heading', {name: 'All Courses'})).toBeVisible();
  await expect(page.getByText('Something went wrong. Please try again later.')).toBeHidden();
});
