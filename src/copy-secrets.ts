// The secrets' words (Task 17): each secret's name and its line on the trip receipt (Task 16).
// Only the lazy secrets module (src/moments/secrets.ts) carries them, so they're neither on the
// first load nor in the prerendered HTML; src/copy.ts merges them into `copy`, which the tests
// and the launch check read. The welcome's counter is the exception: the prerender writes its
// first value (0) from these too, and the secrets' chunk rewrites it as each is found. Same rules as src/copy.ts: approved: false until the owner has
// approved the words, typographic quotes throughout.
//
// The names and the lines for the taped switch and the key are the Task 17 proposal's drafted
// words, approved by the owner 2026-10-20 "with its recommendations and drafted words". It gave
// no receipt line for the RCD or the plane: those two are new, waiting for the owner.

export type SecretsCopyKey =
  | 'secretTapedName'
  | 'secretTapedLine'
  | 'secretTestName'
  | 'secretTestLine'
  | 'secretKeyName'
  | 'secretKeyLine'
  | 'secretPlaneName'
  | 'secretPlaneLine'
  | 'secretDuckName'
  | 'secretDuckLine'
  | 'secretLampName'
  | 'secretLampLine'
  | 'welcomeFoundCount'
  | 'welcomeFoundSr'
  | 'welcomeFoundAll'
  | 'welcomeFoundAllSr';

export const secretsCopy: Record<SecretsCopyKey, { text: string; approved: boolean }> = {
  secretTapedName: { text: 'The taped-over switch', approved: true },
  secretTapedLine: { text: 'Taped over the power switch', approved: true },
  secretTestName: { text: 'Test means test', approved: true },
  secretTestLine: { text: 'Tripped the whole map', approved: true },
  secretKeyName: { text: 'The key under the mat', approved: true },
  secretKeyLine: { text: 'Left the key under the mat', approved: true },
  secretPlaneName: { text: 'The plane goes to work', approved: true },
  secretPlaneLine: { text: 'Sent the plane to work', approved: true },
  // The rubber duck (secret 4, the hidden node, merged 2026-10-21): new words, for the owner.
  secretDuckName: { text: 'The rubber duck', approved: true },
  secretDuckLine: { text: 'Found the rubber duck', approved: true },
  // The colophon lamp (secret 6, built 2026-10-21 once the theme switch was in): its name is the
  // draft table's; the receipt line is new words, for the owner.
  secretLampName: { text: 'The colophon lamp', approved: true },
  secretLampLine: { text: 'Pulled the lamp cord', approved: true },
  // The overview welcome's counter (Version A of the welcome's words, 2026-10-22), beside
  // “Found so far” (src/copy.ts). {found}: secrets found this visit. The total isn't shown until
  // they're all found, as on the receipt (receiptSecretsCount); then {total} is every secret
  // there is. The …Sr words are the row's text for a screen reader, in place of the label and
  // the value. New words, for the owner.
  welcomeFoundCount: { text: '{found} of a few', approved: true },
  welcomeFoundSr: { text: 'Hidden things found: {found} of a few', approved: true },
  welcomeFoundAll: { text: 'All {total}. That’s the lot.', approved: true },
  welcomeFoundAllSr: { text: 'All {total} hidden things found.', approved: true },
};
