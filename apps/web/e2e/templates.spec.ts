import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

const API = process.env.NEXT_PUBLIC_ORGFLOW_API_URL ?? 'http://localhost:4000/api/v1';

// Setting up a template needs a published process to save, and there is no
// "save as template" button in the interface yet. Doing that through the API
// with the browser's own session cookie is setup, not a back door: the
// assertions below all go through the page. The cookie reaches port 4000
// because cookie scope is host-based and ignores the port.
async function createPublishedProcess(page: Page, name: string): Promise<string> {
  await page.goto('/processes/new');
  await page.getByLabel('Process name').fill(name);
  await page.getByLabel('Reference prefix').fill('tpl');
  await page.getByRole('button', { name: 'Create and open the builder' }).click();
  await page.waitForURL(/\/processes\/[0-9a-f-]{36}$/);

  const definitionId = new URL(page.url()).pathname.split('/').pop()!;

  await page.getByRole('tab', { name: 'workflow' }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByLabel('Step name').fill('Manager approval');
  await page
    .getByText('Approve goes to')
    .locator('..')
    .getByRole('button', { name: 'Add default' })
    .click();
  await page.getByLabel('Where "Approve" rule 1 goes').selectOption('$completed');
  await page
    .getByText('Reject goes to')
    .locator('..')
    .getByRole('button', { name: 'Add default' })
    .click();
  await page.getByLabel('Where "Reject" rule 1 goes').selectOption('$rejected');

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published as v1')).toBeVisible();

  return definitionId;
}

async function saveAsTemplate(page: Page, definitionId: string, name: string) {
  const response = await page.request.post(`${API}/templates`, {
    data: { definitionId, name, category: 'Testing' },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test.describe('templates', () => {
  test('lists a saved template and copies it into an editable draft', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);

    const label = `Template source ${Date.now()}`;
    const definitionId = await createPublishedProcess(page, label);
    const templateName = `Reusable ${Date.now()}`;
    await saveAsTemplate(page, definitionId, templateName);

    await page.goto('/templates');
    const card = page.getByRole('listitem').filter({ hasText: templateName });
    await expect(card).toBeVisible();
    // PRD.md §9.1's scope, stated on the card with a label rather than only
    // a colour.
    await expect(card.getByText('Your organisation')).toBeVisible();

    await card.getByRole('button', { name: 'Use this' }).click();

    await expect(page.getByText('as a draft in your organisation')).toBeVisible();
    await expect(page.getByText('Nothing is published yet')).toBeVisible();

    // The copy is a real, separate draft: opening it lands in the builder.
    await page.getByRole('link', { name: 'Open it in the builder' }).click();
    await page.waitForURL(/\/processes\/[0-9a-f-]{36}$/);
    const clonedId = new URL(page.url()).pathname.split('/').pop()!;
    expect(clonedId).not.toBe(definitionId);
    await expect(page.getByRole('tab', { name: 'workflow' })).toBeVisible();
  });

  test('shows the six built-in templates, and copies one that runs', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    await page.goto('/templates');

    // PRD.md §9.3's catalogue, seeded at API boot.
    for (const name of [
      'Equipment request',
      'System access request',
      'Expense claim',
      'New starter onboarding',
      'Annual leave request',
      'Policy exception',
    ]) {
      await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
    }

    const card = page.getByRole('listitem').filter({ hasText: 'New starter onboarding' });
    await expect(card.getByText('Built in')).toBeVisible();
    await card.getByRole('button', { name: 'Use this' }).click();

    // Every step of onboarding is assigned to a group that does not exist
    // in a fresh organisation, so all four are reset and named (ADR-0043).
    await expect(page.getByText('4 steps need somebody assigned to them')).toBeVisible();
    await expect(page.getByText(/went to a group called "hr"/)).toBeVisible();

    await page.getByRole('link', { name: 'Open it in the builder' }).click();
    await page.waitForURL(/\/processes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('tab', { name: 'workflow' })).toBeVisible();
  });

  test('saves a process as a template from the builder, in three clicks', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);

    const label = `Button source ${Date.now()}`;
    await createPublishedProcess(page, label);

    // One: open the panel. Two: press save, with the name already filled in
    // from the process itself. That is the whole interaction.
    await page.getByRole('button', { name: 'Save as template' }).click();
    await expect(page.getByLabel('Template name')).toHaveValue(label);
    // The button that opened the panel unmounts, so focus has to be moved
    // deliberately or it falls to the body and a keyboard user is stranded.
    await expect(page.getByLabel('Template name')).toBeFocused();
    await expectNoAccessibilityViolations(page);
    await page.getByLabel('Category (optional)').fill('Testing');
    await page.getByRole('button', { name: 'Save as template' }).click();

    await expect(page.getByText(`Saved “${label}” as a template`)).toBeVisible();

    // Three: follow the link and find it there.
    await page.getByRole('link', { name: 'See it in Templates' }).click();
    await page.waitForURL(/\/templates$/);
    const card = page.getByRole('listitem').filter({ hasText: label });
    await expect(card).toBeVisible();
    await expect(card.getByText('Your organisation')).toBeVisible();
  });

  test('is reachable from the sidebar for a process owner', async ({ page }) => {
    await signIn(page);
    await page.goto('/');

    await page.getByRole('link', { name: 'Templates' }).first().click();
    await page.waitForURL(/\/templates$/);
    await expect(page.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible();
  });

  test('has no accessibility violations on the catalogue', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    await page.goto('/templates');

    await expectNoAccessibilityViolations(page);
  });
});
