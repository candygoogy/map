import { describe, expect, it } from 'vitest';
import { Color, MeshBasicMaterial, MultiplyBlending, Texture } from 'three';
import {
  createRoleMaterial,
  DEFAULT_SHADE_STRENGTH,
  recolourRoleMaterial,
  roleColours,
  ROLE_TOKEN,
} from '../../src/shading';
import { THEME_TOKENS, type Theme } from '../../src/stage/theme';

// The light theme's tokens (src/styles.css).
const light = {
  bg: '#f4f4f5', ink: '#18181b', soft: '#52525b', edge: '#a1a1aa', faint: '#d4d4d8', ghost: '#e4e4e6', acc: '#3651d4',
  model: '#e4e4e7', detail: '#3f3f46', paper: '#fafafa', lamp: '#27272a', shadow: '#18181b',
};
const theme = Object.fromEntries(THEME_TOKENS.map((t) => [t, new Color(light[t])])) as unknown as Theme;

describe('shading', () => {
  it('draws each role in its token, as the plan maps them', () => {
    expect(ROLE_TOKEN).toEqual({
      body: 'model', detail: 'detail', accent: 'acc', paper: 'paper', lamp: 'lamp', shadow: 'shadow',
    });
    expect(DEFAULT_SHADE_STRENGTH).toBe(0.6); // the Blender previews' SHADE_STRENGTH (not in this repo)
  });

  it('shades a role toward --shadow by shadeStrength, in linear', () => {
    const { lit, shade } = roleColours('body', theme, { shadeStrength: 0.25 });
    expect(lit.getHexString()).toBe('e4e4e7');
    const expected = theme.model.clone().lerp(theme.shadow, 0.25);
    expect(shade.r).toBeCloseTo(expected.r, 6);
    expect(shade.b).toBeCloseTo(expected.b, 6);
    expect(roleColours('body', theme, { shadeStrength: 0 }).shade.equals(lit)).toBe(true);
  });

  it('makes the contact shadow a transparent multiply in --shadow', () => {
    const m = createRoleMaterial('shadow', new Texture(), theme) as MeshBasicMaterial;
    expect(m.name).toBe('shadow');
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(MultiplyBlending);
    expect(m.premultipliedAlpha).toBe(true);
    expect(m.color.getHexString()).toBe('18181b');
  });

  it('recolours role materials only', () => {
    const m = createRoleMaterial('accent', new Texture(), theme);
    expect(() => recolourRoleMaterial(m, theme)).not.toThrow();
    expect(() => recolourRoleMaterial(new MeshBasicMaterial(), theme)).toThrow(/isn't a role material/);
  });
});
