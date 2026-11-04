import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { draw, newFile, newUser } from './helpers';

/** Fails on serious or critical WCAG 2.1 A/AA violations. The canvas itself is excluded (drawn pixels). */
async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('[data-testid=canvas] canvas').analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = serious.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.help} — e.g. ${v.nodes[0]?.target.join(' ')}`);
  expect(summary, summary.join('\n')).toEqual([]);
}

test('sign-in, file browser and editor have no serious accessibility violations', async ({ browser }) => {
  const context = await browser.newContext();
  const anon = await context.newPage();
  await anon.goto('/');
  await expect(anon.getByRole('form', { name: 'Sign in' })).toBeVisible();
  await audit(anon, 'sign-in');

  const { page } = await newUser(browser, 'Auditor');
  await audit(page, 'file browser');
  await newFile(page);
  await draw(page, 'r', [0, 0], [100, 80]);
  await audit(page, 'editor');
  await page.getByRole('tab', { name: 'Prototype' }).click();
  await audit(page, 'prototype tab');
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await audit(page, 'agents panel');
});
