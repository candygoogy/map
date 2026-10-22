// The trip receipt's words (Task 16): the printed receipt, the exit's
// "Leave" and the receipt's panel. Only the lazy receipt moment (src/moments/) imports them,
// so neither the page nor the runtime's first-load chunk carries them. src/copy.ts merges them
// into `copy`, which the launch check reads. Same rules as src/copy.ts.
//
// Approved by the owner with the Task 16 proposal, "with its recommendations and drafted
// words" (2026-10-20); "Leave" and "Keep the receipt" were the design's own from the start.
// Words added since are approved: false.

export type ReceiptCopyKey =
  | 'receiptStarted'
  | 'receiptLeft'
  | 'receiptDuration'
  | 'receiptVerdictAll'
  | 'receiptVerdictHalf'
  | 'receiptVerdictFew'
  | 'receiptSubAll'
  | 'receiptSubLeft'
  | 'receiptSubLeftOne'
  | 'receiptStations'
  | 'receiptRoute'
  | 'receiptNumbers'
  | 'receiptStops'
  | 'receiptRevisits'
  | 'receiptPokes'
  | 'receiptPower'
  | 'receiptSecrets'
  | 'receiptSecretsCount'
  | 'receiptSecretsNone'
  | 'receiptThanks'
  | 'receiptJoke'
  | 'receiptHost'
  | 'leave'
  | 'keepReceipt'
  | 'receiptKept';

export const receiptCopy: Record<ReceiptCopyKey, { text: string; approved: boolean }> = {
  // The printed receipt, top to bottom.
  receiptStarted: { text: 'Arrived', approved: true },
  receiptLeft: { text: 'Left', approved: true },
  receiptDuration: { text: 'Time on the map', approved: true },
  receiptVerdictAll: { text: 'Seen it all.', approved: true },
  receiptVerdictHalf: { text: 'Well travelled.', approved: true },
  receiptVerdictFew: { text: 'Just passing through.', approved: true },
  receiptSubAll: { text: 'Every station, start to finish.', approved: true },
  // {n}: stations not visited.
  receiptSubLeft: { text: '{n} stations left for next time.', approved: true },
  receiptSubLeftOne: { text: 'One station left for next time.', approved: true },
  receiptStations: { text: 'Stations', approved: true },
  receiptRoute: { text: 'Route', approved: true },
  receiptNumbers: { text: 'The numbers', approved: true },
  receiptStops: { text: 'Stops', approved: true },
  receiptRevisits: { text: 'Back again at', approved: true },
  receiptPokes: { text: 'Things poked', approved: true },
  receiptPower: { text: 'Turned off and on again', approved: true },
  receiptSecrets: { text: 'Secrets found', approved: true },
  // {n}: secrets found. The total is never shown (secrets are never pointed at).
  receiptSecretsCount: { text: '{n} of a few', approved: true },
  receiptSecretsNone: { text: 'None yet', approved: true },
  receiptThanks: { text: 'Thanks for travelling.', approved: true },
  receiptJoke: { text: 'No refunds. Turning it off and on again is free.', approved: true },
  receiptHost: { text: 'map.candygoogy.dev', approved: true },
  // The exit panel's button, and the receipt panel's.
  leave: { text: 'Leave', approved: true },
  keepReceipt: { text: 'Keep the receipt', approved: true },
  // New (Task 16 build): the polite status line once the PNG is saved or shared.
  receiptKept: { text: 'Saved as candygoogy-trip.png.', approved: true },
};
