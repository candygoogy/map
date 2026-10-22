// The plain HTML version of the map, prerendered into index.html by
// vite-plugin-prerender.ts: the screen-reader view and the no-JS/no-WebGL
// page, complete on its own. Every feed value is escaped on the way in.

import type { Copy } from '../copy';
import type { Device, FeedNode, Link, MapFeed } from '../data/feed';
import { orderIds } from '../nav/stations';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]!);

const link = ({ label, href }: Link) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`;

function statusText(status: string, copy: Copy): string {
  const words: Record<string, string> = {
    live: copy.statusLive.text,
    'in-progress': copy.statusInProgress.text,
    archived: copy.statusArchived.text,
  };
  return words[status] ?? status;
}

function facts(n: FeedNode, copy: Copy): string {
  const rows: [string, string | undefined][] = [
    [copy.factStatus.text, n.status && statusText(n.status, copy)],
    [copy.factVersion.text, n.version],
    [copy.factRunsOn.text, n.runsOn],
    [copy.factStack.text, n.stack?.join(', ')],
    [copy.factLicense.text, n.license],
  ];
  const items = rows
    .filter((r): r is [string, string] => !!r[1])
    .map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd></div>`);
  return items.length ? `<dl class="facts leaders">${items.join('')}</dl>` : '';
}

/** The homelab's devices, in tree order: label, leader, product, and its detail as a second dd beneath. */
function devices(list: Device[] | undefined): string {
  if (!list?.length) return '';
  const items = list.map(({ label, product, detail }) => {
    const sub = detail ? `<dd class="detail">${esc(detail)}</dd>` : '';
    return `<div><dt>${esc(label)}</dt><dd>${esc(product)}</dd>${sub}</div>`;
  });
  return `<dl class="devices leaders">${items.join('')}</dl>`;
}

function station(n: FeedNode, copy: Copy): string {
  const id = esc(n.id);
  const head = [
    `<h2 id="${id}-title">${esc(n.name)}</h2>`,
    n.blurb ? `<p class="blurb">${esc(n.blurb)}</p>` : '',
  ].join('');
  const tools = n.children?.length
    ? `<ul class="tools">${n.children.map((c) => link({ label: c.name, href: c.href })).join('')}</ul>`
    : '';
  const own = n.page ? [{ label: n.kind === 'exit' ? copy.backToSite.text : copy.pageLink.text, href: n.page }] : [];
  const all = [...n.links, ...own];
  const links = all.length ? `<ul class="links">${all.map(link).join('')}</ul>` : '';
  const body = [n.summary ? `<p class="summary">${esc(n.summary)}</p>` : '', facts(n, copy), devices(n.devices), tools, links].join('');
  return (
    `<section class="station" id="${id}" data-node="${id}" data-kind="${esc(n.kind)}" aria-labelledby="${id}-title">` +
    `<div class="head">${head}</div>` +
    (body ? `<div class="body">${body}</div>` : '') +
    `</section>`
  );
}

/** One section per node, in station order (unknown ids just before exit). */
export function renderStations(feed: MapFeed, copy: Copy): string {
  const byId = new Map(feed.nodes.map((n) => [n.id, n]));
  return orderIds(feed.nodes.map((n) => n.id))
    .map((id) => station(byId.get(id)!, copy))
    .join('\n');
}

const sentences = (text: string): string[] => text.split(/(?<=[.!?…])\s+/);

/** `text` with each {key} in it replaced by `values[key]` (a key it doesn't name is left as it is). */
export const fillIn = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? String(values[key]) : all));

/** What the welcome's “What's on it” counts, from the feed as the map shows it (cluster.ts's devices in). */
export function welcomeCounts(feed: MapFeed): { stops: number; projects: number; tools: number; machines: number } {
  const stops = feed.nodes.filter((n) => n.kind !== 'secret');
  return {
    stops: stops.length,
    projects: stops.filter((n) => n.kind === 'project').length,
    tools: stops.filter((n) => n.kind === 'experiments').reduce((sum, n) => sum + (n.children?.length ?? 0), 0),
    machines: stops.filter((n) => n.kind === 'device').length,
  };
}

/** A leader list (as a station's facts), its class naming the pointer it's for, if only one. */
function leaderList(rows: readonly (readonly [string, string])[], cls: string): string {
  const items = rows.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd></div>`);
  return `<dl class="leaders ${cls}">${items.join('')}</dl>`;
}

/**
 * The overview's welcome, ahead of the stations: what the map is and what to do on it, in the
 * panel's column (src/ui/panel.ts). It talks about models, so styles.css shows it only under
 * html.has-3d: the plain page opens with the origin, as before.
 * - It's prerendered, so its heading is the first paint's Largest Contentful Paint:
 *   nothing after it is set as large (styles.css).
 * - The heading, the lede (what this is), then three boxes (Version A of the welcome's words):
 *   Getting around, What's on it, Good to know. The controls come twice, for a mouse
 *   and for touch (.for-mouse, .for-touch); styles.css shows one set, the other display:none, so
 *   a screen reader reads only the one shown.
 * - What's on it counts the stops, projects, tools and machines in `feed`: the feed as the map
 *   shows it, the homelab cluster's devices in (withCluster), so it never goes stale.
 * - Good to know ends on the secrets' counter, "0 of a few" here: the secrets' lazy chunk
 *   (src/moments/found-count.ts) keeps it current. Its row's text for a screen reader is a
 *   hidden span in the label; the label and value it shows are aria-hidden.
 * - After it, the phone's peek hint, its short form for the sheet: aria-hidden, as the
 *   welcome (.sr-only there) already says it to a screen reader.
 */
export function renderWelcome(feed: MapFeed, copy: Copy): string {
  const counts = welcomeCounts(feed);
  const around = (pointer: 'Mouse' | 'Touch') => {
    const last: readonly [string, string] =
      pointer === 'Mouse'
        ? [copy.welcomeBackLabel.text, copy.welcomeBackMouse.text]
        : [copy.welcomeRetraceLabel.text, copy.welcomeRetraceTouch.text];
    const rows = [
      [copy.welcomeVisitLabel.text, copy[`welcomeVisit${pointer}`].text],
      [copy.welcomeMoveLabel.text, copy[`welcomeMove${pointer}`].text],
      [copy.welcomeTurnLabel.text, copy[`welcomeTurn${pointer}`].text],
      [copy.welcomeZoomLabel.text, copy[`welcomeZoom${pointer}`].text],
      [copy.welcomePullLabel.text, copy[`welcomePull${pointer}`].text],
      last,
    ] as const;
    return leaderList(rows, `for-${pointer.toLowerCase()}`);
  };
  const box = (id: string, heading: string, body: string) =>
    `<div class="box"><h3 id="welcome-${id}">${esc(heading)}</h3>${body}</div>`;
  const tip = (text: string, cls = '') => `<li${cls ? ` class="${cls}"` : ''}>${esc(text)}</li>`;
  const tips = [
    tip(copy.welcomeSound.text),
    tip(copy.welcomePokeMouse.text, 'for-mouse'),
    tip(copy.welcomePokeTouch.text, 'for-touch'),
    tip(copy.welcomeReceipt.text),
    tip(copy.welcomeHidden.text),
    tip(copy.welcomeHint.text),
  ];
  const found =
    `<dl class="leaders found"><div>` +
    `<dt><span aria-hidden="true">${esc(copy.welcomeFoundLabel.text)}</span>` +
    `<span class="vh" data-found-sr>${esc(fillIn(copy.welcomeFoundSr.text, { found: 0 }))}</span></dt>` +
    `<dd aria-hidden="true" data-found>${esc(fillIn(copy.welcomeFoundCount.text, { found: 0 }))}</dd>` +
    `</div></dl>`;
  // One span a sentence, each kept whole (styles.css), so the hint wraps only between them.
  const hint = sentences(copy.peekHint.text)
    .map((s) => `<span>${esc(s)}</span>`)
    .join(' ');
  return (
    `<section class="welcome" id="welcome" aria-labelledby="welcome-title">` +
    `<h2 id="welcome-title">${esc(copy.welcomeHeading.text)}</h2>` +
    `<p class="lede">${esc(copy.welcomeLede.text)}</p>` +
    box('around', copy.welcomeAroundHeading.text, around('Mouse') + around('Touch')) +
    box(
      'on-it',
      copy.welcomeOnItHeading.text,
      // Each number kept on its word's line ("7 projects", never "7" alone at a line's end). Two
      // paragraphs, not one: one block of both would out-area the heading in the 340px column
      // (5 lines, 308 × 115 px against its 331 × 102) and take the Largest Contentful Paint.
      `<p class="summary">${esc(fillIn(copy.welcomeOnIt.text, counts).replace(/(\d) /g, '$1 '))}</p>` +
        `<p class="summary">${esc(copy.welcomeOnItWired.text)}</p>`,
    ) +
    box('know', copy.welcomeKnowHeading.text, `<ul class="tips">${tips.join('')}</ul>${found}`) +
    `</section>` +
    `<p class="peek-hint" aria-hidden="true">${hint}</p>`
  );
}

export interface HeaderOptions {
  /** The map's own page: the wordmark is its h1, and the plain page's note follows. The 404
   *  (src/fallback/notfound.ts) has an h1 of its own and no 3D to miss, so neither, and no sound
   *  to switch on: its theme switch comes alone. */
  page?: 'map' | 'notFound';
}

/**
 * The theme switch, as candygoogy.dev's (ThemeSwitch.astro): Auto / Light / Dark in a pill track,
 * a group named "Theme" with aria-pressed on each. styles.css shows it only under html.js (set by
 * boot.ts before the paint, so it appears with no layout shift); src/theme-switch.ts runs it.
 * The labels come twice: the buttons, and an aria-hidden copy clipped to the pill, so each label
 * is the right colour on every frame of the slide. Auto shows what it resolves to: a sun or a
 * moon, and a hidden "(light)" / "(dark)" the script fills in from the data attributes.
 */
function renderThemeSwitch(copy: Copy, sound = true): string {
  const options = [
    ['auto', copy.themeAuto.text],
    ['light', copy.themeLight.text],
    ['dark', copy.themeDark.text],
  ] as const;
  const resolved = `<span class="resolved"></span>`;
  const buttons = options.map(
    ([value, label]) =>
      `<button type="button" data-value="${value}" aria-pressed="${value === 'auto'}">` +
      `<span class="face"><span class="name">${esc(label)}</span>${value === 'auto' ? resolved : ''}</span>` +
      (value === 'auto'
        ? `<span class="vh" data-resolved data-light=" ${esc(copy.themeResolvedLight.text)}" data-dark=" ${esc(copy.themeResolvedDark.text)}"></span>`
        : '') +
      `</button>`,
  );
  const ink = options.map(
    ([value, label]) => `<span class="face" data-label="${esc(label)}">${value === 'auto' ? resolved : ''}</span>`,
  );
  return (
    // The row places it in the header (a row of its own on narrow screens; styles.css).
    `<div class="theme-row">${sound ? renderSoundToggle(copy) : ''}<div class="themes" role="group" aria-label="${esc(copy.themeGroup.text)}" data-theme-switch>` +
    `<span class="pill" aria-hidden="true"></span>${buttons.join('')}` +
    `<div class="ink" aria-hidden="true">${ink.join('')}</div></div></div>`
  );
}

/**
 * The sound toggle (Task 17; src/sound-toggle.ts runs it): a 44×44 speaker, its name "Sound" and
 * aria-pressed, off until the visitor switches it on. The icon shows the state: waves when on,
 * crossed out when off. styles.css shows it only in 3D (the plain page makes no sound): on
 * desktop at the map side's end of the header, by the panel's rule; on a phone left of the theme
 * pill, in its row.
 */
function renderSoundToggle(copy: Copy): string {
  return (
    `<button type="button" class="sound" data-sound aria-pressed="false" aria-label="${esc(copy.sound.text)}">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>` +
    `<path class="waves" d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>` +
    `<path class="cross" d="M16 9.5l5 5m0-5-5 5"/>` +
    `</svg></button>`
  );
}

/** The header: the wordmark, the theme switch (the map's page only) and the way back to the site. */
export function renderHeader(feed: MapFeed, copy: Copy, { page = 'map' }: HeaderOptions = {}): string {
  const [name, ...rest] = copy.wordmark.text.split(' / ');
  const mark = rest.length
    ? `${esc(name!)}<span class="soft"> / ${esc(rest.join(' / '))}</span>`
    : esc(copy.wordmark.text);
  const tag = page === 'map' ? 'h1' : 'p';
  const home = new URL('/', feed.site.url).href;
  return (
    `<${tag} class="mark">${mark}</${tag}>` +
    // On the 404 too (src/fallback/notfound.ts), as on candygoogy.dev's and the experiments'.
    renderThemeSwitch(copy, page === 'map') +
    `<a class="back" href="${esc(home)}">${esc(copy.backToSite.text)}</a>` +
    // Only true when 3D isn't running; styles.css hides it under html.has-3d.
    (page === 'map' ? `<p class="plain-note">${esc(copy.plainNote.text)}</p>` : '')
  );
}
