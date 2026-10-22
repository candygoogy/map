// Every word that exists only on the map. Content words (names, summaries,
// links) come from the feed. Each entry stays approved: false until the
// owner has approved it word for word; the launch check (LAUNCH=1
// npx vitest run tests/unit/copy.test.ts) fails while any is still false.
// Typographic quotes and apostrophes throughout (’ “ ”), as on the site.
//
// The words here are the page's: the prerendered HTML carries them (the header, the
// welcome, the stations' facts). The words only the 3D runtime shows live in
// src/copy-runtime.ts, so the runtime's chunk doesn't carry these; the secrets' (Task 17) in
// src/copy-secrets.ts and the trip receipt's (Task 16) in src/copy-receipt.ts, each carried
// by its lazy chunk alone; `copy` is all four.

import { receiptCopy, type ReceiptCopyKey } from './copy-receipt';
import { runtimeCopy, type RuntimeCopyKey } from './copy-runtime';
import { secretsCopy, type SecretsCopyKey } from './copy-secrets';

export type PageCopyKey =
  | 'wordmark'
  | 'pageTitle'
  | 'backToSite'
  | 'plainNote'
  | 'themeGroup'
  | 'themeAuto'
  | 'themeLight'
  | 'themeDark'
  | 'themeResolvedLight'
  | 'themeResolvedDark'
  | 'sound'
  | 'welcomeHeading'
  | 'welcomeLede'
  | 'welcomeAroundHeading'
  | 'welcomeVisitLabel'
  | 'welcomeVisitMouse'
  | 'welcomeVisitTouch'
  | 'welcomeMoveLabel'
  | 'welcomeMoveMouse'
  | 'welcomeMoveTouch'
  | 'welcomeTurnLabel'
  | 'welcomeTurnMouse'
  | 'welcomeTurnTouch'
  | 'welcomeZoomLabel'
  | 'welcomeZoomMouse'
  | 'welcomeZoomTouch'
  | 'welcomePullLabel'
  | 'welcomePullMouse'
  | 'welcomePullTouch'
  | 'welcomeBackLabel'
  | 'welcomeBackMouse'
  | 'welcomeRetraceLabel'
  | 'welcomeRetraceTouch'
  | 'welcomeOnItHeading'
  | 'welcomeOnIt'
  | 'welcomeOnItWired'
  | 'welcomeKnowHeading'
  | 'welcomeSound'
  | 'welcomePokeMouse'
  | 'welcomePokeTouch'
  | 'welcomeReceipt'
  | 'welcomeHidden'
  | 'welcomeHint'
  | 'welcomeFoundLabel'
  | 'peekHint'
  | 'pageLink'
  | 'factStatus'
  | 'factVersion'
  | 'factRunsOn'
  | 'factStack'
  | 'factLicense'
  | 'statusLive'
  | 'statusInProgress'
  | 'statusArchived'
  | 'nfPageTitle'
  | 'nfHeading'
  | 'nfLede'
  | 'nfBack'
  | 'nfRouteCheck'
  | 'nfYou'
  | 'nfSite'
  | 'nfThisPage'
  | 'nfNotFound'
  | 'nfStatus'
  | 'nfDescription'
  | 'nfSkip'
  | 'nfChecking'
  | 'nfRestarting'
  | 'nfTime'
  | 'nfPath'
  | 'nfEggHint'
  | 'nfEggReply'
  | 'nfOpensSite'
  | 'nfFootOwner'
  | 'nfFootPrivacy'
  | 'nfFootColophon'
  | 'nfFootUses'
  | 'nfFootBuilt'
  | 'nfFootBuiltFrom'
  | 'nfFootCommit'
  | 'nfFootCommitDirty'
  | 'nfFootSource';

export type CopyKey = PageCopyKey | RuntimeCopyKey | SecretsCopyKey | ReceiptCopyKey;

export type Copy = Record<CopyKey, { text: string; approved: boolean }>;

export const pageCopy: Record<PageCopyKey, { text: string; approved: boolean }> = {
  // Settled with the owner.
  wordmark: { text: 'candygoogy / map', approved: true },
  // The tab's title, as the main site's "<Page> – candygoogy" (and the 404's): approved by the owner,
  // 2026-10-22 evening (it was the wordmark, "candygoogy / map", beside the site's tabs).
  pageTitle: { text: 'Map – candygoogy', approved: true },
  backToSite: { text: 'Back to the site', approved: true },
  // Shown only on the plain page (html.no-3d), beside the way back.
  plainNote: { text: 'The 3D map couldn’t run here, so this is the plain version.', approved: true },
  // The header's theme switch, as candygoogy.dev's (ThemeSwitch.astro): the group's name and
  // its three options (approved with the switch's proposal, 2026-10-20). Auto's hidden
  // suffix says what it resolves to, for a screen reader (“Auto (dark)”); not approved yet.
  themeGroup: { text: 'Theme', approved: true },
  themeAuto: { text: 'Auto', approved: true },
  themeLight: { text: 'Light', approved: true },
  themeDark: { text: 'Dark', approved: true },
  themeResolvedLight: { text: '(light)', approved: true },
  themeResolvedDark: { text: '(dark)', approved: true },
  // The header's sound toggle (Task 17), an icon button: its name, the only word it has
  // (approved with the sound proposal, 2026-10-20).
  sound: { text: 'Sound', approved: true },
  // The overview's welcome, in the panel's column (decided on the owner's instruction,
  // 2026-10-18). Its heading, and its lede: the first sentence of the retired welcomeBody, word
  // for word (approved with it). The rest of welcomeBody (what to do, and “A few things are
  // hidden.”) is retired for the three boxes below.
  welcomeHeading: { text: 'Hey, you found the map.', approved: true },
  welcomeLede: { text: 'This is candygoogy.dev as a little network you can travel through.', approved: true },
  // The welcome's boxes (Version A of their words, 2026-10-22; for the owner to
  // approve as they try it). One set of controls shows: the mouse set under (hover: hover) and
  // (pointer: fine), the touch set otherwise (styles.css). Each row a label and its value.
  welcomeAroundHeading: { text: 'Getting around', approved: false },
  welcomeVisitLabel: { text: 'Visit a stop', approved: false },
  welcomeVisitMouse: { text: 'click a model, or ‹ ›', approved: false },
  welcomeVisitTouch: { text: 'tap a model, or ‹ ›', approved: false },
  welcomeMoveLabel: { text: 'Move the map', approved: false },
  welcomeMoveMouse: { text: 'drag the floor', approved: false },
  welcomeMoveTouch: { text: 'drag the floor', approved: false },
  welcomeTurnLabel: { text: 'Turn it', approved: false },
  welcomeTurnMouse: { text: 'right-drag or Shift-drag', approved: false },
  welcomeTurnTouch: { text: 'twist two fingers', approved: false },
  welcomeZoomLabel: { text: 'Zoom', approved: false },
  welcomeZoomMouse: { text: 'scroll', approved: false },
  welcomeZoomTouch: { text: 'pinch', approved: false },
  welcomePullLabel: { text: 'Pull a model', approved: false },
  welcomePullMouse: { text: 'drag it', approved: false },
  welcomePullTouch: { text: 'hold it, then drag', approved: false },
  // The mouse set's last row; the touch set has Back instead.
  welcomeBackLabel: { text: 'Back to this view', approved: false },
  welcomeBackMouse: { text: 'Esc', approved: false },
  welcomeRetraceLabel: { text: 'Retrace your steps', approved: false },
  welcomeRetraceTouch: { text: 'Back', approved: false },
  // {stops}, {projects}, {tools} and {machines} are counted from the feed at prerender
  // (src/fallback/html.ts, after the homelab cluster's devices join it), never written here.
  welcomeOnItHeading: { text: 'What’s on it', approved: false },
  welcomeOnIt: {
    text: '{stops} stops, from candygoogy.dev to the exit: {projects} projects, {tools} small tools under Experiments, the homelab and {machines} of its machines, and the colophon.',
    approved: false,
  },
  welcomeOnItWired: { text: 'The homelab is wired the way it is at home.', approved: false },
  welcomeKnowHeading: { text: 'Good to know', approved: false },
  welcomeSound: { text: 'Sound is off. The speaker up top turns it on.', approved: false },
  welcomePokeMouse: { text: 'At a stop, click its model to poke it.', approved: false },
  welcomePokeTouch: { text: 'At a stop, tap its model to poke it.', approved: false },
  welcomeReceipt: { text: 'Leave by Exit’s door. Fettle prints a receipt.', approved: false },
  // “A few things are hidden.” is the retired welcomeBody's approved sentence; the second is new.
  welcomeHidden: { text: 'A few things are hidden. None of them are bugs.', approved: false },
  welcomeHint: { text: 'Try things twice, and watch the traffic.', approved: false },
  // The counter's label. Its value and its screen-reader text are in src/copy-secrets.ts, as the
  // secrets' chunk keeps them current (the prerender writes 0).
  welcomeFoundLabel: { text: 'Found so far', approved: false },
  // The phone's peek sheet in the overview: the welcome's short form, beside ‹ ›. One sentence a
  // line: the hint has 216px beside ‹ › at 360px wide, 246px at 390. The rotation draft's approved
  // “Drag it to pull, or drag the floor to turn.” is 266px, so it broke onto a third line; this
  // shorter one (213px) took its place, approved by the owner (2026-10-21). Moving the map (the
  // owner, 2026-10-22 morning) put the new gestures in its second line, as short (187px; “Drag to
  // move, two fingers to turn.”, 231px, broke onto a third line at 360px).
  // Approved on the owner's instruction, 2026-10-22.
  peekHint: { text: 'Tap a model to visit it. Drag to move, twist to turn.', approved: true },
  // A station's link to its own page on candygoogy.dev.
  pageLink: { text: 'Read the full page', approved: true },
  // The facts list's labels.
  factStatus: { text: 'Status', approved: true },
  factVersion: { text: 'Version', approved: true },
  factRunsOn: { text: 'Runs on', approved: true },
  factStack: { text: 'Stack', approved: true },
  factLicense: { text: 'License', approved: true },
  // A project's status, as the site words it.
  statusLive: { text: 'Live', approved: true },
  statusInProgress: { text: 'In progress', approved: true },
  statusArchived: { text: 'Archived', approved: true },
  // The 404 (dist/404.html, src/fallback/notfound.ts): candygoogy.dev's 404 (404.astro) word for
  // word, except the way back, which goes to the map's own start (/) as the site's goes to its
  // home; the header's backToSite still leads to candygoogy.dev. A hop that answers says
  // `working`.
  nfPageTitle: { text: 'Page not found – candygoogy', approved: true },
  nfHeading: { text: 'Page not found', approved: true },
  nfLede: { text: 'There’s nothing at this address. It may have moved, or the link has a typo.', approved: true },
  nfBack: { text: 'Back to the map', approved: true },
  nfRouteCheck: { text: 'Route check', approved: true },
  nfYou: { text: 'You', approved: true },
  nfSite: { text: 'candygoogy.dev', approved: true },
  nfThisPage: { text: 'This page', approved: true },
  nfNotFound: { text: 'Not found', approved: true },
  nfStatus: { text: 'Status', approved: true },
  // Brought with the site's motion, header and footer (the owner, 2026-10-22 evening: "the 404
  // page needs to have full parity with others"): the site's 404, its Base.astro and Footer.astro
  // word for word, so approved as they are there. nfTime is the route check's request time
  // ({time} is HH:MM:SS); the hint and the reply are the last hop's egg; the footer's links lead
  // to the site's pages, as its "No trackers, no cookies" does from every experiment.
  nfDescription: { text: 'There’s nothing at this address.', approved: true },
  nfSkip: { text: 'Skip to content', approved: true },
  nfChecking: { text: 'Checking…', approved: true },
  nfRestarting: { text: 'Restarting…', approved: true },
  nfTime: { text: '{time} UTC', approved: true },
  nfPath: { text: 'Path', approved: true },
  nfEggHint: { text: 'Have you tried turning it off and on again?', approved: true },
  nfEggReply: { text: 'Tried it. Still a 404.', approved: true },
  // New, the map's own: the route check's second hop is a door back to the site, as the site's is
  // the door to the map (its hidden ". Opens the map"); read after "candygoogy.dev, Working".
  nfOpensSite: { text: '. Opens the site', approved: false },
  nfFootOwner: { text: '© {year} candygoogy', approved: true },
  nfFootPrivacy: { text: 'No trackers, no cookies', approved: true },
  nfFootColophon: { text: 'Colophon', approved: true },
  nfFootUses: { text: 'Uses', approved: true },
  // The build stamp, the site's (Footer.astro, and its card.ts's "Built … from …"): {date} is a
  // <time>, {commit} the short sha linked to the commit, named by nfFootCommit (or, built from a
  // tree with uncommitted changes, nfFootCommitDirty). "Source" links to the map's repository,
  // the site's own word for its source (its colophon's Source row); no "Back to top" on the 404
  // (the owner, 2026-10-22 evening).
  nfFootBuilt: { text: 'Built {date}', approved: true },
  nfFootBuiltFrom: { text: 'Built {date} from {commit}', approved: true },
  nfFootCommit: { text: 'commit {commit}', approved: true },
  nfFootCommitDirty: { text: 'commit {commit}, with uncommitted changes', approved: true },
  nfFootSource: { text: 'Source', approved: true },
};

export const copy: Copy = { ...pageCopy, ...runtimeCopy, ...secretsCopy, ...receiptCopy };
