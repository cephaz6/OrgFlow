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
