import { expect, test } from '@playwright/test';
import { draw, layers, makePng, newFile, newUser } from './helpers';

test('core editing: shapes, undo/redo, grouping, text, images, persistence', async ({ browser }) => {
  const { page, errors } = await newUser(browser, 'Editor');
  await newFile(page);
  await draw(page, 'f', [-250, -180], [250, 180]);
  await draw(page, 'r', [-200, -120], [-60, 0]);
  await draw(page, 'o', [0, -120], [120, 0]);
  await expect(layers(page)).toHaveCount(3);

  await page.keyboard.press('Control+z');
  await expect(layers(page)).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(layers(page)).toHaveCount(3);

  // Select both shapes inside the frame and group them.
  await page.getByRole('treeitem', { name: /^Rectangle 1/ }).click();
  await page.getByRole('treeitem', { name: /^Ellipse 1/ }).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+g');
  await expect(layers(page).filter({ hasText: /^Group/ })).toHaveCount(1);

  // Text
  await page.keyboard.press('Escape');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('t');
  await page.mouse.click(box.x + box.width / 2 - 200, box.y + box.height / 2 + 60);
  await page.keyboard.type('Hello Canvas');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem', { name: /^Hello Canvas/ })).toHaveCount(1);

  // Image upload goes to the server.
  const upload = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/assets/'));
  await page.getByLabel('Image files').setInputFiles({ name: 'swatch.png', mimeType: 'image/png', buffer: makePng(30, 20, (x, y) => [x * 8, y * 12, 200]) });
  expect((await upload).status()).toBe(201);
  await expect(page.getByRole('treeitem', { name: /^swatch/ })).toHaveCount(1);

  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole('treeitem', { name: /^Hello Canvas/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('tools: built-in tool runs as one undo step; sandboxed tools cannot reach the network', async ({ browser }) => {
  const { page, errors } = await newUser(browser, 'Toolsmith');
  await newFile(page);
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: 'Install Bento Grid Builder', exact: true }).click();
  await page.getByRole('button', { name: 'Run Bento Grid Builder' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('cards');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: 'File', exact: true }).click();
  await expect(layers(page).filter({ hasText: /Bento grid/ })).not.toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(layers(page)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();

  // A custom tool tries to send data out.
  await page.getByRole('button', { name: 'New tool' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Leaky');
  await dialog.getByLabel('Tool code').fill(
    "let r = 'blocked'; try { await fetch('https://example.com/x'); r = 'sent'; } catch {} await canvas.notify(r);",
  );
  await dialog.getByRole('button', { name: 'Save and run' }).click();
  const run = page.getByRole('dialog').getByRole('button', { name: 'Run', exact: true });
  if (await run.isVisible().catch(() => false)) await run.click();
  await expect(page.getByText('Leaky: blocked')).toBeVisible();
  expect(errors.filter((e) => !/Content Security Policy|Refused to connect|Failed to fetch/.test(e))).toEqual([]);
});

test('prototype: click navigates between screens in the preview', async ({ browser }) => {
  const { page } = await newUser(browser, 'Proto');
  await newFile(page);
  await draw(page, 'f', [-400, -200], [-200, 200]);
  await draw(page, 'f', [0, -200], [200, 200]);
  await draw(page, 'r', [-380, -180], [-300, -140]);
  await page.getByRole('tab', { name: 'Prototype' }).click();
  await page.getByRole('button', { name: 'Add interaction' }).click();
  await page.getByRole('button', { name: 'Present' }).click();
  const device = page.getByTestId('prototype-device');
  await expect(device).toBeVisible();
  const screen = () => page.locator('[data-testid=prototype-screen]').last().getAttribute('data-screen');
  expect(await screen()).toBe('Frame 1');
  const b = (await device.boundingBox())!;
  await page.mouse.click(b.x + 30, b.y + 30);
  await expect.poll(screen).toBe('Frame 2');
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/file\/[0-9a-f-]+$/);
});
