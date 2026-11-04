import { syncInstances } from './components';
import { layoutAutoFrames } from './layout';
import type { DesignDocument } from './model';
import { pruneInteractions } from './prototype';
import { normalizeGroups } from './structure';
import { layoutTexts, type TextMeasure } from './text';
import { applyVariables } from './variables';

/**
 * Restores every derived invariant after an edit, in dependency order:
 * instances mirror their components -> variables drive bound properties -> text boxes fit
 * their text -> auto layout places children (twice, so "fill" sizes feed back into text and
 * nested "hug" frames) -> group boxes wrap their children -> prototype links to deleted screens
 * are dropped.
 *
 * Every step writes only real changes, so running it after a no-op edit records nothing.
 */
export function finalizeDocument(doc: DesignDocument, measure: TextMeasure): void {
  syncInstances(doc);
  applyVariables(doc);
  for (let i = 0; i < 2; i++) {
    layoutTexts(doc, measure);
    layoutAutoFrames(doc);
  }
  normalizeGroups(doc);
  pruneInteractions(doc);
}
