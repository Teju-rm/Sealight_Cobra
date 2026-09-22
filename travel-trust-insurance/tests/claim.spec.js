const { test, expect } = require('./coverage-fixtures');
const baseUrl = process.env.COVERAGE_BASE_URL || 'http://localhost:3000';

test.describe('Claims Flow Tests', () => {
  test('should submit a claim and look up its status with the generated Claim ID', async ({ page }) => {
    const policyNumber = 'POL-123456';
    const claimIdPattern = /CLM-[A-Z0-9]+(?:-[A-Z0-9]+)?/;

    await page.goto(`${baseUrl}/claim`, { waitUntil: 'networkidle' });

    await page.getByLabel('Full Name').fill('Avery Morgan');
    await page.getByLabel('Policy Number').fill(policyNumber);
    await page.getByLabel('Email Address').fill('avery.morgan@example.com');
    await page.getByLabel('Phone Number').fill('(555) 123-4567');
    await page.getByLabel('Description of Incident').fill('My luggage was delayed during an international connection.');

    await page.getByRole('button', { name: /submit claim/i }).click();

    const claimIdMessage = page.locator('#claimResponse');
    await expect(claimIdMessage).toBeVisible({ timeout: 5000 });
    const claimResponseHTML = await claimIdMessage.innerHTML();
    const match = claimResponseHTML.match(/Claim ID:\s*([A-Z0-9-]+)\s*<br>/i);
    if (!match) {
      throw new Error(`Could not extract Claim ID from response HTML: ${claimResponseHTML}`);
    }
    const claimId = match[1].trim();

    await page.goto(`${baseUrl}/claim-status`, { waitUntil: 'networkidle' });

    await page.getByLabel('Claim ID').fill(claimId);
    await page.getByLabel('Policy Number').fill(policyNumber);
    await page.getByRole('button', { name: /check status/i }).click();

    const claimStatusResult = page.locator('#claimStatusResponse');
    await expect(claimStatusResult).toBeVisible({ timeout: 10000 });
    await expect(claimStatusResult.getByText(claimId)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(policyNumber)).toBeVisible();
    await expect(page.getByRole('heading', { name: /submitted|pending|in review|approved/i })).toBeVisible();
  });

  test('should show a not found message for a non-existent claim status lookup', async ({ page }) => {
    await page.goto(`${baseUrl}/claim-status`, { waitUntil: 'networkidle' });

    await page.getByLabel('Claim ID').fill('CLM-NOTREAL');
    await page.getByLabel('Policy Number').fill('POL-000000');
    await page.getByRole('button', { name: /check status/i }).click();

    await expect(page.getByText(/no claim found|not found/i)).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/claim-status/);
  });

  test('should prevent claim submission when required fields are empty', async ({ page }) => {
    await page.goto(`${baseUrl}/claim`, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: /submit claim/i }).click();

    await expect(page).toHaveURL(/\/claim/);

    const fullNameInput = page.getByLabel('Full Name');
    const validationMessage = await fullNameInput.evaluate(el => el.validationMessage);
    expect(validationMessage.length).toBeGreaterThan(0);
  });
});
