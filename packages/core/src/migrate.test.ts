import { describe, expect, it } from 'vitest';
import { createDocument, createRectangle, createText } from './factory';
import { migrateDocument } from './migrate';
import { addNode, DocumentError } from './ops';
import { layoutTexts } from './text';
import { SCHEMA_VERSION } from './model';

describe('migrateDocument', () => {
  it('upgrades a v1 document (no isMask) to the current schema', () => {
    const doc = createDocument('Old');
    const pageId = doc.pages[0]!.id;
    const rect = createRectangle({ pageId });
    addNode(doc, rect);
    const v1 = JSON.parse(JSON.stringify(doc));
    v1.schemaVersion = 1;
    delete v1.nodes[rect.id].isMask;

    const migrated = migrateDocument(v1);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.nodes[rect.id]!.isMask).toBe(false);
    expect(v1.nodes[rect.id].isMask).toBeUndefined(); // input untouched
  });

  it('rejects newer, unversioned and damaged files with a reason', () => {
    const doc = createDocument();
    expect(() => migrateDocument({ ...doc, schemaVersion: 99 })).toThrow(/newer version/);
    expect(() => migrateDocument({ ...doc, schemaVersion: undefined })).toThrow(DocumentError);
    const damaged = structuredClone(doc);
    damaged.pages[0]!.childIds.push('missing-node');
    expect(() => migrateDocument(damaged)).toThrow(/damaged/);
  });

  it('rejects orphaned nodes', () => {
    const doc = createDocument();
    const rect = createRectangle({ pageId: doc.pages[0]!.id });
    doc.nodes[rect.id] = rect; // in the map but not on any page
    expect(() => migrateDocument(doc)).toThrow(/orphaned/);
  });
});

describe('layoutTexts', () => {
  it('sizes auto-width text and only writes changed values', () => {
    const doc = createDocument();
    const t = createText({ pageId: doc.pages[0]!.id, characters: 'Hello' });
    addNode(doc, t);
    const measure = (node: { characters: string; fontSize: number }, width: number | null) => ({
      width: width ?? node.characters.length * 10,
      height: node.fontSize * 1.2,
    });
    layoutTexts(doc, measure);
    expect({ w: t.width, h: t.height }).toEqual({ w: 50, h: 19.2 });

    t.autoResize = 'height';
    t.width = 30;
    layoutTexts(doc, measure);
    expect(t.width).toBe(30); // fixed width is kept

    t.autoResize = 'none';
    t.height = 500;
    layoutTexts(doc, measure);
    expect(t.height).toBe(500);
  });
});
