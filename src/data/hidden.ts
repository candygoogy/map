// The map's hidden nodes (Task 17, secret 4; stations.ts HIDDEN): the rubber duck, off the map's
// far edge, found only by following a stray signal down its undrawn link. The feed never lists
// it: it's the map's own, like the cluster's devices, so the scene makes it here, from
// world.json's spot for it, with its words from copy-runtime.ts. The prerender doesn't: the
// plain page has no 3D and no stray signals, so it has no duck, and its words stay out of the
// HTML until the runtime finds it (section(), kept `hidden` till then).

import type { FeedNode, MapFeed } from './feed';

/** What it reads of world.json: the placed nodes. */
export interface HiddenWorld {
  nodes: Record<string, readonly number[]>;
}

/** The duck's id: stations.ts's HIDDEN. */
export const DUCK = 'duck';

/** duck.glb's bounds without its floor shadow (root space, as nodes.ts measures them), for its
 *  framing and footprint before the model is in: it loads only on the first stray. glb.test
 *  checks they match the file. */
export const DUCK_BOUNDS = { min: [-0.4, 0, -0.2301], max: [0.4, 0.4927, 0.2425] } as const;

/** The feed with the duck as a node of its own, last, if world.blend places it. */
export function withHidden(feed: MapFeed, world: HiddenWorld, name: string): MapFeed {
  if (!(DUCK in world.nodes) || feed.nodes.some((n) => n.id === DUCK)) return feed;
  const duck: FeedNode = { id: DUCK, kind: 'secret', name, links: [] };
  return { ...feed, nodes: [...feed.nodes, duck] };
}

/** Its panel: a station section as html.ts writes them, `hidden` until it's found. */
export function hiddenSection(doc: Document, id: string, name: string, lines: readonly string[]): HTMLElement {
  const section = doc.createElement('section');
  section.className = 'station';
  section.id = id;
  section.dataset.node = id;
  section.dataset.kind = 'secret';
  section.setAttribute('aria-labelledby', `${id}-title`);
  section.hidden = true;
  const head = doc.createElement('div');
  head.className = 'head';
  const h2 = doc.createElement('h2');
  h2.id = `${id}-title`;
  h2.textContent = name;
  head.append(h2);
  const body = doc.createElement('div');
  body.className = 'body';
  for (const line of lines) {
    const p = doc.createElement('p');
    p.className = 'summary';
    p.textContent = line;
    body.append(p);
  }
  section.append(head, body);
  return section;
}
