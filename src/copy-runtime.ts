// The map's words that only the 3D runtime shows: the travel controls, the labels' status,
// the hints. They're kept apart from src/copy.ts's page words so the runtime's chunk carries
// these and not the words the prerendered HTML already has (the welcome, the facts, the
// header). src/copy.ts merges both into `copy`, which the prerender, the tests and the launch
// check (LAUNCH=1 npx vitest run tests/unit/copy.test.ts) read, so every key is still checked.
// The runtime imports `runtimeCopy` from here, never `copy`. Same rules as src/copy.ts:
// approved: false until the owner has approved the words, typographic quotes throughout.

export type RuntimeCopyKey =
  | 'stationCounter'
  | 'checking'
  | 'working'
  | 'skipHint'
  | 'prevStation'
  | 'nextStation'
  | 'skipToStation'
  | 'skipToWelcome'
  | 'stationsNav'
  | 'powerButton'
  | 'strayButton'
  | 'duckName'
  | 'duckLine1'
  | 'duckLine2';

export const runtimeCopy: Record<RuntimeCopyKey, { text: string; approved: boolean }> = {
  // {n} is the station's place in the order, {total} the number of stations.
  stationCounter: { text: '{n} of {total}', approved: true },
  checking: { text: 'Checking…', approved: true },
  working: { text: 'Working', approved: true },
  skipHint: { text: 'Click or press any key to skip', approved: true },
  prevStation: { text: 'Previous station', approved: true },
  nextStation: { text: 'Next station', approved: true },
  // The skip link after ‹ › (the pre-launch audit's item 3), shown only while focused: past the
  // labels to the panel's heading, a station's or, in the overview, the welcome's.
  // Approved on the owner's instruction, 2026-10-22.
  skipToStation: { text: 'Skip to the station’s text', approved: true },
  // Approved on the owner's instruction, 2026-10-22.
  skipToWelcome: { text: 'Skip to the welcome', approved: true },
  // The name of the navigation that holds ‹ ›, the counter and a label on every node.
  stationsNav: { text: 'Stations', approved: true },
  // The origin panel's button for the power switch (Task 15): the switch, from the keyboard.
  // Approved with the Task 15 proposal's drafted words, 2026-10-20.
  powerButton: { text: 'Turn it off and on again', approved: true },
  // Task 17, secret 4 (drafted 2026-10-21, for the owner's approval). The button laid over a
  // stray signal while it rides, the only way to the duck: its name, read by a screen reader
  // only while one is out (nothing visible).
  strayButton: { text: 'Follow the stray signal', approved: true },
  // The hidden node's name (its label and its panel's heading) and its two-line panel.
  duckName: { text: 'Rubber duck', approved: true },
  duckLine1: { text: 'You followed a stray signal off the edge of the map. Not many do.', approved: true },
  duckLine2: {
    text: 'Explain your code to it, line by line. It never says a word, and the bug turns up anyway.',
    approved: true,
  },
};
