const { test, expect } = require('./coverage-fixtures');
const baseUrl = process.env.COVERAGE_BASE_URL || 'http://localhost:3000';

test.describe('Authentication Tests', () => {
  test('admin login with valid credentials succeeds and redirects to admin claims', async ({ page }) => {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });

    await page.locator('[data-login-tab="admin"]').click();
    await expect(page.locator('#admin-login-panel')).toBeVisible();
    await page.locator('#admin-login-panel [name="username"]').fill('admin');
    await page.locator('#admin-login-panel [name="password"]').fill('admin123');
    await page.getByRole('button', { name: /log in as admin/i }).click();

    await expect(page).toHaveURL(/\/admin\/claims/);
  });

  test('admin login with invalid credentials shows an error and does not redirect', async ({ page }) => {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });

    await page.locator('[data-login-tab="admin"]').click();
    await expect(page.locator('#admin-login-panel')).toBeVisible();
    await page.locator('#admin-login-panel [name="username"]').fill('admin');
    await page.locator('#admin-login-panel [name="password"]').fill('wrong-password');
    await page.getByRole('button', { name: /log in as admin/i }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('.login-error')).toContainText('Invalid username or password');
  });

  test('visiting admin claims without logging in redirects to login', async ({ page }) => {
    await page.goto(`${baseUrl}/admin/claims`, { waitUntil: 'networkidle' });

    await expect(page).toHaveURL(/\/login/);
  });

  test('user login with empty fields shows a required fields error', async ({ page }) => {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });

    await expect(page.locator('#user-login-panel')).toBeVisible();
    await page.evaluate(() => {
      document.querySelector('form[action="/login/user"]').noValidate = true;
    });
    await page.getByRole('button', { name: /log in as user/i }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('.login-error')).toContainText('Please enter your name and policy number');
  });

  test('user login with a non-matching name and policy number shows a not found error', async ({ page }) => {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });

    await expect(page.locator('#user-login-panel')).toBeVisible();
    await page.locator('#user-login-panel [name="full_name"]').fill('No Matching Claim');
    await page.locator('#user-login-panel [name="policy_number"]').fill('POL-000000');
    await page.getByRole('button', { name: /log in as user/i }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('.login-error')).toContainText('No claim found for that name and policy number');
  });

  test('visiting my claims without logging in redirects to login', async ({ page }) => {
    await page.goto(`${baseUrl}/my-claims`, { waitUntil: 'networkidle' });

    await expect(page).toHaveURL(/\/login/);
  });

  test('logout destroys an admin session and protected admin claims redirects back to login', async ({ page }) => {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });

    await page.locator('[data-login-tab="admin"]').click();
    await expect(page.locator('#admin-login-panel')).toBeVisible();
    await page.locator('#admin-login-panel [name="username"]').fill('admin');
    await page.locator('#admin-login-panel [name="password"]').fill('admin123');
    await page.getByRole('button', { name: /log in as admin/i }).click();
    await expect(page).toHaveURL(/\/admin\/claims/);

    await page.goto(`${baseUrl}/logout`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(`${baseUrl}/`);

    await page.goto(`${baseUrl}/admin/claims`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/login/);
  });
});
