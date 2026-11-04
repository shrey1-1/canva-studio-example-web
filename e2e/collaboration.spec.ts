import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { draw, layers, newFile, newUser } from './helpers';

const REPO = process.cwd();

test('files, sharing, live editing, comments, export and an MCP agent', async ({ browser }) => {
  const ana = await newUser(browser, 'Ana');
  const ben = await newUser(browser, 'Ben');
  const fileUrl = await newFile(ana.page);

  // Share the project with Ben as editor.
  await ana.page.goto('/');
  await ana.page.getByRole('navigation').getByRole('button', { name: 'My project' }).click();
  await ana.page.getByRole('button', { name: 'Share' }).click();
  await ana.page.getByLabel('Email to invite').fill(ben.email);
  await ana.page.getByRole('button', { name: 'Add' }).click();
  await expect(ana.page.getByRole('list', { name: 'Members' }).locator('p', { hasText: /^Ben$/ })).toBeVisible();

  await ana.page.goto(fileUrl);
  await ben.page.goto(fileUrl);
  await expect(ana.page.getByRole('list', { name: 'People in this file' }).getByRole('button', { name: 'Ben' }).first()).toBeVisible();

  // Live edits both ways.
  await draw(ana.page, 'r', [0, 0], [120, 100]);
  await expect(layers(ben.page)).toHaveCount(1);
  await layers(ben.page).first().dblclick();
  await ben.page.keyboard.press('Control+a');
  await ben.page.keyboard.type('Hero');
  await ben.page.keyboard.press('Enter');
  await expect(layers(ana.page).filter({ hasText: 'Hero' })).toHaveCount(1);

  // Cursor presence.
  const box = (await ben.page.getByTestId('canvas').boundingBox())!;
  await ben.page.mouse.move(box.x + 300, box.y + 200);
  await ben.page.mouse.move(box.x + 320, box.y + 220);
  await expect(ana.page.getByTestId('peer-cursor').first()).toContainText('Ben');

  // Comments: post, reply, resolve.
  await ana.page.keyboard.press('Escape');
  await ana.page.getByRole('button', { name: 'Comment' }).click();
  await ana.page.getByTestId('comment-placing').click({ position: { x: 600, y: 300 } });
  await ana.page.getByLabel('Add a comment…').fill('Can we make this bigger?');
  await ana.page.getByRole('button', { name: 'Post comment' }).click();
  await ana.page.getByRole('button', { name: 'Close thread' }).click();
  const pin = ben.page.getByRole('button', { name: /Comment by Ana: Can we make this bigger/ });
  await pin.click();
  await ben.page.getByLabel('Reply…').fill('Done.');
  await ben.page.getByRole('button', { name: 'Post comment' }).click();
  await ben.page.getByRole('button', { name: 'Resolve' }).click();
  await expect(ana.page.getByRole('button', { name: /Comment by Ana/ })).toHaveCount(0);

  // Version history keeps a named version.
  // The File panel is open by default (clicking its tab again would collapse it).
  await ana.page.getByRole('button', { name: 'Save version' }).click();
  await ana.page.getByLabel('Version name').fill('Review');
  await ana.page.getByRole('dialog').getByRole('button', { name: 'Save version' }).click();
  await expect(ana.page.getByText('Review')).toBeVisible();

  // Export all four formats.
  await layers(ana.page).filter({ hasText: 'Hero' }).click();
  const exportAs = async (format: string) => {
    await ana.page.getByLabel('Export format').selectOption(format);
    const download = ana.page.waitForEvent('download');
    await ana.page.getByRole('button', { name: 'Export layer' }).click();
    const d = await download;
    return { name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) };
  };
  const png = await exportAs('png');
  expect(png.name).toBe('Hero@2x.png');
  expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');
  expect((await exportAs('jpg')).bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect((await exportAs('svg')).bytes.toString()).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="120" height="100"/);
  expect((await exportAs('pdf')).bytes.subarray(0, 8).toString()).toBe('%PDF-1.4');

  // Agent: token from the Agents panel, real MCP client over stdio.
  await ana.page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await ana.page.getByLabel('Token access').selectOption('write');
  await ana.page.getByRole('button', { name: 'Create token' }).click();
  const token = (await ana.page.getByTestId('new-token').textContent())!.trim();
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [`${REPO}/node_modules/tsx/dist/cli.mjs`, `${REPO}/apps/server/src/mcp.ts`],
      env: { ...(process.env as Record<string, string>), CANVAS_STUDIO_URL: 'http://127.0.0.1:8787', CANVAS_STUDIO_TOKEN: token },
      stderr: 'pipe',
    }),
  );
  const fileId = fileUrl.split('/').pop()!;
  const result = await client.callTool({ name: 'create_nodes', arguments: { fileId, specs: [{ type: 'ellipse', name: 'Agent dot', width: 40, height: 40, fill: '#10B981' }] } });
  expect(result.isError).toBeFalsy();
  await expect(layers(ben.page).filter({ hasText: 'Agent dot' })).toHaveCount(1);
  await client.close();

  expect([...ana.errors, ...ben.errors]).toEqual([]);
});

test('viewers are read-only and strangers cannot open files', async ({ browser }) => {
  const owner = await newUser(browser, 'Owner');
  const viewer = await newUser(browser, 'Viewer');
  const stranger = await newUser(browser, 'Stranger');
  const fileUrl = await newFile(owner.page);
  await draw(owner.page, 'r', [0, 0], [80, 80]);
  await owner.page.waitForTimeout(1200);
  await owner.page.goto('/');
  await owner.page.getByRole('navigation').getByRole('button', { name: 'My project' }).click();
  await owner.page.getByRole('button', { name: 'Share' }).click();
  await owner.page.getByLabel('Email to invite').fill(viewer.email);
  await owner.page.getByLabel('Role for invite').selectOption('viewer');
  await owner.page.getByRole('button', { name: 'Add' }).click();
  await expect(owner.page.getByRole('list', { name: 'Members' }).locator('p', { hasText: /^Viewer$/ })).toBeVisible();

  await viewer.page.goto(fileUrl);
  await expect(viewer.page.getByRole('status').filter({ hasText: 'View only' })).toBeVisible();
  await expect(layers(viewer.page)).toHaveCount(1);
  await layers(viewer.page).first().click();
  await viewer.page.keyboard.press('Delete');
  await viewer.page.waitForTimeout(500);
  await expect(layers(viewer.page)).toHaveCount(1);

  await stranger.page.goto(fileUrl);
  await expect(stranger.page.getByRole('heading', { name: 'File not found' })).toBeVisible();
});

test('account: data export and deletion', async ({ browser }) => {
  const { page } = await newUser(browser, 'Leaver');
  await newFile(page);
  await page.goto('/');
  await page.getByRole('button', { name: /account settings/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download my data' }).click();
  const data = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(data.profile.name).toBe('Leaver');
  expect(data.files).toHaveLength(1);
  await page.getByRole('button', { name: 'Delete my account…' }).click();
  await page.getByLabel('Current password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Permanently delete account' }).click();
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('Your account was deleted.')).toBeVisible();
});
