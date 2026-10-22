import { describe, expect, it } from 'vitest';
import { copy } from '../../src/copy';
import fixture from '../../src/data/fixture.json';
import world from '../../src/data/world.json';
import { withCluster } from '../../src/data/cluster';
import { type MapFeed, parseFeed } from '../../src/data/feed';
import { esc, renderStations, renderWelcome, welcomeCounts } from '../../src/fallback/html';

const sectionIds = (html: string) =>
  [...html.matchAll(/<section class="station" id="([^"]+)" data-node="([^"]+)"/g)].map((m) => {
    expect(m[1]).toBe(m[2]);
    return m[1];
  });

describe('fallback html', () => {
  it('renders one section per node in station order, with an unknown id placed before exit', () => {
    const feed = parseFeed(fixture);
    // A new project the map doesn't know yet, listed first in the feed.
    feed.nodes.unshift({ id: 'new-thing', kind: 'project', name: 'New thing', links: [] });
    // And the known ones shuffled, so order comes from the stations, not the feed.
    feed.nodes.reverse();
    const html = renderStations(feed, copy);
    expect(sectionIds(html)).toEqual([
      'origin', 'fettle', 'idiff', 'notary', 'candygoogy-bot', 'dolci-eoliani',
      'siel-eolie', 'eolietech', 'experiments', 'homelab', 'colophon', 'new-thing', 'exit',
    ]);
    expect(html.match(/<h2[ >]/g)).toHaveLength(13);
    expect(html).toContain('<dl class="facts');
    expect(html).toContain('href="https://fettle.page/"');
  });

  // The homelab cluster (Batch B): each placed device gets a station section of its own after
  // homelab's, its label the heading, its product the line under it and its detail the text,
  // marked data-kind="device" (styles.css keeps them off the plain page, which lists them once).
  it("renders the cluster's devices as station sections after homelab's", () => {
    const html = renderStations(withCluster(parseFeed(fixture), world), copy);
    const ids = sectionIds(html);
    expect(ids.slice(ids.indexOf('homelab'), ids.indexOf('homelab') + 7)).toEqual(['homelab', 'switch', 'desktop', 'server', 'ap', 'laptop', 'colophon']);
    const server = /<section class="station" id="server"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(server).toContain('data-kind="device"');
    expect(server).toContain('<h2 id="server-title">Server</h2><p class="blurb">Lenovo V15</p>');
    expect(server).toContain('<p class="summary">Runs candygoogy-bot</p>');
    expect(server).toContain('href="https://candygoogy.dev/uses#homelab"');
  });

  it('renders homelab devices in tree order', () => {
    const html = renderStations(parseFeed(fixture), copy);
    const homelab = /<section class="station" id="homelab"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    const list = /<dl class="devices leaders">([\s\S]*?)<\/dl>/.exec(homelab)?.[1] ?? '';
    const rows = [...list.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/g)].map((m) => [m[1], m[2]]);
    expect(rows.map(([label]) => label)).toEqual([
      'Internet', 'Router', 'Switch', 'Access point', 'Laptop', 'Everything else', 'Server', 'Desktop',
    ]);
    expect(rows[0]?.[1]).toBe('5G');
    // A device's detail is a soft line under its product.
    expect(rows[3]?.[1]).toBe('Ubiquiti UniFi U7 Pro Wall</dd><dd class="detail">Wi-Fi 7');
    expect(rows[6]?.[1]).toBe('Lenovo V15</dd><dd class="detail">Runs candygoogy-bot');
    expect(rows[5]?.[1]).toBe('Whatever asks for the password');
  });

  it('renders the overview’s welcome as a named section: heading, lede, three boxes, and the phone’s peek hint, from copy', () => {
    const html = renderWelcome(withCluster(parseFeed(fixture), world), copy);
    expect(html).toContain('<section class="welcome" id="welcome" aria-labelledby="welcome-title">');
    expect(html).toContain(
      `<h2 id="welcome-title">${esc(copy.welcomeHeading.text)}</h2>` +
        '<p class="lede">This is candygoogy.dev as a little network you can travel through.</p>',
    );
    // The retired paragraph is gone.
    expect(html).not.toContain('drag the map to move around');
    // Three boxes, each a small heading and its body, in the approved copy's order.
    expect([...html.matchAll(/<div class="box"><h3 id="welcome-([\w-]+)">(.*?)<\/h3>/g)].map((m) => [m[1], m[2]])).toEqual([
      ['around', esc(copy.welcomeAroundHeading.text)],
      ['on-it', esc(copy.welcomeOnItHeading.text)],
      ['know', esc(copy.welcomeKnowHeading.text)],
    ]);
    // Getting around: a leader list for each pointer, as a station's facts; styles.css shows one.
    const rows = (cls: string) => {
      const dl = new RegExp(`<dl class="leaders ${cls}">([\\s\\S]*?)</dl>`).exec(html)?.[1] ?? '';
      return [...dl.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/g)].map((m) => [m[1], m[2]]);
    };
    expect(rows('for-mouse')).toEqual([
      ['Visit a stop', 'click a model, or ‹ ›'],
      ['Move the map', 'drag the floor'],
      ['Turn it', 'right-drag or Shift-drag'],
      ['Zoom', 'scroll'],
      ['Pull a model', 'drag it'],
      ['Back to this view', 'Esc'],
    ]);
    expect(rows('for-touch')).toEqual([
      ['Visit a stop', 'tap a model, or ‹ ›'],
      ['Move the map', 'drag the floor'],
      ['Turn it', 'twist two fingers'],
      ['Zoom', 'pinch'],
      ['Pull a model', 'hold it, then drag'],
      ['Retrace your steps', 'Back'],
    ]);
    // Good to know: one line each, the poke line in both sets.
    expect(html).toContain(
      '<ul class="tips"><li>Sound is off. The speaker up top turns it on.</li>' +
        '<li class="for-mouse">At a stop, click its model to poke it.</li>' +
        '<li class="for-touch">At a stop, tap its model to poke it.</li>' +
        `<li>${esc('Leave by Exit’s door. Fettle prints a receipt.')}</li>` +
        '<li>A few things are hidden. None of them are bugs.</li>' +
        '<li>Try things twice, and watch the traffic.</li></ul>',
    );
    // The counter, at 0, and never the total (as the receipt): its label and value for the eye,
    // its own words for a screen reader.
    expect(html).toContain(
      '<dl class="leaders found"><div><dt><span aria-hidden="true">Found so far</span>' +
        '<span class="vh" data-found-sr>Hidden things found: 0 of a few</span></dt>' +
        '<dd aria-hidden="true" data-found>0 of a few</dd></div></dl>',
    );
    // The hint is the welcome's short form, so a screen reader hears the welcome once, not both.
    // Each sentence is kept whole, so a narrow sheet breaks the hint between them.
    expect(html).toContain(
      '<p class="peek-hint" aria-hidden="true"><span>Tap a model to visit it.</span> <span>Drag to move, twist to turn.</span></p>',
    );
  });

  // The numbers in What's on it come from the feed as the map shows it, never from the copy.
  it('counts the welcome’s stops, projects, tools and machines from the feed', () => {
    const feed = withCluster(parseFeed(fixture), world);
    expect(welcomeCounts(feed)).toEqual({ stops: 17, projects: 7, tools: 7, machines: 5 });
    // Each number kept on its word's line (a no-break space), the wiring a paragraph of its own.
    expect(renderWelcome(feed, copy).replaceAll(' ', ' ')).toContain(
      `<p class="summary">${esc('17 stops, from candygoogy.dev to the exit: 7 projects, 7 small tools under Experiments, the homelab and 5 of its machines, and the colophon.')}</p>` +
        '<p class="summary">The homelab is wired the way it is at home.</p>',
    );
    expect(renderWelcome(feed, copy)).toContain('exit: 7 projects, 7 small');
    // A project more, a tool fewer, a machine left off the map: the words follow.
    const more = parseFeed(fixture);
    more.nodes.unshift({ id: 'new-thing', kind: 'project', name: 'New thing', links: [] });
    const exp = more.nodes.find((n) => n.kind === 'experiments')!;
    exp.children = exp.children!.slice(1);
    const placed = { ...world, nodes: { ...world.nodes } } as typeof world;
    delete (placed.nodes as Record<string, unknown>).laptop;
    const counts = welcomeCounts(withCluster(more, placed));
    expect(counts).toEqual({ stops: 17, projects: 8, tools: 6, machines: 4 });
    expect(renderWelcome(withCluster(more, placed), copy).replaceAll(' ', ' ')).toContain(
      '17 stops, from candygoogy.dev to the exit: 8 projects, 6 small tools under Experiments, the homelab and 4 of its machines',
    );
  });

  it('escapes HTML in names', () => {
    const feed: MapFeed = {
      version: 1,
      generated: '2026-10-18',
      site: { name: 'x', url: 'https://candygoogy.dev', headline: 'h', line: 'l', links: [] },
      nodes: [
        {
          id: 'evil"id',
          kind: 'project',
          name: '<img src=x onerror=alert(1)>',
          summary: 'Tom & "Jerry"',
          stack: ['<b>Rust</b>'],
          links: [{ label: '<i>Source</i>', href: 'https://example.com/?a=1&b="2"' }],
        },
      ],
    };
    const html = renderStations(feed, copy);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>Rust');
    expect(html).not.toContain('<i>Source');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Tom &amp; &quot;Jerry&quot;');
    expect(html).toContain('id="evil&quot;id"');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;"');
  });
});
