/**
 * Serves the built editor (apps/web/dist) from the API server, so one process and one port run
 * the whole app in production. Unknown non-API paths fall back to index.html for client routing.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

async function fileAt(path: string) {
  try {
    const s = await stat(path);
    return s.isFile() ? path : null;
  } catch {
    return null;
  }
}

/** Returns a handler that sends a file from `dir`, or null when the request is not for the web app. */
export function webHandler(dir: string) {
  const root = resolve(dir);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (!['GET', 'HEAD'].includes(req.method)) return false;
    let path: string;
    try {
      path = decodeURIComponent(req.url.split('?')[0]!);
    } catch {
      return false;
    }
    if (path.startsWith('/api') || path.includes('\0')) return false;
    const target = resolve(root, `.${path}`);
    // Never serve anything outside the build folder.
    let file = target.startsWith(root + sep) ? await fileAt(target) : null;
    if (!file) {
      // Client-side routes (e.g. /file/123) get the app shell; missing assets get a 404.
      if (extname(path)) return false;
      file = await fileAt(resolve(root, 'index.html'));
      if (!file) return false;
    }
    const isHtml = file.endsWith('.html');
    // Vite puts content-hashed files in /assets, so they can be cached for good.
    reply.header('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (isHtml) reply.header('X-Frame-Options', 'DENY');
    reply.type(TYPES[extname(file)] ?? 'application/octet-stream');
    await reply.send(createReadStream(file));
    return true;
  };
}
