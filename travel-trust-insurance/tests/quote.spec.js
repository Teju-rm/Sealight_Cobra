const { test, expect } = require('./coverage-fixtures');
const baseUrl = process.env.COVERAGE_BASE_URL || 'http://localhost:3000';

test.describe('Quote Form Tests', () => {

  test('should submit the quote form successfully with valid data', async ({ page }) => {
    await page.goto(`${baseUrl}/quote`, { waitUntil: 'networkidle' });

    // Fill in the form using label-based locators
    await page.getByLabel('Full Name').fill('Jane Doe');
    await page.getByLabel('ZIP Code').fill('10001');
    await page.getByLabel('Insurance Type').selectOption('auto');
    await page.getByLabel('Email').fill('jane@example.com');
    await page.getByLabel('Phone').fill('(555) 123-4567');

    // Click the submit button
    await page.getByRole('button', { name: /get my quote/i }).click();

    // Wait for the client-side response to appear
    const responseArea = page.locator('#quotePageResponse');
    await expect(responseArea).toBeVisible({ timeout: 5000 });

    // Verify a success confirmation message appears
    await expect(responseArea).toHaveClass(/success/);
    await expect(responseArea).toContainText(/thank you/i);
  });

  test('should show a validation error for an invalid ZIP code', async ({ page }) => {
    await page.goto(`${baseUrl}/quote`, { waitUntil: 'networkidle' });

    // Fill in the form with an invalid ZIP code
    await page.getByLabel('Full Name').fill('John Smith');
    await page.getByLabel('ZIP Code').fill('abc');
    await page.getByLabel('Insurance Type').selectOption('travel');
    await page.getByLabel('Email').fill('john@example.com');
    await page.getByLabel('Phone').fill('(555) 555-5555');

    // Disable browser HTML5 validation so the client-side JS / server handles it
    await page.evaluate(() => {
      document.getElementById('quotePageForm').noValidate = true;
    });

    // Click the submit button
    await page.getByRole('button', { name: /get my quote/i }).click();

    // Wait for the response area to appear with the error
    const responseArea = page.locator('#quotePageResponse');
    await expect(responseArea).toBeVisible({ timeout: 5000 });

    // Verify an error message about ZIP code is shown
    await expect(responseArea).toHaveClass(/error/);
    await expect(responseArea).toContainText(/zip/i);

    // Confirm the page is still on the /quote page (no crash / redirect)
    await expect(page).toHaveURL(/\/quote/);
  });

  test('should prevent submission when required fields are empty', async ({ page }) => {
    await page.goto(`${baseUrl}/quote`, { waitUntil: 'networkidle' });

    // Click the submit button without filling any fields
    await page.getByRole('button', { name: /get my quote/i }).click();

    // The browser's HTML5 validation should prevent the form from submitting,
    // so the page should remain on /quote.
    await expect(page).toHaveURL(/\/quote/);

    // Verify the success response area did not appear (form was not submitted)
    const responseArea = page.locator('#quotePageResponse');
    await expect(responseArea).not.toBeVisible();

    // Verify browser-level validation was triggered on a required field
    // (the browser shows validation bubbles, but we can check the input's validity state)
    const fullNameInput = page.locator('#fullName');
    const validationMessage = await fullNameInput.evaluate(el => el.validationMessage);
    expect(validationMessage.length).toBeGreaterThan(0);
  });

});

