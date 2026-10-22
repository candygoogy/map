import { describe, expect, it } from 'vitest';
import { DEFAULT_SHADE_STRENGTH } from '../../src/shading';
import { tuning } from '../../src/tuning';

describe('tuning', () => {
  it('shadeStrength is the same value as shading.ts uses', () => {
    expect(tuning.shadeStrength).toBe(DEFAULT_SHADE_STRENGTH);
  });
});
