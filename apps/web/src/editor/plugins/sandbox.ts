/**
 * Runs untrusted custom-tool code in an isolated iframe.
 *
 * Isolation:
 *  - The code runs in a Worker created inside the sandboxed iframe: its own thread, so an
 *    endless loop cannot freeze the editor, and removing the iframe kills it.
 *  - `sandbox="allow-scripts"` without `allow-same-origin`: the code gets an opaque origin, so it
 *    cannot read the editor's DOM, cookies, localStorage or IndexedDB, open popups, submit forms
 *    or navigate the page.
 *  - A Content-Security-Policy inside the frame blocks every network request
 *    (fetch, XHR, WebSocket, images, fonts), so data cannot be sent anywhere.
 *  - The only channel is postMessage. Every request names one API method; the host checks it
 *    against an allow-list and the tool's permissions (ToolContext) before doing anything.
 *  - Runs are time-limited and call-limited, calls are handled one at a time, and the frame's
 *    relay drops oversized messages (byte budget per message and per run). The iframe is removed
 *    when the run ends, and the tool's context refuses any edit that arrives later.
 */
import type { ToolContext } from './toolHost';

export const SANDBOX_TIMEOUT_MS = 60_000;
export const MAX_CALLS = 20_000;
/** Size limits enforced by the relay inside the frame, before data reaches the editor. */
export const MAX_MESSAGE_BYTES = 70_000_000;
export const MAX_RUN_BYTES = 300_000_000;

/** Methods a sandboxed tool may call; each is still permission-checked by ToolContext. */
const API: Record<string, (ctx: ToolContext, args: unknown[]) => unknown> = {
  getSelection: (ctx) => ctx.getSelection(),
  getNode: (ctx, [id]) => ctx.getNode(String(id)),
  getDocument: (ctx) => ctx.getDocument(),
  createNodes: (ctx, [specs, parentId]) => ctx.createNodes(specs as unknown[], typeof parentId === 'string' ? parentId : null),
  updateNodes: (ctx, [patches]) => ctx.updateNodes(patches as unknown[]),
  deleteNodes: (ctx, [ids]) => ctx.deleteNodes(ids as unknown[]),
  readImage: (ctx, [id, maxSide]) => ctx.readImage(String(id), Number(maxSide) || 512),
  createImage: async (ctx, [width, height, data, name]) => {
    const w = Number(width);
    const h = Number(height);
    if (!(data instanceof Uint8ClampedArray) || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096 || data.length !== w * h * 4) {
      throw new Error('createImage(width, height, Uint8ClampedArray RGBA, name?) — sizes up to 4096');
    }
    return ctx.placeImage({ width: w, height: h, data }, { name: typeof name === 'string' ? name.slice(0, 100) : 'Generated' });
  },
  viewportCenter: (ctx) => ctx.viewportCenter(),
  download: (ctx, [name, content, mime]) => {
    if (typeof content !== 'string') throw new Error('download(name, text, mime?) expects text content');
    ctx.download(String(name), content, typeof mime === 'string' ? mime : 'text/plain');
  },
  notify: (ctx, [message]) => ctx.notify(String(message)),
  select: (ctx, [ids]) => ctx.select(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []),
};

// Workers are allowed only from blob: URLs (created inside the sandbox); nothing can be fetched.
const CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:";

/** RPC client + the tool's code, run inside a Worker (its own thread, so a stuck tool cannot freeze the editor). */
function workerSource(code: string): string {
  return `(() => {
  let seq = 0;
  const pending = new Map();
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    postMessage({ __canvasStudio: 1, type: 'call', id, method, args });
  });
  self.onmessage = (e) => {
    const m = e.data;
    if (!m || m.__canvasStudio !== 1 || m.type !== 'result') return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.value) : p.reject(new Error(m.error));
  };
  const canvas = {};
  for (const name of ${JSON.stringify(Object.keys(API))}) canvas[name] = (...args) => call(name, ...args);
  self.canvas = Object.freeze(canvas);
})();
(async () => {
  try {
${code}
    postMessage({ __canvasStudio: 1, type: 'done' });
  } catch (err) {
    postMessage({ __canvasStudio: 1, type: 'error', message: String((err && err.message) || err) });
  }
})();
`;
}

/** The page loaded into the sandboxed iframe: it starts the worker and relays messages. */
export function buildSandboxDocument(code: string): string {
  // The worker source travels as a JSON string. Every "<" is escaped, so the code can neither close
  // the <script> nor switch the HTML parser into a comment/escape state.
  const src = JSON.stringify(workerSource(code)).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body><script>
(() => {
  const fail = (message) => parent.postMessage({ __canvasStudio: 1, type: 'error', message }, '*');
  let worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([${src}], { type: 'text/javascript' })));
  } catch (e) {
    return fail('Could not start the tool sandbox: ' + e.message);
  }
  // Rough byte size (strings, typed arrays, nested values); stops at the limit.
  const sizeOf = (v, limit) => {
    let total = 0;
    const stack = [v];
    let steps = 0;
    while (stack.length && total <= limit) {
      const x = stack.pop();
      if (++steps > 2000000) return Infinity;
      if (typeof x === 'string') total += x.length * 2;
      else if (ArrayBuffer.isView(x)) total += x.byteLength;
      else if (x instanceof ArrayBuffer) total += x.byteLength;
      else if (x && typeof x === 'object') { total += 16; for (const k in x) { total += k.length * 2; stack.push(x[k]); } }
      else total += 8;
    }
    return total;
  };
  let used = 0;
  let stopped = false;
  worker.onmessage = (e) => {
    if (stopped) return;
    const size = sizeOf(e.data, ${MAX_MESSAGE_BYTES});
    used += size;
    if (size > ${MAX_MESSAGE_BYTES} || used > ${MAX_RUN_BYTES}) {
      stopped = true;
      worker.terminate();
      return fail('The tool sent too much data and was stopped.');
    }
    parent.postMessage(e.data, '*');
  };
  worker.onerror = (e) => { e.preventDefault(); fail(e.message || 'The tool failed'); };
  addEventListener('message', (e) => { if (e.source === parent) worker.postMessage(e.data); });
})();
</script></body></html>`;
}

/** Runs tool code in a fresh sandbox. Resolves when the code finishes; rejects on error/timeout. */
export function runInSandbox(code: string, ctx: ToolContext, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.title = `Sandbox for ${ctx.manifest.name}`;
    frame.style.display = 'none';
    let calls = 0;
    let finished = false;
    // Calls are handled one after another, so a tool cannot pile up work on the editor's thread.
    let queue: Promise<void> = Promise.resolve();

    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      ctx.close();
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      opts.signal?.removeEventListener('abort', onAbort);
      frame.remove();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(new Error('Stopped.'));
    const timer = setTimeout(() => finish(new Error(`The tool took longer than ${(opts.timeoutMs ?? SANDBOX_TIMEOUT_MS) / 1000}s and was stopped.`)), opts.timeoutMs ?? SANDBOX_TIMEOUT_MS);

    const reply = (id: unknown, ok: boolean, payload: unknown) => {
      try {
        frame.contentWindow?.postMessage({ __canvasStudio: 1, type: 'result', id, ok, [ok ? 'value' : 'error']: payload }, '*');
      } catch {
        frame.contentWindow?.postMessage({ __canvasStudio: 1, type: 'result', id, ok: false, error: 'Result could not be sent' }, '*');
      }
    };

    async function handleCall(m: { id?: number; method?: string; args?: unknown[] }) {
      if (finished) return;
      const fn = typeof m.method === 'string' && Object.hasOwn(API, m.method) ? API[m.method] : undefined;
      if (!fn) return reply(m.id, false, `Unknown method "${String(m.method)}"`);
      try {
        const value = await fn(ctx, Array.isArray(m.args) ? m.args : []);
        if (!finished) reply(m.id, true, value);
      } catch (error) {
        if (!finished) reply(m.id, false, error instanceof Error ? error.message : String(error));
      }
    }

    function onMessage(e: MessageEvent) {
      // Only messages from this tool's own frame are accepted.
      if (e.source !== frame.contentWindow || finished) return;
      // Every message counts toward the limit, whatever its type.
      if (++calls > MAX_CALLS) return finish(new Error('The tool made too many requests and was stopped.'));
      const m = e.data as { __canvasStudio?: number; type?: string; id?: number; method?: string; args?: unknown[]; message?: string };
      if (!m || m.__canvasStudio !== 1) return;
      if (m.type === 'error') return finish(new Error(String(m.message ?? 'The tool failed').slice(0, 500)));
      if (m.type === 'done') {
        // Finish after calls that are still queued.
        queue = queue.then(() => finish());
        return;
      }
      if (m.type !== 'call') return;
      queue = queue.then(() => handleCall(m));
    }

    window.addEventListener('message', onMessage);
    opts.signal?.addEventListener('abort', onAbort);
    frame.srcdoc = buildSandboxDocument(code);
    document.body.appendChild(frame);
  });
}

/** Starter code shown when creating a custom tool. */
export const CUSTOM_TOOL_TEMPLATE = `// Your tool runs in a sandbox. Use the \`canvas\` API (every call returns a Promise):
//   getSelection(), getNode(id), getDocument(), viewportCenter()
//   createNodes([{ type, x, y, width, height, fill, name, ... }], parentId?)
//   updateNodes([{ id, ...props }]), deleteNodes([ids]), select([ids])
//   readImage(id, maxSide) -> { width, height, data }, createImage(w, h, rgbaArray, name)
//   download(name, text), notify(message)   (downloads: .svg .png .json .txt .css .csv .md; you confirm each one)
// Calls are allowed only if the tool has the matching permission (createImage needs "Add images").

const c = await canvas.viewportCenter();
const ids = await canvas.createNodes(
  Array.from({ length: 5 }, (_, i) => ({
    type: 'ellipse',
    name: 'Dot ' + (i + 1),
    x: c.x - 150 + i * 60,
    y: c.y - 20,
    width: 40,
    height: 40,
    fill: ['#F43F5E', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'][i],
  })),
);
await canvas.select(ids);
await canvas.notify('Created ' + ids.length + ' dots');
`;
