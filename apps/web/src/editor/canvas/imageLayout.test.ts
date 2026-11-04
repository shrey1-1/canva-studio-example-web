import { describe, expect, it } from 'vitest';
import { createImage } from '@canvas-studio/core';
import { imageLayout } from './SceneRenderer';
import { clampCrop } from '../inspector/TypeSections';

// A 200x100 source image shown in a 100x100 box.
const img = (fit: 'fill' | 'fit' | 'stretch' | 'crop') => ({
  ...createImage({ pageId: 'p', assetId: 'a', naturalWidth: 200, naturalHeight: 100, width: 100, height: 100 }),
  fit,
});

describe('imageLayout', () => {
  it('fill covers the box by cropping the centre of the source', () => {
    expect(imageLayout(img('fill'))).toEqual({ x: 0, y: 0, width: 100, height: 100, crop: { x: 50, y: 0, width: 100, height: 100 } });
  });

  it('fit letterboxes the whole source inside the box', () => {
    expect(imageLayout(img('fit'))).toEqual({ x: 0, y: 25, width: 100, height: 50, crop: { x: 0, y: 0, width: 200, height: 100 } });
  });

  it('stretch maps the whole source onto the box', () => {
    expect(imageLayout(img('stretch')).crop).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('crop uses the fractional crop window', () => {
    const node = { ...img('crop'), crop: { x: 0.25, y: 0, width: 0.5, height: 1 } };
    expect(imageLayout(node).crop).toEqual({ x: 50, y: 0, width: 100, height: 100 });
  });
});

describe('clampCrop', () => {
  it('keeps the crop window inside the image', () => {
    expect(clampCrop({ x: 0.9, y: -1, width: 0.5, height: 2 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(clampCrop({ x: 0, y: 0, width: 0, height: 0.5 }).width).toBe(0.01);
  });
});
