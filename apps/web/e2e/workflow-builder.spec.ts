import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

test.describe('workflow builder', () => {
  test('builds a two-step workflow through the list view and publishes it', async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page);

    await page.goto('/processes/new');
    const name = `Access grant ${Date.now()}`;
    await page.getByLabel('Process name').fill(name);
    await page.getByLabel('Reference prefix').fill('wfl');
    await page.getByRole('button', { name: 'Create and open the builder' }).click();
    await page.waitForURL(/\/processes\/[0-9a-f-]{36}$/);

    // A form field first, since the workflow's assignment editor offers a
    // "whoever the requester named" option once a person field exists.
    await page.getByRole('button', { name: 'Add section' }).click();
    await page.getByRole('button', { name: 'Short text' }).click();
    await page.getByLabel('Question label').fill('System name');

    await page.getByRole('tab', { name: 'workflow' }).click();

    // The list view is the keyboard-operable path (CLAUDE.md §3): add two
    // steps without ever touching the canvas.
    await page.getByRole('button', { name: 'Add step' }).click();
    await page.getByLabel('Step name').fill('Manager approval');

    await page.getByRole('button', { name: 'Add step' }).click();
    await page.getByLabel('Step name').fill('IT provisioning');
    await page.getByLabel('Step type').selectOption('action');

    // Route the first step's approval to the second step, and its rejection
    // to the terminal outcome.
    const stepList = page.locator('ol');
    await stepList
      .getByRole('listitem')
      .filter({ hasText: 'Manager approval' })
      .getByRole('button')
      .first()
      .click();
    // A new step starts with no transition rules at all; "Add default"
    // creates the row the target select then targets.
    await page
      .getByText('Approve goes to')
      .locator('..')
      .getByRole('button', { name: 'Add default' })
      .click();
    // Step keys are assigned once at creation (from the literal "Step",
    // like features/form-builder's field keys are assigned from the field
    // type) and never follow a later rename, so the second step added here
    // is 'step_2' regardless of it being renamed to "IT provisioning".
    await page.getByLabel('Where "Approve" rule 1 goes').selectOption('step_2');
    await page
      .getByText('Reject goes to')
      .locator('..')
      .getByRole('button', { name: 'Add default' })
      .click();
    await page.getByLabel('Where "Reject" rule 1 goes').selectOption('$rejected');

    await stepList
      .getByRole('listitem')
      .filter({ hasText: 'IT provisioning' })
      .getByRole('button')
      .first()
      .click();
    await page
      .getByText('Complete goes to')
      .locator('..')
      .getByRole('button', { name: 'Add default' })
      .click();
    await page.getByLabel('Where "Complete" rule 1 goes').selectOption('$completed');

    // Validate: a fully wired two-step workflow should raise nothing.
    await page.getByRole('tab', { name: /validate/i }).click();
    const workflowValidation = page.getByRole('heading', { name: 'Workflow' }).locator('..');
    await expect(workflowValidation.getByText('No problems found.')).toBeVisible();

    // The canvas renders the same graph the list view built.
    await page.getByRole('tab', { name: 'workflow' }).click();
    await page.getByRole('tab', { name: 'canvas' }).click();
    await expect(page.getByText('Manager approval')).toBeVisible();
    await expect(page.getByText('IT provisioning')).toBeVisible();

    await page.getByRole('tab', { name: 'build' }).click();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published as v1')).toBeVisible();
  });

  test('has no accessibility violations on the workflow tab', async ({ page }) => {
    await signIn(page);

    await page.goto('/processes/new');
    await page.getByLabel('Process name').fill(`Workflow a11y check ${Date.now()}`);
    await page.getByLabel('Reference prefix').fill('wac');
    await page.getByRole('button', { name: 'Create and open the builder' }).click();
    await page.waitForURL(/\/processes\/[0-9a-f-]{36}$/);

    await page.getByRole('tab', { name: 'workflow' }).click();
    await page.getByRole('button', { name: 'Add step' }).click();

    await expectNoAccessibilityViolations(page);
  });
});
