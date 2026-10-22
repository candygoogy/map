import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import fixture from '../../src/data/fixture.json';
import world from '../../src/data/world.json';
import { withCluster } from '../../src/data/cluster';
import { FeedError, parseFeed } from '../../src/data/feed';
import { prerender } from '../../vite-plugin-prerender';

const root = fileURLToPath(new URL('../..', import.meta.url));
const clone = (): any => structuredClone(fixture);

describe('feed', () => {
  it('parses the fixture', () => {
    const feed = parseFeed(fixture);
    expect(feed.version).toBe(1);
    expect(feed.site.url).toBe('https://candygoogy.dev');
    expect(feed.nodes.map((n) => n.id)).toEqual([
      'origin', 'fettle', 'idiff', 'notary', 'candygoogy-bot', 'dolci-eoliani',
      'siel-eolie', 'eolietech', 'experiments', 'homelab', 'colophon', 'exit',
    ]);
    expect(feed.nodes.find((n) => n.id === 'fettle')).toMatchObject({
      kind: 'project',
      name: 'Fettle',
      status: 'live',
      version: '1.0.5',
      license: 'MIT',
      updated: '2026-10-10',
    });
    expect(feed.nodes.find((n) => n.id === 'experiments')?.children).toHaveLength(7);
    const devices = feed.nodes.find((n) => n.id === 'homelab')?.devices;
    expect(devices).toHaveLength(8);
    expect(devices?.[0]).toEqual({ id: 'internet', label: 'Internet', product: '5G' });
    expect(devices?.[6]).toEqual({
      id: 'server', label: 'Server', product: 'Lenovo V15', parent: 'switch', detail: 'Runs candygoogy-bot',
    });
  });

  // The homelab cluster (Batch B): a device can become a node of its own, so its id can't be a
  // node's, nor another node's device's.
  it("rejects a device whose id is a node's, or another node's device's", () => {
    const clash = clone();
    clash.nodes.find((n: any) => n.id === 'homelab').devices[6].id = 'fettle';
    expect(() => parseFeed(clash)).toThrow(/devices\[6\]\.id fettle is also a node's id/);
    const twice = clone();
    twice.nodes.find((n: any) => n.id === 'fettle').devices = [{ id: 'desktop', label: 'Desk', product: 'A desk' }];
    expect(() => parseFeed(twice)).toThrow(/desktop is also one of fettle's devices/);
  });

  it('withCluster makes every device world.blend places a node of its own, right after its hub', () => {
    const feed = withCluster(parseFeed(fixture), world);
    const ids = feed.nodes.map((n) => n.id);
    const at = ids.indexOf('homelab');
    // In the devices' own order (uses.ts's tree order); internet, router and crowd have no spot.
    expect(ids.slice(at, at + 6)).toEqual(['homelab', 'switch', 'ap', 'laptop', 'server', 'desktop']);
    expect(ids).not.toContain('internet');
    expect(ids).not.toContain('router');
    expect(ids).not.toContain('crowd');
    expect(feed.nodes.find((n) => n.id === 'server')).toEqual({
      id: 'server', kind: 'device', parent: 'homelab', name: 'Server', blurb: 'Lenovo V15', summary: 'Runs candygoogy-bot',
      links: [], page: 'https://candygoogy.dev/uses#homelab',
    });
    expect(feed.nodes.find((n) => n.id === 'desktop')).not.toHaveProperty('summary');
    // The feed itself is left as it came.
    expect(parseFeed(fixture).nodes).toHaveLength(12);
    // A device world.blend doesn't place, or whose link leaves another node, stays text.
    const { ap: _, ...rest } = world.linkFrom;
    expect(withCluster(parseFeed(fixture), { ...world, linkFrom: rest }).nodes.map((n) => n.id)).not.toContain('ap');
  });

  // The real wiring's tree (2026-10-21): only the switch's link leaves homelab; the rest leave the
  // switch or the AP, devices homelab lists too, so they join through them.
  it('withCluster takes a device whose link leaves another of the hub’s placed devices, down the tree', () => {
    expect(world.linkFrom).toMatchObject({ switch: 'homelab', ap: 'switch', laptop: 'ap' });
    const ids = (linkFrom: Record<string, string>) => withCluster(parseFeed(fixture), { ...world, linkFrom }).nodes.map((n) => n.id);
    expect(ids(world.linkFrom)).toEqual(expect.arrayContaining(['switch', 'desktop', 'server', 'ap', 'laptop']));
    for (const n of withCluster(parseFeed(fixture), world).nodes.filter((n) => n.kind === 'device')) expect(n.parent, n.id).toBe('homelab');
    // Without the AP's link the laptop hangs off nothing placed: both stay text.
    const { ap: _, ...noAp } = world.linkFrom;
    expect(ids(noAp)).not.toContain('laptop');
    // A link from a node homelab doesn't list (another project) never joins it.
    expect(ids({ ...world.linkFrom, laptop: 'fettle' })).not.toContain('laptop');
  });

  it('rejects a node without id', () => {
    const bad = clone();
    delete bad.nodes[1].id;
    expect(() => parseFeed(bad)).toThrow(FeedError);
    expect(() => parseFeed(bad)).toThrow(/nodes\[1\]\.id/);
  });

  it('resolves relative links and pages against site.url', () => {
    const raw = clone();
    raw.nodes[1].links.push({ label: 'Relative', href: '/fettle/download' });
    raw.site.links.push({ label: 'Home', href: '/' });
    const feed = parseFeed(raw);
    const fettle = feed.nodes.find((n) => n.id === 'fettle')!;
    expect(fettle.page).toBe('https://candygoogy.dev/fettle');
    expect(fettle.links.at(-1)?.href).toBe('https://candygoogy.dev/fettle/download');
    expect(feed.site.links.at(-1)?.href).toBe('https://candygoogy.dev/');
    expect(feed.nodes.find((n) => n.id === 'homelab')?.page).toBe('https://candygoogy.dev/uses#homelab');
    // Absolute links stay as they are.
    expect(fettle.links[0]?.href).toBe('https://fettle.page/');

    // A script URL is refused rather than resolved.
    raw.nodes[1].links.push({ label: 'Bad', href: 'javascript:alert(1)' });
    expect(() => parseFeed(raw)).toThrow(FeedError);
  });

  it("the prerender fails the build on a 500, on invalid JSON and on a feed that doesn't parse", async () => {
    const feedUrl = 'https://candygoogy.dev/map.json';
    const noId = clone();
    delete noId.nodes[0].id;
    const cases: [Response, RegExp][] = [
      [new Response('down', { status: 500 }), /500/],
      [new Response('{ not json', { status: 200 }), /JSON/],
      [new Response(JSON.stringify(noId), { status: 200 }), /nodes\[0\]\.id/],
    ];
    for (const [response, reason] of cases) {
      const fetchImpl = async () => response;
      await expect(
        build({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [prerender({ feedUrl, fetchImpl: fetchImpl as typeof fetch })],
          build: { write: false },
        }),
      ).rejects.toThrow(reason);
    }
  });
});
