import { expect, test } from '@playwright/test';
import { mockApi } from './mockApi';

test.describe('signing in', () => {
  test('logs in and lands on the tax year', async ({ page }) => {
    await mockApi(page, { signedIn: false });
    await page.goto('/cgt/transactions');
    await expect(page).toHaveURL('/login');
    await page.getByLabel('E-Mail Address').fill('admin@example.com');
    await page.getByLabel('Password').fill('secret');
    await page.getByRole('button', { name: 'Login' }).click();
    // back to the page that was asked for
    await expect(page).toHaveURL('/cgt/transactions');
    await expect(page.getByRole('heading', { level: 1, name: 'Purchases & sales' })).toBeVisible();

    // the login survives a reload through the refresh cookie, not browser storage
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('token')))).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Purchases & sales' })).toBeVisible();
  });

  test('opens the calculator at the site address', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page).toHaveURL('/cgt');
    await expect(page.getByText('CGT Calculator').first()).toBeVisible();
  });

  test('asks for a password reset link', async ({ page }) => {
    await mockApi(page, { signedIn: false });
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page).toHaveURL('/forgot-password');
    await page.getByLabel('E-Mail Address').fill('admin@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });
});

test.describe('the calculator', () => {
  test('records a purchase typed in, at the ECB rate of the day', async ({ page }) => {
    const api = await mockApi(page);
    await page.goto('/cgt/transactions');
    await page.getByLabel('Date').fill('2025-09-17');
    await page.getByLabel('Ticker').fill('acme');
    await page.getByLabel('Shares').fill('10');
    await page.getByLabel('Currency', { exact: true }).selectOption('USD');
    await page.getByLabel('Price a share (USD)').fill('117.12');
    await page.getByRole('button', { name: 'Add purchase' }).click();
    await expect(page.getByRole('button', { name: 'Change ACME on 17 Sept 2025' })).toBeVisible();
    expect(api.transactions.at(-1)).toMatchObject({ symbol: 'ACME', quantity: 10, price: 117.12, currency: 'USD' });
  });

  test('every page renders without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockApi(page);
    for (const [path, heading] of [
      ['/cgt?year=2025', /Tax year/],
      ['/cgt/cg1?year=2025', /Form CG1/],
      ['/cgt/form11?year=2025', /Form 11/],
      ['/cgt/transactions', 'Purchases & sales'],
      ['/cgt/import', 'Import a statement'],
      ['/users', 'Users'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('pages have no horizontal scroll', async ({ page }) => {
    await mockApi(page);
    for (const path of ['/cgt', '/cgt/cg1', '/cgt/form11', '/cgt/transactions', '/cgt/import', '/users', '/login']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test('dark mode is remembered across visits', async ({ page }) => {
    const api = await mockApi(page);
    await page.goto('/cgt');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
    await expect.poll(() => api.settings.theme).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout only');

  test('menu slides in, closes on a tap outside and after navigating', async ({ page }) => {
    await mockApi(page);
    await page.goto('/cgt');
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).not.toBeInViewport();

    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(sidebar).toBeInViewport();
    await page.mouse.click(page.viewportSize()!.width - 10, 400);
    await expect(sidebar).not.toBeInViewport();

    await page.getByRole('button', { name: 'Open menu' }).click();
    await sidebar.getByRole('link', { name: 'Purchases & sales' }).click();
    await expect(page).toHaveURL('/cgt/transactions');
    await expect(sidebar).not.toBeInViewport();
  });
});
