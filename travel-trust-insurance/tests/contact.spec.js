const { test, expect } = require('./coverage-fixtures');
const baseUrl = process.env.COVERAGE_BASE_URL || 'http://localhost:3000';

test.describe('Contact Page Tests', () => {
  test('should submit the contact form successfully with valid data', async ({ page }) => {
    await page.goto(`${baseUrl}/contact`, { waitUntil: 'networkidle' });

    await page.getByLabel('Name').fill('Jordan Taylor');
    await page.getByLabel('Email').fill('jordan.taylor@example.com');
    await page.getByLabel('Message').fill('I would like help choosing travel insurance for an upcoming trip.');

    await page.getByRole('button', { name: /send message/i }).click();

    const confirmation = page.getByText(/thank you for reaching out/i);
    await expect(confirmation).toBeVisible({ timeout: 5000 });
  });

  test('should show a validation error for an invalid email without crashing', async ({ page }) => {
    await page.goto(`${baseUrl}/contact`, { waitUntil: 'networkidle' });

    await page.getByLabel('Name').fill('Jordan Taylor');
    await page.getByLabel('Email').fill('notanemail');
    await page.getByLabel('Message').fill('I need help with an insurance question.');

    await page.getByLabel('Email').evaluate(el => {
      el.form.noValidate = true;
    });

    await page.getByRole('button', { name: /send message/i }).click();

    await expect(page.getByText(/valid email/i)).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/contact/);
  });

  test('should prevent contact form submission when required fields are empty', async ({ page }) => {
    await page.goto(`${baseUrl}/contact`, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: /send message/i }).click();

    await expect(page).toHaveURL(/\/contact/);

    const nameInput = page.getByLabel('Name');
    const validationMessage = await nameInput.evaluate(el => el.validationMessage);
    expect(validationMessage.length).toBeGreaterThan(0);
  });
});
