/**
 * Validation for layer updates from untrusted code (sandboxed tools, AI agents): only existing,
 * non-protected fields, and the patched layer must still be a valid layer.
 */
import type { SceneNode } from '../model';
import { DocumentError } from '../ops';
import { nodeProblem } from '../validate';

/** Fields untrusted code may never patch: structure, component links, variable links and asset references. */
export const PROTECTED_KEYS: ReadonlySet<string> = new Set([
  'id', 'type', 'pageId', 'parentId', 'childIds', 'componentNodeId', 'overrides', 'componentId',
  'bindings', 'variableModes', 'assetId', '__proto__', 'constructor', 'prototype',
]);
export const MAX_PAINTS = 50;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Returns a patch safe to apply to `node`, or throws DocumentError. Unknown/protected keys are dropped. */
export function safePatch(node: SceneNode, raw: Record<string, unknown>): Record<string, unknown> {
  const patch = clone(Object.fromEntries(Object.entries(raw).filter(([k]) => !PROTECTED_KEYS.has(k) && Object.hasOwn(node, k))));
  for (const k of ['fills', 'strokes', 'effects']) {
    if (Array.isArray(patch[k]) && (patch[k] as unknown[]).length > MAX_PAINTS) throw new DocumentError(`At most ${MAX_PAINTS} ${k} per layer`);
  }
  if (typeof patch.name === 'string') patch.name = patch.name.slice(0, 200);
  const problem = nodeProblem({ ...clone(node), ...patch });
  if (problem) throw new DocumentError(`Invalid update (${problem.replace(/^node \S+: /, '')})`);
  return patch;
}
