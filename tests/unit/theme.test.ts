import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onThemeChange, readTheme, THEME_TOKENS, type Theme } from '../../src/stage/theme';
import { tierFor } from '../../src/stage/stage';

// The plan's tokens (Global Constraints → Theme, with --paper and light --model as picked in Phase 0).
const LIGHT = {
  bg: '#f4f4f5', ink: '#18181b', soft: '#52525b', edge: '#a1a1aa', faint: '#d4d4d8', ghost: '#e4e4e6', acc: '#3651d4',
  model: '#e4e4e7', detail: '#3f3f46', paper: '#fafafa', lamp: '#27272a', shadow: '#18181b',
};
const DARK = {
  bg: '#121214', ink: '#f4f4f5', soft: '#a1a1aa', edge: '#52525b', faint: '#2e2e33', ghost: '#202023', acc: '#8ea2ff',
  model: '#46464d', detail: '#d4d4d8', paper: '#fafafa', lamp: '#27272a', shadow: '#000000',
};

// styles.css's custom properties: the :root block, and what the dark @media block overrides.
const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const DARK_AT = css.indexOf('@media (prefers-color-scheme: dark)');
const props = (block: string) =>
  Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
const lightProps = props(css.slice(css.indexOf(':root'), DARK_AT));
const darkProps = props(css.slice(DARK_AT, css.indexOf('}', css.indexOf('}', DARK_AT) + 1)));

// A browser in miniature: a prefers-color-scheme query the test can flip, and a computed
// style that cascades the dark block over :root while it matches.
function fakeScheme() {
  const listeners = new Set<() => void>();
  const query = {
    matches: false,
    addEventListener: (_type: string, cb: () => void) => void listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => void listeners.delete(cb),
  };
  vi.stubGlobal('matchMedia', (q: string) => {
    expect(q).toBe('(prefers-color-scheme: dark)');
    return query;
  });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => {
      const token = name.replace(/^--/, '');
      return (query.matches ? (darkProps[token] ?? lightProps[token]) : lightProps[token]) ?? '';
    },
  }));
  return {
    el: {} as Element,
    set dark(on: boolean) {
      query.matches = on;
      for (const cb of [...listeners]) cb();
    },
    listeners,
  };
}

const hexes = (t: Theme) => Object.fromEntries(THEME_TOKENS.map((k) => [k, `#${t[k].getHexString()}`]));

afterEach(() => void vi.unstubAllGlobals());

describe('theme', () => {
  it('reads light and dark tokens', () => {
    const page = fakeScheme();
    expect(hexes(readTheme(page.el))).toEqual(LIGHT);

    // The OS switches to dark while the page is open: the callback gets the re-read tokens.
    const seen: Theme[] = [];
    const off = onThemeChange((t) => seen.push(t), page.el);
    page.dark = true;
    expect(seen).toHaveLength(1);
    expect(hexes(seen[0]!)).toEqual(DARK);

    page.dark = false;
    expect(hexes(seen[1]!)).toEqual(LIGHT);

    off();
    expect(page.listeners.size).toBe(0);
    page.dark = true;
    expect(seen).toHaveLength(2);
  });

  it('reads a token the build minified to #rgb', () => {
    // The production CSS minifier writes the dark --shadow #000000 as #000.
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => (name === '--shadow' ? '#000' : lightProps[name.replace(/^--/, '')]!),
    }));
    expect(hexes(readTheme({} as Element)).shadow).toBe('#000000');
  });

  it('tierFor drops to low above 22 ms mean and stays high at 16 ms', () => {
    const frames = (n: number, ms: number) => Array.from({ length: n }, () => ms);
    expect(tierFor(frames(120, 16))).toBe('high');
    expect(tierFor(frames(120, 30))).toBe('low');
    expect(tierFor(frames(120, 22))).toBe('high'); // above 22, not at it
    expect(tierFor([...frames(119, 22), 22.2])).toBe('low');
    // Only the last 120 count: a slow start (shader compiles) followed by smooth frames stays high.
    expect(tierFor([...frames(60, 200), ...frames(120, 16)])).toBe('high');
    // Too few samples to judge: stay high.
    expect(tierFor(frames(119, 40))).toBe('high');
  });
});
