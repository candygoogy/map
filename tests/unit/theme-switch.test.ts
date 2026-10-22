import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../src/copy';
import fixture from '../../src/data/fixture.json';
import { parseFeed } from '../../src/data/feed';
import { renderHeader } from '../../src/fallback/html';
import { onThemeChange } from '../../src/stage/theme';
import { applyChoice, loadChoice, lookOf, parseChoice, saveChoice, wantsWipe } from '../../src/theme-switch';

// The theme switch (approved by the owner 2026-10-20): Auto / Light / Dark, kept in
// localStorage.theme as the main site keeps it, put on before the first paint by boot.ts, and
// recoloured live through the path the OS switch already takes.

/** A Storage stand-in: a Map, or one that throws on every call (storage blocked). */
function storage(initial: Record<string, string> = {}, blocked = false) {
  const items = new Map(Object.entries(initial));
  const guard = () => {
    if (blocked) throw new DOMException('blocked', 'SecurityError');
  };
  return {
    items,
    getItem: (k: string) => (guard(), items.get(k) ?? null),
    setItem: (k: string, v: string) => void (guard(), items.set(k, v)),
    removeItem: (k: string) => void (guard(), items.delete(k)),
  };
}

afterEach(() => void vi.unstubAllGlobals());

describe('the choice', () => {
  it('reads light and dark as they are, and anything else as Auto', () => {
    expect(parseChoice('light')).toBe('light');
    expect(parseChoice('dark')).toBe('dark');
    for (const v of [null, undefined, '', 'auto', 'oled', 'Dark', 42]) expect(parseChoice(v)).toBe('auto');
  });

  it('is kept under localStorage.theme; Auto removes it', () => {
    const s = storage();
    saveChoice(s, 'dark');
    expect(s.items.get('theme')).toBe('dark');
    expect(loadChoice(s)).toBe('dark');
    saveChoice(s, 'light');
    expect(loadChoice(s)).toBe('light');
    saveChoice(s, 'auto');
    expect(s.items.has('theme')).toBe(false);
    expect(loadChoice(s)).toBe('auto');
  });

  it('lasts for the page when storage is blocked or missing', () => {
    const s = storage({ theme: 'dark' }, true);
    expect(() => saveChoice(s, 'dark')).not.toThrow();
    expect(loadChoice(s)).toBe('auto');
    expect(loadChoice(undefined)).toBe('auto');
    expect(() => saveChoice(undefined, 'light')).not.toThrow();
  });

  it('resolves Auto to the OS, and Light and Dark to themselves', () => {
    expect(lookOf('auto', false)).toBe('light');
    expect(lookOf('auto', true)).toBe('dark');
    expect(lookOf('light', true)).toBe('light');
    expect(lookOf('dark', false)).toBe('dark');
  });

  it('puts the choice on html[data-theme] and the color-scheme meta', () => {
    const root = { dataset: {} as DOMStringMap };
    const meta = { content: 'light dark', setAttribute(_n: string, v: string) { this.content = v; } };
    applyChoice(root, meta, 'dark');
    expect(root.dataset.theme).toBe('dark');
    expect(meta.content).toBe('dark');
    applyChoice(root, meta, 'light');
    expect(root.dataset.theme).toBe('light');
    expect(meta.content).toBe('light');
    applyChoice(root, meta, 'auto');
    expect('theme' in root.dataset).toBe(false);
    expect(meta.content).toBe('light dark');
    expect(() => applyChoice(root, null, 'dark')).not.toThrow();
  });
});

describe('the blind', () => {
  const env = { osDark: false, reduced: false, canTransition: true, arriving: false };
  it('drops in only when the look changes, with motion allowed and View Transitions there', () => {
    expect(wantsWipe('auto', 'dark', env)).toBe(true);
    expect(wantsWipe('dark', 'light', env)).toBe(true);
    expect(wantsWipe('dark', 'auto', env)).toBe(true);
    // Auto ↔ the theme it resolves to looks the same: no wipe.
    expect(wantsWipe('auto', 'light', env)).toBe(false);
    expect(wantsWipe('dark', 'auto', { ...env, osDark: true })).toBe(false);
    expect(wantsWipe('light', 'dark', { ...env, reduced: true })).toBe(false);
    expect(wantsWipe('light', 'dark', { ...env, canTransition: false })).toBe(false);
    // Mid-arrival the wipe's still snapshot would freeze it: the theme just switches.
    expect(wantsWipe('light', 'dark', { ...env, arriving: true })).toBe(false);
  });
});

describe('before the first paint (boot.ts)', () => {
  // boot.js is theme-boot.ts then boot.ts (vite-plugin-prerender.ts), classic scripts with no
  // imports: run their sources, in that order, against a page in miniature.
  const read = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');
  const source = `${read('theme-boot.ts')}\n${read('boot.ts')}`;

  function boot(saved: Record<string, string>, blocked = false) {
    const classes = new Set(['no-3d']);
    const root = {
      dataset: {} as DOMStringMap,
      classList: {
        add: (...c: string[]) => c.forEach((n) => classes.add(n)),
        remove: (...c: string[]) => c.forEach((n) => classes.delete(n)),
        contains: (c: string) => classes.has(c),
      },
    };
    const meta = { content: 'light dark', setAttribute(_n: string, v: string) { this.content = v; } };
    const document = {
      documentElement: root,
      querySelector: (q: string) => (q === 'meta[name="color-scheme"]' ? meta : null),
      createElement: () => ({ getContext: () => null }), // no WebGL2 here
    };
    const run = new Function('document', 'localStorage', source);
    run(document, storage(saved, blocked));
    return { root, meta, classes };
  }

  it('puts a saved Light or Dark on before the paint, and marks the page as having JS', () => {
    const dark = boot({ theme: 'dark' });
    expect(dark.root.dataset.theme).toBe('dark');
    expect(dark.meta.content).toBe('dark');
    expect(dark.classes.has('js')).toBe(true);
    expect(boot({ theme: 'light' }).root.dataset.theme).toBe('light');
  });

  it('leaves Auto (nothing saved, a value it doesn’t know, or storage blocked) to the OS', () => {
    for (const page of [boot({}), boot({ theme: 'oled' }), boot({ theme: 'dark' }, true)]) {
      expect('theme' in page.root.dataset).toBe(false);
      expect(page.meta.content).toBe('light dark');
      expect(page.classes.has('js')).toBe(true);
      expect(page.classes.has('no-3d')).toBe(true); // no WebGL2 in this one
    }
  });
});

describe('on the 404', () => {
  it('runs the saved theme, then html.js and the browser bar’s colour (src/notfound/head.ts)', () => {
    const theme = readFileSync(new URL('../../src/theme-boot.ts', import.meta.url), 'utf8');
    const head = readFileSync(new URL('../../src/notfound/head.ts', import.meta.url), 'utf8');
    // theme-boot.ts stays the saved theme alone: boot.js (the map's) adds its own html.js.
    expect(theme).not.toMatch(/classList|webgl/i);
    expect(head).not.toMatch(/webgl/i);
    const run = (saved: Record<string, string>) => {
      const classes = new Set<string>();
      const root = { dataset: {} as DOMStringMap, classList: { add: (c: string) => classes.add(c) } };
      const meta = { content: 'light dark', setAttribute(_n: string, v: string) { this.content = v; } };
      const bars = [0, 1].map(() => ({ content: '', setAttribute(_n: string, v: string) { this.content = v; } }));
      const document = { documentElement: root, querySelector: () => meta, querySelectorAll: () => bars };
      const window = { IntersectionObserver: class {} };
      new Function('document', 'localStorage', 'window', theme + head)(document, storage(saved), window);
      return { root, meta, bars, classes };
    };
    const dark = run({ theme: 'dark' });
    expect(dark.root.dataset.theme).toBe('dark');
    expect(dark.meta.content).toBe('dark');
    expect(dark.classes.has('js')).toBe(true);
    expect(dark.bars.map((b) => b.content)).toEqual(['#121214', '#121214']);
    const auto = run({});
    expect(auto.classes.has('js')).toBe(true);
    expect(auto.bars.map((b) => b.content)).toEqual(['', '']); // the metas keep their own
  });
});

describe('the live recolour', () => {
  it('follows html[data-theme] as well as the OS', () => {
    const observers: { cb: () => void; opts?: MutationObserverInit; on: boolean }[] = [];
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#123456' }));
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal(
      'MutationObserver',
      class {
        o: (typeof observers)[number];
        constructor(cb: () => void) {
          this.o = { cb, on: false };
          observers.push(this.o);
        }
        observe(_el: Node, opts: MutationObserverInit) {
          this.o.on = true;
          this.o.opts = opts;
        }
        disconnect() {
          this.o.on = false;
        }
      },
    );
    let calls = 0;
    const off = onThemeChange(() => void calls++, {} as Element);
    expect(observers).toHaveLength(1);
    expect(observers[0]!.opts?.attributeFilter).toEqual(['data-theme']);
    observers[0]!.cb();
    expect(calls).toBe(1);
    off();
    expect(observers[0]!.on).toBe(false);
  });
});

describe('the tokens', () => {
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  const props = (block: string) =>
    Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
  const blockAfter = (selector: string) => {
    const at = css.indexOf(selector);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('keeps one dark list: the OS’s (Auto) and the chosen Dark are the same', () => {
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    expect(media).toMatch(/^@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme\]\) \{/);
    const auto = props(media.slice(0, media.indexOf('}')));
    const chosen = props(blockAfter(':root[data-theme="dark"] {'));
    expect(Object.keys(auto).length).toBeGreaterThan(10);
    expect(chosen).toEqual(auto);
    expect(blockAfter(':root[data-theme="dark"] {')).toMatch(/color-scheme: dark;/);
  });

  it('has the main site’s switch tokens in both themes', () => {
    const light = props(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')));
    const dark = props(blockAfter(':root[data-theme="dark"] {'));
    expect(light).toMatchObject({ 'switch-track': '#e4e4e7', 'switch-on-bg': '#18181b', 'switch-on-ink': '#f4f4f5' });
    expect(dark).toMatchObject({ 'switch-track': '#27272a', 'switch-on-bg': '#f4f4f5', 'switch-on-ink': '#121214' });
  });
});

describe('the pill in the header', () => {
  const html = renderHeader(parseFeed(fixture), copy);

  it('is a group named Theme of three buttons, Auto pressed until the script syncs', () => {
    expect(html).toMatch(/<div class="themes" role="group" aria-label="Theme" data-theme-switch>/);
    const buttons = [...html.matchAll(/<button type="button" data-value="(\w+)" aria-pressed="(\w+)">/g)];
    expect(buttons.map((b) => [b[1], b[2]])).toEqual([
      ['auto', 'true'],
      ['light', 'false'],
      ['dark', 'false'],
    ]);
    for (const word of ['Auto', 'Light', 'Dark']) expect(html).toContain(`>${word}<`);
    // The pill sits before the way back, so the Tab order runs as it reads.
    expect(html.indexOf('data-theme-switch')).toBeLessThan(html.indexOf('class="back"'));
  });

  it('is on the 404 too, as on the site’s and the experiments’, without the sound toggle', () => {
    const notFound = renderHeader(parseFeed(fixture), copy, { page: 'notFound' });
    expect(notFound).toContain('data-theme-switch');
    expect(notFound).not.toContain('data-sound');
    expect(notFound.indexOf('data-theme-switch')).toBeLessThan(notFound.indexOf('class="back"'));
    // The map's own header keeps its sound toggle.
    expect(html).toContain('data-sound');
  });

  it('uses the approved words, Auto’s hidden “(light)” / “(dark)” too (the owner, 2026-10-21)', () => {
    expect(copy.themeGroup).toEqual({ text: 'Theme', approved: true });
    expect(copy.themeAuto).toEqual({ text: 'Auto', approved: true });
    expect(copy.themeLight).toEqual({ text: 'Light', approved: true });
    expect(copy.themeDark).toEqual({ text: 'Dark', approved: true });
    expect(copy.themeResolvedLight).toEqual({ text: '(light)', approved: true });
    expect(copy.themeResolvedDark).toEqual({ text: '(dark)', approved: true });
  });
});
