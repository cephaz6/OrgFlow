import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

// Builds the smallest workflow with a real branch in it, then drives the
// simulator down both sides of that branch. ADR-0040: no case is created by
// any of this, which is the property worth having an end-to-end test for.
async function buildBranchingProcess(page: import('@playwright/test').Page, prefix: string) {
  await page.goto('/processes/new');
  await page.getByLabel('Process name').fill(`${prefix} ${Date.now()}`);
  await page.getByLabel('Reference prefix').fill('sim');
  await page.getByRole('button', { name: 'Create and open the builder' }).click();
  await page.waitForURL(/\/processes\/[0-9a-f-]{36}$/);

  // One number field, so the workflow has something to branch on.
  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('button', { name: 'Number' }).click();
  await page.getByLabel('Question label').fill('Cost');

  await page.getByRole('tab', { name: 'workflow' }).click();

  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByLabel('Step name').fill('Manager approval');

  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByLabel('Step name').fill('Finance approval');

  const stepList = page.locator('ol');
  await stepList
    .getByRole('listitem')
    .filter({ hasText: 'Manager approval' })
    .getByRole('button')
    .first()
    .click();

  // Approve above 1,000 goes to finance; everything else completes.
  const approveGroup = page.getByText('Approve goes to').locator('..');
  await approveGroup.getByRole('button', { name: 'Add condition' }).click();
  await page.getByLabel('Where "Approve" rule 1 goes').selectOption('step_2');
  // Field keys come from the field's type, not its label (form-builder's
  // keyFrom), so the first number field on the form is keyed 'number'.
  await page.getByLabel('Field').selectOption('number');
  await page.getByLabel('Condition', { exact: true }).selectOption('gt');
  await page.getByLabel('Value').fill('1000');

  await approveGroup.getByRole('button', { name: 'Add default' }).click();
  await page.getByLabel('Where "Approve" rule 2 goes').selectOption('$completed');

  const rejectGroup = page.getByText('Reject goes to').locator('..');
  await rejectGroup.getByRole('button', { name: 'Add default' }).click();
  await page.getByLabel('Where "Reject" rule 1 goes').selectOption('$rejected');

  await stepList
    .getByRole('listitem')
    .filter({ hasText: 'Finance approval' })
    .getByRole('button')
    .first()
    .click();
  const financeApprove = page.getByText('Approve goes to').locator('..');
  await financeApprove.getByRole('button', { name: 'Add default' }).click();
  await page.getByLabel('Where "Approve" rule 1 goes').selectOption('$completed');
}

// The builder keeps every tab panel mounted and merely `hidden`, so the
// build tab's own canvas controls for a field ("Move "Cost" up", and so on)
// match a bare getByLabel('Cost') too. Every assertion here is scoped to the
// simulate panel, which is both unambiguous and a truer test: it asserts the
// text is in the panel under test rather than anywhere on the page.
function simulatePanel(page: import('@playwright/test').Page) {
  return page.locator('#panel-simulate');
}

test.describe('workflow simulator', () => {
  test('routes a cheap request straight to completion, and a costly one via finance', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    await buildBranchingProcess(page, 'Simulated purchase');

    await page.getByRole('tab', { name: 'simulate' }).click();
    const panel = simulatePanel(page);

    // Below the threshold: one approval, then completed.
    await panel.getByLabel('Cost', { exact: true }).fill('500');
    await panel.getByRole('button', { name: 'Run simulation' }).click();
    await expect(panel.getByText('Waiting on Manager approval')).toBeVisible();

    await panel.getByRole('button', { name: 'approve', exact: true }).click();
    await expect(panel.getByText('Completed: approved')).toBeVisible();
    // The losing branch is still named, since explaining why a route was not
    // taken is the point of the trace. So the assertion is not that finance
    // goes unmentioned, it is that finance never received a task.
    await expect(panel.getByText('Rule 1 to Finance approval: did not match')).toBeVisible();
    await expect(panel.getByText('Finance approval goes to')).toHaveCount(0);

    // Above it: the same decision now routes through finance instead.
    await panel.getByRole('button', { name: 'Reset' }).click();
    await panel.getByLabel('Cost', { exact: true }).fill('2500');
    await panel.getByRole('button', { name: 'Run simulation' }).click();
    await panel.getByRole('button', { name: 'approve', exact: true }).click();

    await expect(panel.getByText('Waiting on Finance approval')).toBeVisible();
    // The trace explains itself: the winning rule is named, not just taken.
    await expect(panel.getByText('matched, and was taken').first()).toBeVisible();

    await panel.getByRole('button', { name: 'approve', exact: true }).click();
    await expect(panel.getByText('Completed: approved')).toBeVisible();
  });

  test('shows a request stalling when the requester has no line manager', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    await buildBranchingProcess(page, 'Simulated stall');

    await page.getByRole('tab', { name: 'simulate' }).click();
    const panel = simulatePanel(page);

    await panel.getByLabel('The requester has a line manager').uncheck();
    await panel.getByRole('button', { name: 'Run simulation' }).click();

    await expect(panel.getByText('Stalled: unassigned')).toBeVisible();
  });

  test('creates no case, so My requests is untouched by a simulation', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);

    await page.goto('/cases');
    const before = await page.getByRole('row').count();

    await buildBranchingProcess(page, 'Simulated no-op');
    await page.getByRole('tab', { name: 'simulate' }).click();
    const panel = simulatePanel(page);

    await panel.getByLabel('Cost', { exact: true }).fill('750');
    await panel.getByRole('button', { name: 'Run simulation' }).click();
    await panel.getByRole('button', { name: 'approve', exact: true }).click();
    await expect(panel.getByText('Completed: approved')).toBeVisible();

    await page.goto('/cases');
    expect(await page.getByRole('row').count()).toBe(before);
  });

  test('has no accessibility violations on the simulate tab', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    await buildBranchingProcess(page, 'Simulator a11y check');

    await page.getByRole('tab', { name: 'simulate' }).click();
    const panel = simulatePanel(page);

    await panel.getByLabel('Cost', { exact: true }).fill('2500');
    await panel.getByRole('button', { name: 'Run simulation' }).click();
    await expect(panel.getByText('Waiting on Manager approval')).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });
});
