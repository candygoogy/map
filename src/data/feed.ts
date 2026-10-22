// The map's content feed: the main site's /map.json, read once at build
// time by the prerender plugin (vite-plugin-prerender.ts). The page never
// fetches it; it reads the snapshot embedded in the HTML.

export interface MapFeed {
  version: 1;
  generated: string;
  site: { name: string; url: string; headline: string; line: string; links: Link[] };
  nodes: FeedNode[];
}

export interface Link {
  label: string;
  href: string;
}

/** The feed's kinds, and the map's own: `device`, a homelab sub-node (cluster.ts), and `secret`, a
 *  hidden node (hidden.ts, Task 17), never in the feed. */
export type NodeKind = 'origin' | 'project' | 'experiments' | 'homelab' | 'colophon' | 'exit' | 'device' | 'secret';

export interface FeedNode {
  id: string;
  kind: NodeKind;
  /** A sub-node's hub: the node whose link it hangs off (cluster.ts). Never set by the feed. */
  parent?: string;
  name: string;
  blurb?: string;
  summary?: string;
  status?: string;
  version?: string;
  runsOn?: string;
  license?: string;
  stack?: string[];
  links: Link[];
  updated?: string;
  page?: string;
  children?: { id: string; name: string; href: string }[];
  devices?: Device[];
}

/** One of the homelab's devices, in tree order: each after the one it hangs off (parent). */
export interface Device {
  id: string;
  label: string;
  product: string;
  parent?: string;
  detail?: string;
}

export class FeedError extends Error {
  override name = 'FeedError';
}

const KINDS: readonly NodeKind[] = ['origin', 'project', 'experiments', 'homelab', 'colophon', 'exit'];
// Ids become HTML ids, URL hashes and model file names.
const ID = /^[a-z0-9][a-z0-9-]*$/;
// Links leave for https pages (the main site's own rule) or an email
// address; a mistyped javascript: or data: fails the build.
const SCHEMES = new Set(['https:', 'mailto:']);

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, at: string): Obj {
  if (!isObj(v)) throw new FeedError(`${at} must be an object`);
  return v;
}

function str(o: Obj, key: string, at: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.trim() === '') throw new FeedError(`${at}.${key} must be a non-empty string`);
  return v;
}

function optStr(o: Obj, key: string, at: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, at);
}

function arr(o: Obj, key: string, at: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new FeedError(`${at}.${key} must be an array`);
  return v;
}

function url(raw: string, base: string, at: string): string {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    throw new FeedError(`${at} is not a valid URL: ${raw}`);
  }
  if (!SCHEMES.has(u.protocol)) throw new FeedError(`${at} uses ${u.protocol}, which isn't allowed: ${raw}`);
  return u.href;
}

function links(o: Obj, key: string, base: string, at: string): Link[] {
  return arr(o, key, at).map((l, i) => {
    const where = `${at}.${key}[${i}]`;
    const link = obj(l, where);
    return { label: str(link, 'label', where), href: url(str(link, 'href', where), base, `${where}.href`) };
  });
}

function node(raw: unknown, i: number, base: string): FeedNode {
  const at = `nodes[${i}]`;
  const o = obj(raw, at);
  const id = str(o, 'id', at);
  if (!ID.test(id)) throw new FeedError(`${at}.id must be lowercase letters, digits and dashes: ${id}`);
  const kind = str(o, 'kind', at);
  if (!(KINDS as readonly string[]).includes(kind)) throw new FeedError(`${at}.kind is unknown: ${kind}`);
  const n: FeedNode = { id, kind: kind as NodeKind, name: str(o, 'name', at), links: links(o, 'links', base, at) };

  for (const key of ['blurb', 'summary', 'status', 'version', 'runsOn', 'license', 'updated'] as const) {
    const v = optStr(o, key, at);
    if (v !== undefined) n[key] = v;
  }
  const page = optStr(o, 'page', at);
  if (page !== undefined) n.page = url(page, base, `${at}.page`);
  if (o.stack !== undefined) {
    n.stack = arr(o, 'stack', at).map((s, j) => {
      if (typeof s !== 'string' || s.trim() === '') throw new FeedError(`${at}.stack[${j}] must be a non-empty string`);
      return s;
    });
  }
  if (o.children !== undefined) {
    n.children = arr(o, 'children', at).map((c, j) => {
      const where = `${at}.children[${j}]`;
      const child = obj(c, where);
      return {
        id: str(child, 'id', where),
        name: str(child, 'name', where),
        href: url(str(child, 'href', where), base, `${where}.href`),
      };
    });
  }
  if (o.devices !== undefined) n.devices = devices(o, at);
  return n;
}

// Tree order: a device's parent is listed before it.
function devices(o: Obj, at: string): Device[] {
  const seen = new Set<string>();
  return arr(o, 'devices', at).map((d, j) => {
    const where = `${at}.devices[${j}]`;
    const dev = obj(d, where);
    const id = str(dev, 'id', where);
    if (!ID.test(id)) throw new FeedError(`${where}.id must be lowercase letters, digits and dashes: ${id}`);
    if (seen.has(id)) throw new FeedError(`${where}.id ${id} appears twice`);
    const out: Device = { id, label: str(dev, 'label', where), product: str(dev, 'product', where) };
    const parent = optStr(dev, 'parent', where);
    if (parent !== undefined) {
      if (!seen.has(parent)) throw new FeedError(`${where}.parent ${parent} isn't a device listed before it`);
      out.parent = parent;
    }
    const detail = optStr(dev, 'detail', where);
    if (detail !== undefined) out.detail = detail;
    seen.add(id);
    return out;
  });
}

/** Validates a feed and resolves every relative href and page against site.url. */
export function parseFeed(json: unknown): MapFeed {
  const o = obj(json, 'feed');
  if (o.version !== 1) throw new FeedError(`feed.version must be 1, got ${JSON.stringify(o.version)}`);
  const s = obj(o.site, 'site');
  const base = str(s, 'url', 'site');
  try {
    if (new URL(base).protocol !== 'https:') throw new Error();
  } catch {
    throw new FeedError(`site.url must be an absolute https URL: ${base}`);
  }
  const site = {
    name: str(s, 'name', 'site'),
    url: base,
    headline: str(s, 'headline', 'site'),
    line: str(s, 'line', 'site'),
    links: links(s, 'links', base, 'site'),
  };
  const nodes = arr(o, 'nodes', 'feed').map((n, i) => node(n, i, base));
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) throw new FeedError(`node id ${n.id} appears twice`);
    seen.add(n.id);
  }
  // A device can become a node of its own (the homelab cluster, cluster.ts), with its id as
  // its station's hash and its model's name, so no device may share an id with a node or with
  // another node's device.
  const devices = new Map<string, string>();
  nodes.forEach((n, i) =>
    n.devices?.forEach((d, j) => {
      const where = `nodes[${i}].devices[${j}].id`;
      if (seen.has(d.id)) throw new FeedError(`${where} ${d.id} is also a node's id`);
      const other = devices.get(d.id);
      if (other !== undefined) throw new FeedError(`${where} ${d.id} is also one of ${other}'s devices`);
      devices.set(d.id, n.id);
    }),
  );
  return { version: 1, generated: str(o, 'generated', 'feed'), site, nodes };
}
