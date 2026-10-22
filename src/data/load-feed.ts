// Reads the content feed at build time, for the prerender plugin
// (vite-plugin-prerender.ts). Node only: it's kept out of feed.ts so the page's
// bundle, which parses the embedded snapshot with parseFeed, never pulls in
// node:fs.

import { FeedError, parseFeed, type MapFeed } from './feed';

/**
 * Reads the feed from a file path (relative to `root`) or an http(s) URL and
 * validates it. Every failure is a FeedError that names the source.
 */
export async function loadFeed(
  source: string,
  fetchImpl: typeof fetch = fetch,
  root: string = process.cwd(),
): Promise<MapFeed> {
  let text: string;
  if (/^https?:\/\//i.test(source)) {
    let res: Response;
    try {
      res = await fetchImpl(source);
    } catch (err) {
      throw new FeedError(`couldn't fetch ${source}: ${(err as Error).message}`);
    }
    if (!res.ok) throw new FeedError(`${source} answered HTTP ${res.status}`);
    text = await res.text();
  } else {
    const [{ readFile }, { resolve }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
    const path = resolve(root, source);
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new FeedError(
        `couldn't read the feed file ${path}: ${code === 'ENOENT' ? 'no such file' : (code ?? (err as Error).message)}`,
      );
    }
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new FeedError(`${source} is not valid JSON: ${(err as Error).message}`);
  }
  try {
    return parseFeed(json);
  } catch (err) {
    if (err instanceof FeedError) throw new FeedError(`${source}: ${err.message}`);
    throw err;
  }
}
