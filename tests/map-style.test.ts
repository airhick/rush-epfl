import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildStyle, fallbackStyle } from '../src/map/style';

describe('styles de carte', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`style vectoriel ${theme} valide`, () => {
      expect(validateStyleMin(buildStyle(theme)).map((e) => e.message)).toEqual([]);
    });
    it(`style de repli ${theme} valide`, () => {
      expect(validateStyleMin(fallbackStyle(theme)).map((e) => e.message)).toEqual([]);
    });
  }
});
