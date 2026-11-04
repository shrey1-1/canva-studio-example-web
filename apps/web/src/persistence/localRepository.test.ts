import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, addNode, createDocument, createFrame } from '@canvas-studio/core';
import { DocumentLoadError, LocalDocumentRepository } from './localRepository';

describe('LocalDocumentRepository', () => {
  it('saves, lists, loads and deletes documents', async () => {
    const repo = new LocalDocumentRepository(localStorage);
    const doc = createDocument('Landing page');
    addNode(doc, createFrame({ pageId: doc.pages[0]!.id }));
    const savedAt = new Date('2026-11-04T10:00:00.000Z');
    await repo.save(doc, savedAt);

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: doc.id, name: 'Landing page', pageCount: 1 });

    const loaded = await repo.load(doc.id);
    // Saving stamps updatedAt; everything else round-trips unchanged.
    expect(loaded).toEqual({ ...doc, updatedAt: savedAt.toISOString() });

    await repo.delete(doc.id);
    expect(await repo.load(doc.id)).toBeNull();
    expect(await repo.list()).toEqual([]);
  });

  it('updates the index entry instead of duplicating it', async () => {
    const repo = new LocalDocumentRepository(localStorage);
    const doc = createDocument('A');
    await repo.save(doc);
    await repo.save({ ...doc, name: 'B' });
    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('B');
  });

  it('lists most recently updated first', async () => {
    const repo = new LocalDocumentRepository(localStorage);
    await repo.save(createDocument('Old'), new Date('2026-01-01T00:00:00.000Z'));
    await repo.save(createDocument('New'), new Date('2026-06-01T00:00:00.000Z'));
    expect((await repo.list()).map((m) => m.name)).toEqual(['New', 'Old']);
  });

  it('distinguishes missing files from damaged ones', async () => {
    const repo = new LocalDocumentRepository(localStorage);
    localStorage.setItem('canvas-studio:doc:bad', '{not json');
    localStorage.setItem('canvas-studio:doc:wrong', JSON.stringify({ id: 'wrong', schemaVersion: 99 }));
    expect(await repo.load('missing')).toBeNull();
    await expect(repo.load('bad')).rejects.toThrow(DocumentLoadError);
    await expect(repo.load('wrong')).rejects.toThrow(/newer version/);
  });

  it('opens Phase 1 (schema v1) files by migrating them', async () => {
    const repo = new LocalDocumentRepository(localStorage);
    const doc = createDocument('Old file');
    const frame = createFrame({ pageId: doc.pages[0]!.id });
    addNode(doc, frame);
    const v1 = JSON.parse(JSON.stringify(doc));
    v1.schemaVersion = 1;
    delete v1.nodes[frame.id].isMask;
    localStorage.setItem(`canvas-studio:doc:${doc.id}`, JSON.stringify(v1));
    const loaded = await repo.load(doc.id);
    expect(loaded?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded?.nodes[frame.id]?.isMask).toBe(false);
  });
});
