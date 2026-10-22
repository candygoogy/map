// When and from which commit this build was made, for the 404's footer stamp, as candygoogy.dev's
// src/lib/build.ts gives its own. Build time only: vite-plugin-prerender.ts calls buildStamp()
// while it writes dist/404.html, so none of this reaches a bundle. The commit comes from Workers
// Builds' environment (WORKERS_CI_COMMIT_SHA), then from git. Without either the stamp shows just
// the date; the build never fails over it. One log line says which source was used, or why none
// worked. A commit read from git, in a tree with uncommitted changes, is marked dirty: the build
// isn't that commit.

import { execSync } from 'node:child_process';

export interface BuildStamp {
  /** <time datetime>, in UTC: "2026-10-22". */
  iso: string;
  /** "Oct 22, 2026", in UTC, no time of day. */
  label: string;
  /** The full commit, lower case; undefined when none could be read. */
  commit: string | undefined;
  /** Read from git, with uncommitted changes in the tree. */
  dirty: boolean;
}

/** Where the stamp's parts come from, passed in so the tests can stand in for each one. */
export interface StampSources {
  env: string | undefined;
  /** Runs `git <args>` and returns its output; throws where git isn't there. */
  git: (args: string) => string;
  now: Date;
}

const SHA = /^[0-9a-f]{40}$/i;

const firstLine = (error: unknown) =>
  String((error as { stderr?: Buffer }).stderr?.toString().trim() || (error as Error).message || error).split('\n')[0];

const realSources = (): StampSources => ({
  env: process.env['WORKERS_CI_COMMIT_SHA'],
  git: (args) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(),
  now: new Date(),
});

export function buildStamp(sources: StampSources = realSources()): BuildStamp {
  const { git, now } = sources;
  const iso = now.toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(now);
  const misses: string[] = [];

  const env = sources.env?.trim();
  if (env && SHA.test(env)) return found({ iso, label, commit: env.toLowerCase(), dirty: false }, 'WORKERS_CI_COMMIT_SHA', misses);
  misses.push(`env ${env ? 'not a SHA' : 'empty'}`);

  try {
    const sha = git('rev-parse HEAD').trim();
    if (SHA.test(sha)) return found({ iso, label, commit: sha.toLowerCase(), dirty: uncommitted(git) }, 'git', misses);
    misses.push(`git gave "${sha}"`);
  } catch (error) {
    misses.push(`git: ${firstLine(error)}`);
  }

  console.warn(`build stamp: no commit (${misses.join('; ')})`);
  return { iso, label, commit: undefined, dirty: false };
}

function uncommitted(git: StampSources['git']): boolean {
  try {
    return git('status --porcelain').trim() !== '';
  } catch {
    return false;
  }
}

function found(stamp: BuildStamp, source: string, misses: string[]): BuildStamp {
  const why = misses.length ? ` (${misses.join('; ')})` : '';
  console.log(`build stamp: commit ${stamp.commit!.slice(0, 7)} from ${source}${why}${stamp.dirty ? ', marked dirty' : ''}`);
  return stamp;
}

/** The commit as the stamp shows it: "1a2b3c4", or "1a2b3c4-dirty". */
export const shortCommit = (stamp: BuildStamp): string | undefined =>
  stamp.commit && `${stamp.commit.slice(0, 7)}${stamp.dirty ? '-dirty' : ''}`;
