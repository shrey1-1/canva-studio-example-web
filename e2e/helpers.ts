import { deflateSync, crc32 } from 'node:zlib';
import { expect, type Browser, type Page } from '@playwright/test';

const stamp = Date.now().toString(36);
let n = 0;

/** A fresh signed-up user in their own browser context. Console errors are collected in `errors`. */
export async function newUser(browser: Browser, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && !/401|409|Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  // An unexpected 401 signs the app out; record it so the cause is visible.
  page.on('response', (r) => r.status() === 401 && !r.url().endsWith('/api/auth/me') && errors.push(`401 ${r.request().method()} ${r.url()}`));
  const email = `${name.toLowerCase()}-${stamp}-${++n}@example.com`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByLabel('I am at least 16 years old.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Recent files' })).toBeVisible();
  return { page, email, errors, context };
}

/** Creates a file from the home screen and waits for the editor. */
export async function newFile(page: Page) {
  await page.getByRole('button', { name: 'New file' }).first().click();
  await page.waitForURL(/\/file\//);
  await page.waitForSelector('[data-testid=canvas] canvas');
  return page.url();
}

/** Drags out a shape with a tool key, relative to the canvas centre. */
export async function draw(page: Page, key: string, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.keyboard.press(key);
  await page.mouse.move(cx + from[0], cy + from[1]);
  await page.mouse.down();
  await page.mouse.move(cx + (from[0] + to[0]) / 2, cy + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(cx + to[0], cy + to[1], { steps: 4 });
  await page.mouse.up();
}

export const layers = (page: Page) => page.getByRole('tree', { name: 'Layers' }).getByRole('treeitem');

/** Waits for the next save of the open file (HTTP or live). */
export const nextSave = (page: Page) =>
  page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('Saved'), undefined, { timeout: 10_000 });

/** A valid RGBA PNG generated from a pixel function. */
export function makePng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([...pixel(x, y), 255], y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
