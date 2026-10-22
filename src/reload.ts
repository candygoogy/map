// A reload of the page as it is (its hash kept, so the map lands back at the visitor's station),
// at most once for each `mark`: the mark is kept in sessionStorage, and a page that finds it
// already there doesn't reload again, so a cause the reload can't cure can't loop. Where
// sessionStorage can't be used, nothing reloads.

/** Reloads unless this tab already reloaded with `mark` under `key`; true if it's reloading. */
export function reloadOnce(key: string, mark: string): boolean {
  try {
    if (sessionStorage.getItem(key) === mark) return false;
    sessionStorage.setItem(key, mark);
  } catch {
    return false;
  }
  location.reload();
  return true;
}
