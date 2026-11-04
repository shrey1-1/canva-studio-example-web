/**
 * Upgrades stored documents to the current schema and validates them.
 * Each step handles exactly one version bump so old files keep opening forever.
 */
import { SCHEMA_VERSION, type DesignDocument } from './model';
import { DocumentError } from './ops';
import { documentProblem } from './validate';

type Raw = Record<string, unknown> & { schemaVersion?: unknown; nodes?: Record<string, Record<string, unknown>> };

const steps: Record<number, (doc: Raw) => void> = {
  // v1 -> v2: masks were introduced; every existing node is a regular layer.
  1: (doc) => {
    for (const node of Object.values(doc.nodes ?? {})) {
      if (node && typeof node === 'object' && !('isMask' in node)) node.isMask = false;
    }
  },
  // v2 -> v3: constraints, sizing, min/max, auto layout on frames, and document variables.
  2: (doc) => {
    for (const node of Object.values(doc.nodes ?? {})) {
      if (!node || typeof node !== 'object') continue;
      node.constraints ??= { horizontal: 'left', vertical: 'top' };
      const autoText = node.type === 'text' && node.autoResize === 'width-and-height';
      node.sizing ??= { horizontal: autoText ? 'hug' : 'fixed', vertical: node.type === 'text' ? 'hug' : 'fixed' };
      for (const k of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) if (!(k in node)) node[k] = null;
      if (node.type === 'frame' && !('layout' in node)) node.layout = null;
    }
    doc.variableCollections ??= [];
    doc.variables ??= [];
  },
};

/**
 * Returns a valid current-version document, or throws `DocumentError` describing why the
 * input cannot be opened. The input object is not modified.
 */
export function migrateDocument(input: unknown): DesignDocument {
  if (!input || typeof input !== 'object') throw new DocumentError('File is not a Canvas Studio document');
  const doc = structuredClone(input) as Raw;
  let version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new DocumentError('File has no schema version');
  }
  if (version > SCHEMA_VERSION) {
    throw new DocumentError('File was saved by a newer version of Canvas Studio');
  }
  while (version < SCHEMA_VERSION) {
    steps[version]!(doc);
    version++;
  }
  doc.schemaVersion = SCHEMA_VERSION;
  const problem = documentProblem(doc);
  if (problem) throw new DocumentError(`File is damaged: ${problem}`);
  return doc as unknown as DesignDocument;
}
