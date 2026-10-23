<h1 align="center">candygoogy / map</h1>

<p align="center"><b>candygoogy.dev as a little 3D network you can travel through.</b></p>

<p align="center">
  <a href="https://map.candygoogy.dev">Map</a> ·
  <a href="https://candygoogy.dev">Website</a> ·
  <a href="mailto:hello@candygoogy.dev">hello@candygoogy.dev</a>
</p>

<p align="center">
  <a href="https://github.com/candygoogy/map.candygoogy.dev/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/candygoogy/map.candygoogy.dev/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Code: MIT" src="https://img.shields.io/badge/code-MIT-3651d4"></a>
  <img alt="Built with Three.js" src="https://img.shields.io/badge/built%20with-Three.js-3651d4">
</p>

The map lives at [map.candygoogy.dev](https://map.candygoogy.dev). There's no link to it from search: you find it through [candygoogy.dev](https://candygoogy.dev)'s 404 page or its Colophon.

Every part of candygoogy.dev is a stop on it: the projects, the small tools under Experiments, the homelab and its machines (wired the way they are at home), the colophon and the exit. Each stop is a small model made in Blender, joined to the others by cables. A gondola carries you from one stop to the next along them, and signals run over the wires while you look around. Poke a model and it does something. A few things are hidden, and none of them are bugs. Leave by the exit's door and Fettle prints you a receipt.

All of it is drawn in the browser with WebGL, but every stop is also in the HTML, written ahead of time, so nothing depends on the 3D. Without WebGL2 or JavaScript you get the plain page: the same stops and facts as a list, which is also what a screen reader reads. Stops are reachable by keyboard (‹ › or the arrow keys, Esc for the overview). When your system asks for reduced motion, the camera cuts between stops instead of flying, and the traffic and the idle drift stop. Sound is off until you turn it on. There are no analytics, trackers or cookies, and the page talks to no server but its own. Your theme and sound choices are kept in your browser.

## How it's built

- **Rendering:** [Three.js](https://threejs.org) on WebGL2, in plain TypeScript with no framework, bundled by [Vite](https://vite.dev). The parts of three.js the map uses beyond its core (the glTF loader, the wide lines and the meshopt decoder) are vendored and trimmed to what the models need, so less JavaScript loads first. The rest (the moments, the secrets, the sound) loads in its own chunks, when it's needed.
- **Content:** candygoogy.dev publishes `/map.json`, a small feed of its pages and projects. The build reads it, validates it, and writes the stops into the HTML; the page itself never fetches it. After each of its own deploys, candygoogy.dev asks Workers Builds to rebuild the map, so the map follows the site.
- **Models:** made in Blender, exported to glTF and compressed (meshopt geometry, WebP textures). The compressed GLBs in `public/models/` are the build input. The Blender sources aren't part of this repo.
- **Sound:** every sound is made in code with Web Audio, shaped on the real thing (a rubber stamp, a receipt printer, a breaker). Nothing is recorded or downloaded. [`sounds/SOURCES.md`](sounds/SOURCES.md) lists each one and where it plays.
- **Hosting:** Cloudflare Workers static assets, with no Worker script. `public/_headers` sets a strict Content-Security-Policy (no inline script or style) and keeps the map out of search results; a path that isn't a file gets the map's own 404 page.
- **Deploys:** Workers Builds, from this repo's `deploy` branch. CI moves `deploy` up to `main` only once every check on it has passed.
- **Checks:** the type check, the unit tests, the build and the built site under `wrangler dev`, as Cloudflare serves it, on every push in [CI](.github/workflows/ci.yml), with the browser tests of the pages that need no GPU. The 3D browser tests need a real GPU, so they run on a machine with one before each push.

```text
src/
  main.ts, map.ts     the page's entry and the map's runtime
  data/               the feed's types and parser, the fixture feed, world.json (the
                      stops' places, the cameras and the cables)
  world/ stage/       the scene: models, cables, the gondola and the traffic
  camera/ nav/        the flights between stops
  input/ ui/          pointer, touch and keyboard; the panel and the labels
  moments/            what a poke sets off, the secrets, and the sound
  fallback/           the prerendered HTML: the plain page and the 404
  vendor/             three.js's glTF loader, wide lines and meshopt decoder, trimmed
  fonts/ icons/
public/models/        the compressed models
dev/model.html        a model viewer (npm run dev only)
tests/unit/           Vitest
tests/e2e/            Playwright
scripts/              the vendored files' trimmers and the model compressor
vite-plugin-prerender.ts       writes the stops into index.html, and the 404
vite-plugin-three-shaders.ts   slims three.js's shader source in the build
wrangler.jsonc        Cloudflare config (no account details)
```

## Develop

Uses Node 24, the version in `.node-version` (CI uses it too).

```sh
npm ci
npx playwright install chromium   # once, for the browser tests
npm run dev                       # the Vite dev server, with the fixture feed
npm run typecheck                 # tsc
npm test                          # unit tests (Vitest)
npx playwright test --project=chromium   # browser tests (starts the dev server itself)
npm run build                     # static output in dist/
npx wrangler dev                  # serve dist/ as Cloudflare does, headers and 404 included
```

With `npx wrangler dev --port 8788` running on a build, `npx playwright test --project=worker` checks the site as the Worker serves it.

### The feed

The build and the dev server read the feed from `FEED_URL`, a file path or an http(s) URL. Without it they use `src/data/fixture.json`, so the map runs offline. To build against the live site:

```sh
FEED_URL=https://candygoogy.dev/map.json npm run build
```

A feed that can't be read or doesn't match the schema fails the build with the reason, so nothing stale ships.

## Fonts

Headings are set in [Newsreader](https://github.com/productiontype/Newsreader) by Production Type, and body text and the wordmark in [Schibsted Grotesk](https://github.com/schibsted/schibsted-grotesk) by Schibsted Media Group. Both are under the [SIL Open Font License 1.1](https://openfontlicense.org), so the WOFF2 files are committed in `src/fonts/`, each next to its license (`OFL-Newsreader.txt`, `OFL-SchibstedGrotesk.txt`). They're the same files candygoogy.dev serves, built there from the upstream files in google/fonts: Newsreader at one optical size, both cut to the weights and characters the sites use. The map serves them from its own domain.

## Credits

- [three.js](https://github.com/mrdoob/three.js) by the three.js authors, under the MIT License. The trimmed copies of its glTF loader and wide lines in `src/vendor/` keep their notice.
- The meshopt decoder in `src/vendor/` is from [meshoptimizer](https://github.com/zeux/meshoptimizer) by Arseny Kapoulkine, under the MIT License, and keeps its notice.
- The built site drops those headers when it minifies, so it serves the full license texts of three.js, meshoptimizer, Vite's preload helper and both fonts at [`/third-party-licenses.txt`](public/third-party-licenses.txt).

## License

- **Code** (everything that makes the map work, the scripts and shaders included) is under the [MIT License](LICENSE).
- The **fonts** in `src/fonts/` are under the SIL Open Font License 1.1 (see [Fonts](#fonts)).
- **Content** (the writing, the 3D models, the sounds, and the candygoogy name and identity) is **© candygoogy, all rights reserved**. It isn't covered by the MIT License, so please don't reuse it without asking.
- The **avatar** artwork the site icon is made from is by [@dark_night1109](https://x.com/dark_night1109/status/2104328383211737219). It belongs to the artist and isn't covered by the © candygoogy content line or the MIT License.
- The vendored **three.js** and **meshoptimizer** code in `src/vendor/` stays under its own MIT License (see [Credits](#credits)).
- The **Fettle** marks belong to the Fettle project. Third-party names and sites mentioned here belong to their owners.
