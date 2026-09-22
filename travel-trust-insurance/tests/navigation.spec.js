const { test, expect } = require('./coverage-fixtures');
const baseUrl = process.env.COVERAGE_BASE_URL || 'http://localhost:3000';

test.describe('Navigation Tests', () => {

  test('Homepage loads with correct title and navigation bar', async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });

    // Verify the page title contains "TravelTrust"
    await expect(page).toHaveTitle(/TravelTrust/);

    // Verify the main navigation bar is visible
    const navbar = page.locator('.navbar');
    await expect(navbar).toBeVisible();
  });

  test('Navigate to Products page via URL', async ({ page }) => {
    await page.goto(`${baseUrl}/products`, { waitUntil: 'networkidle' });

    // Verify the URL changed to /products
    await expect(page).toHaveURL(/\/products/);

    // Verify the page title reflects the products page
    await expect(page).toHaveTitle(/Insurance Products/);

    // Verify the navigation bar is still visible after navigating
    await expect(page.locator('.navbar')).toBeVisible();
  });

  test('Navigate to About page via top-bar link', async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });

    // Click the "About" link in the top bar
    await page.getByRole('link', { name: 'About' }).click();

    // Wait for navigation to complete
    await page.waitForLoadState('networkidle');

    // Verify the URL changed to /about
    await expect(page).toHaveURL(/\/about/);

    // Verify the page title reflects the about page
    await expect(page).toHaveTitle(/About Us/);

    // Verify the navigation bar is still visible
    await expect(page.locator('.navbar')).toBeVisible();
  });

  test('Navigate to Contact page via top-bar link', async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });

    // Click the "Contact Us" link in the top bar
    await page.getByRole('link', { name: /Contact/i }).first().click();

    // Wait for navigation to complete
    await page.waitForLoadState('networkidle');

    // Verify the URL changed to /contact
    await expect(page).toHaveURL(/\/contact/);

    // Verify the page title reflects the contact page
    await expect(page).toHaveTitle(/Contact Us/);

    // Verify the navigation bar is still visible
    await expect(page.locator('.navbar')).toBeVisible();
  });

  test('Navigate to Claim page directly', async ({ page }) => {
    await page.goto(`${baseUrl}/claim`, { waitUntil: 'networkidle' });

    // Verify the URL changed to /claim
    await expect(page).toHaveURL(/\/claim/);

    // Verify the page title reflects the claim page
    await expect(page).toHaveTitle(/File a Claim/);

    // Verify the navigation bar is still visible
    await expect(page.locator('.navbar')).toBeVisible();
  });

  test('Navigate to Login page (replaces /agents — not available in this app)', async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });

    // Click the "Log in" button in the navigation
    await page.getByRole('link', { name: 'Log in' }).click();

    // Wait for navigation to complete
    await page.waitForLoadState('networkidle');

    // Verify the URL changed to /login
    await expect(page).toHaveURL(/\/login/);

    // Verify the navigation bar is still visible
    await expect(page.locator('.navbar')).toBeVisible();
  });

  test('Navigate to Claim Status page', async ({ page }) => {
    await page.goto(`${baseUrl}/claim-status`, { waitUntil: 'networkidle' });

    // Verify the URL changed to /claim-status
    await expect(page).toHaveURL(/\/claim-status/);
  });

  test('Navigate to Quote page', async ({ page }) => {
    await page.goto(`${baseUrl}/quote`, { waitUntil: 'networkidle' });

    // Verify the URL changed to /quote
    await expect(page).toHaveURL(/\/quote/);
  });

});

