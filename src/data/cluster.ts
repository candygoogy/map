// The homelab cluster (Task 13 Batch B, option A, approved 2026-10-19): the machines behind the
// router are stations of their own, each a node on a short link from homelab's. The feed carries
// them only as homelab's `devices` (from the main site's uses.ts, which /map.json carries anyway),
// so the map makes the nodes itself: a device becomes a sub-node when world.blend places it, that
// is when world.json has a spot for its id and a link to it from the node that lists it, or from
// another of its placed devices (linkFrom: the real wiring's tree, router → switch → AP → laptop).
// The rest stay text in the hub's device list, and a device the owner drops from uses.ts drops off
// the map.
//
// A sub-node is a FeedNode of kind `device`, right after its hub in feed order: the device's
// label is its name, its product the line under it (blurb) and its detail the panel's text
// (summary); its page is the hub's (the site's /uses). `parent` names the hub. Device.parent
// stays the uses.ts tree, which only the hub's device list shows. Both the prerender (the
// stations' sections) and map.ts (the scene) run the feed through this, so the page and the
// scene agree; the embedded snapshot stays the feed as it came.

import type { FeedNode, MapFeed } from './feed';

/** What it reads of world.json: the placed nodes and each link's parent, where not the origin. */
export interface ClusterWorld {
  nodes: Record<string, readonly number[]>;
  linkFrom?: Record<string, string>;
}

/** The feed with every placed device as a node of its own, just after the node that lists it. */
export function withCluster(feed: MapFeed, world: ClusterWorld): MapFeed {
  const ids = new Set(feed.nodes.map((n) => n.id));
  const nodes: FeedNode[] = [];
  for (const n of feed.nodes) {
    nodes.push(n);
    const listed = new Set((n.devices ?? []).map((d) => d.id));
    // The real wiring is a tree (2026-10-21: router → switch → AP → laptop): a device joins when
    // its link leaves the node that lists it, or another placed device it lists that does.
    const joins = (id: string, depth = 0): boolean => {
      const p = world.linkFrom?.[id];
      return p === n.id || (p !== undefined && depth < 8 && listed.has(p) && p in world.nodes && joins(p, depth + 1));
    };
    for (const d of n.devices ?? []) {
      if (ids.has(d.id) || !(d.id in world.nodes) || !joins(d.id)) continue;
      const sub: FeedNode = { id: d.id, kind: 'device', parent: n.id, name: d.label, blurb: d.product, links: [] };
      if (d.detail !== undefined) sub.summary = d.detail;
      if (n.page !== undefined) sub.page = n.page;
      nodes.push(sub);
    }
  }
  return { ...feed, nodes };
}
