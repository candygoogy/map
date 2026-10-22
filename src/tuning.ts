// Every feel constant in one place (Global Constraints → "Paths and tuning"). Tasks read
// their numbers from here, and Task 12 records the values agreed with the owner. These are
// the plan's starting values. Lengths are world units and times seconds unless the name
// says px or ms.

export const tuning = {
  // Clock (Task 4)
  /** Longest frame step: a stalled or hidden tab never jumps an animation further. */
  dtMax: 0.1,

  // Stage (Task 5)
  /** Drop to the `low` tier when the mean frame of the last `tierSamples` exceeds this. */
  tierFrameMs: 22,
  tierSamples: 120,
  /** Device-pixel-ratio cap per tier. */
  dpr: { high: 2, low: 1 },
  /** At this viewport width and up the panel sits on the right; below it, a bottom sheet. */
  panelMinViewportPx: 900,
  panelWidthPx: 460,
  /** Bottom sheet height as a fraction of the viewport: open at a station, peek otherwise. */
  sheetOpen: 0.45,
  /** The peek on a portrait screen (the phone pass, 2026-10-22: was 0.15, its hint's area read
   *  tall), and on a landscape one, where 10% would be shorter than the travel row's 44 px.
   *  styles.css holds both as --sheet-peek (and its shift) by orientation. */
  sheetPeek: 0.1,
  sheetPeekWide: 0.15,
  /** How long the sheet takes between peek and open (eased in-out cubic, like a flight); the
   *  camera's inset follows it. Skipped under reduced motion. To tune at Task 12. */
  sheetSeconds: 0.45,
  /** Station to station a bottom sheet peeks for the ride only on flights at least this long
   *  (seconds of the flight's own clock): on shorter hops it would dip and come straight back,
   *  so it stays open (owner, 2026-10-21; 52 of 272 hops were under 1.2 s). */
  sheetPeekMinFlight: 1.2,

  // Layout, links and traffic (Task 6)
  /** Link and ring line width in CSS px (scaled by the pixel ratio for LineMaterial). */
  hairline: 1,
  /** A hovered node's ground ring, CSS px wide (--soft too; links.ts): 1 px barely read in the
   *  overview, where a ring is a few px across (map-tweaks, 2026-10-22). */
  hoverRing: 2,
  /** Up close it's lighter (the owner, 2026-10-22 morning: heavy at a station): `px` wide with the
   *  camera `from` world units or nearer the node (a station's 3 to 11, the overview zoomed all the
   *  way in about 10), hoverRing from `to` on (the overview's 40 and more), tapered between. */
  hoverRingNear: { px: 1.5, from: 12, to: 24 },
  /** How high a link's control point lifts over its ends, for the plain arc the runtime draws
   *  only for ids not yet placed in world.blend (world.py's LINK_LIFT; the known links are
   *  level-ended, their top world.py's LINK_TOP, 0.1, over their ends, since 2026-10-20). */
  linkLift: 0.9,
  /** How high both ends of every link sit, on a mast over their node's centre (links.ts draws
   *  the masts, floor to here). LINK_MAST in world.py, which authors the known links on the
   *  same masts (a unit test pins the two); the runtime's own arc for an unplaced id uses it,
   *  and a pulled link keeps its end this far over the moved node. A hair over the gondola's
   *  hang (visitorDrop + visitorDockGap, 0.27), so the line through the hub keeps the cabin off
   *  the floor. Each authored link runs level at this height for 0.95 from either end
   *  (world.py's LINK_SHOULDER), so the gondola docks at visitorDock on every link with its
   *  belly about visitorDockGap over the floor, then rises to a top 0.1 over it (LINK_TOP).
   *  Owner's go on masts, 2026-10-19 late (0.3; the line left the floor before); level cable
   *  ends, 2026-10-20. */
  linkMast: 0.272,
  /** A link stopped at its model's edge fades out over this much of its end, instead of
   *  stopping in mid-air (links.ts, Line ends; the owner's pick (a), 2026-10-21 night). */
  linkEndFade: 0.35,
  /** A link over the air (world.json's `dotted`: the laptop's, on the AP's Wi-Fi, 2026-10-21) is
   *  drawn dotted, dashes `on` long and `off` apart in world units: about 2 px and 3 px in the
   *  overview. Signals and the gondola ride it as any link. */
  linkDots: { on: 0.045, off: 0.075 },
  /** Unknown ids go on a ring this far out, at least `unknownGap` from every node. */
  unknownRing: 10.5,
  unknownGap: 1.5,
  /** Round the origin, each in a gap between the tiers of nodes: 4.5 inside the stations, 7.2
   *  between them and the outer nodes (layout.test keeps 0.3 clear of every ground ring). Was
   *  [4.5, 9]: the 9 ran through the outer nodes, touching the AP's ring and crossing
   *  homelab's (the owner's test, 2026-10-21). */
  rangeRings: [4.5, 7.2],
  /** The ring around each model's base: a thin halo just outside the models' footprints
   *  (half-diagonals 0.45–0.48), so it shows at rest instead of only when a model lifts.
   *  Task 12 (motion audit #6): was 0.32, hidden under the models. */
  groundRing: 0.6,
  /** How long a link takes to change colour: hover (--soft) and route (--acc) here, the
   *  power switch's fade to --ghost at `linkLitSeconds`. To tune at Task 12. */
  linkFadeSeconds: 0.15,
  linkLitSeconds: 0.45,
  /** Signals per minute on a link: floor + extra × 0.5^(ageDays / halfLifeDays), where a
   *  node with no `updated` date counts as `undatedDays` old. */
  traffic: { floor: 1, extra: 11, halfLifeDays: 30, undatedDays: 365 },
  signalSpeed: 3.2,
  signalMax: 24,
  /** Seconds kept between signals leaving the hub, so it never sends a burst; a due link
   *  waits for the next free slot. Task 12 (motion audit #15). */
  hubSpacing: 0.15,
  /** A signal grows from nothing over this much of its link where it comes out of the
   *  origin's model, and shrinks away over as much where it goes into the node's (units). */
  signalGrow: 0.15,
  /** Nearer the camera than this (units, along its view), a signal shrinks with its depth, so it's
   *  never bigger on screen than here (traffic.ts, nearScale). The overview's nearest link is
   *  32.4 deep, turned all the way (34.1 at rest), so the overview is unchanged; a station's
   *  signals keep the size they have at its front edge. */
  signalNear: 30,
  /** Zoomed in, signalNear is the zoom's share of itself, so signals grow with the map; after
   *  travel resets the zoom it eases back over this time constant, seconds (traffic.ts, followZoom). */
  signalUnzoom: 0.3,
  /** Zoomed in, a signal grows on screen to this many times its overview size and no more: its
   *  scale is at most this times signalNear's share (traffic.ts, zoomedScale), the camera being
   *  about that share as deep; near the camera none passes 1.8x (max / 1.2) a signal at
   *  signalNear. So at full zoom (4x) the longest pill on screen is about 2.5 times the
   *  overview's (seen less foreshortened), desktop or phone, not 4: they'd be blobs. */
  signalZoomMax: 2.2,
  /** A signal on the gondola's link hops its grip: `height` over the line within `top` of the
   *  pin, back on the line `half` from it (a smoothstep each side). The clamp rises 0.032 over
   *  the pin and reaches 0.064 behind it; the pill is 0.26 long and 0.056 in half girth at its
   *  pulse, so 0.11 clears the clamp even tilted along the hop (traffic.test). */
  signalHop: { height: 0.11, half: 0.32, top: 0.05 },
  /** The homelab cluster's traffic (Task 13 Batch B): signals for a sub-node leave the origin,
   *  ride homelab's link and wait `pause` seconds inside the router before going on down the
   *  sub-link. Devices have no `updated` date, so each sub-node gets `perMinute` (a recent
   *  project gets 12, an undated node about 1). To tune at the batch's checkpoint 4. */
  signalRelay: { perMinute: 2, pause: 0.35 },
  /** Task 17, secret 4: about one signal in `odds` goes astray instead of its own way, while
   *  the duck is still hidden and no other stray is out: out of a node near the view (the
   *  station's, or one on screen) on an undrawn way of its own, round to the duck from off the
   *  map's edge (moments/stray-way.ts). Until the owner's test of 2026-10-21 ("always in one
   *  position") every one left the origin down the duck's link. It rides at `pace` of a
   *  signal's speed (a wanderer, and a keyboard user's time to reach it) and stops while its
   *  button is hovered or focused. With motion reduced, where no signal runs, one waits still
   *  on such a way for `parkSeconds`, every `parkEvery` seconds (± half) after the arrival: the
   *  same find, with the motion cut. It waits `at` units out of its node's model (half the way
   *  at most), so it's in view where it sets out; it was 0.62 of the origin's way to the duck,
   *  which on a way from the far side would be off the screen. Odds were 40 until the
   *  owner's test notes: at a signal's size the owner never saw one. The duck moment
   *  marks it too, a waddle and a dotted trail (duck.ts). None goes by chance until `first`
   *  seconds after the arrival ends, nor for `gap` seconds after one ends (reached the duck,
   *  followed, or gone); past that the odds hold, so about one every 2 to 3 minutes. At 1 in
   *  20 of some 66 signals a minute, one left almost as soon as the last had gone (the owner's
   *  test: "the easter egg now comes a lot"). sendStray() and the park keep their own times. */
  stray: { odds: 20, pace: 0.55, at: 1.5, parkSeconds: 12, parkEvery: 75, first: 40, gap: 120 },

  // Nodes (Task 7)
  /** Springs: mass 1, stiffness k, damping c, sub-stepped at a fixed `step` (stable at dtMax). */
  spring: { k: 170, c: 14, step: 1 / 120 },
  /** How far a hover lifts the model: 0, replaced by its ground ring going --soft (links.ts;
   *  the owner's test notes: a lift moved the model being aimed at). Was 0.15: set it
   *  back to compare. */
  hoverLift: 0,
  /** The spring's damping for a hover's lift and drop (ζ ≈ 1: no bounce past hoverLift, for
   *  something done tens of times a visit). A drag's release keeps spring.c and its
   *  overshoot. Task 12 (motion audit #15): was spring.c, a 12% overshoot. */
  hoverDamping: 26,
  /** How far a dragged model lifts off the floor. To tune at Task 12. */
  dragLift: 0.6,
  /** While dragged, a model follows the pointer on the floor (x, z) on this stiffer spring:
   *  ζ = 1, settled in about 0.15 s, so it keeps close and stops dead. Its lift (y) keeps
   *  `spring`. Task 12 (motion audit #7): was `spring`, 0.36 behind and a 0.14 overshoot. */
  dragFollow: { k: 900, c: 60 },
  /** How far from home a dragged node can be pulled. */
  dragRadius: 2.5,
  /** Pointer travel before a press becomes a drag (less is a click); also cancels a boost hold. */
  dragThresholdPx: 6,
  /** Seconds a finger on a model is held before travel can pull it (with dragThresholdPx), so a
   *  tap is never a drag (the owner's test notes). Travel before it pulls nothing,
   *  and having travelled, the press isn't a click either. A mouse or pen pulls at once (the
   *  owner, 2026-10-22). The current station's model never pulls. */
  pullHold: 0.15,
  /** The contact shadow at dragLift: its opacity and scale are multiplied by these, linearly
   *  from 1 on the floor, and held past it. Lighter and wider as the model rises. To tune at Task 12. */
  shadowFade: { opacity: 0.35, scale: 1.35 },
  /** A dropped model meets the floor and bounces back up with this share of its speed. To tune at Task 12. */
  dropBounce: 0.3,
  /** How far a switched-off model's colours go toward --faint (its accent goes all the way). To tune at Task 12. */
  unlitMix: 0.75,

  // Poke (Task 14)
  /** A model with a `poke_refuse` clip refuses the `count`th poke within `seconds` of wall
   *  time (the visitor's rhythm, not the animation clock), and its count starts over. The
   *  notary shakes its head at the third stamp in 1.5 s. To tune with the owner. */
  pokeRefuse: { count: 3, seconds: 1.5 },

  // Camera (Task 9)
  /** Flight duration: clamp(min + perUnit × distance, min, max), eased in-out cubic. The
   *  distance is the route's length along the links (Task 12, motion audit #5: it was the
   *  camera's whole path, so nearly every flight hit max). */
  flight: { min: 0.9, perUnit: 0.06, max: 1.8 },
  /** Seconds for a dive: a flight with no link to follow (the overview to a station and
   *  back), a geometric zoom. Task 12 (motion audit #5): those hit flight.max before. */
  flightDive: 1.2,
  /** How high above the link curve the camera flies. Task 12 (motion audit #1): was 1.5;
   *  with flightLookAhead the ride looks about 29° down, near the station's 23°. It was 2.2
   *  over links that left the floor; the masts raised every link linkMast, so flightLift +
   *  linkMast stays 2.2 (1.928 over the 0.272 masts) and keeps the camera as high over the
   *  link's ends as it was. */
  flightLift: 1.928,
  /** The camera's own arc over each link, on top of flightLift: it flies flightArc·4f(1−f)
   *  over the straight line between the link's ends (f its share of the link), whatever the
   *  line does between them (director.ts, Route.rise). The links had that arc, a quadratic
   *  0.45 over their ends, until they ran level at their masts with a top only 0.1 over them
   *  (2026-10-20); this keeps the flights as they were, 2.65 over the floor mid-link and the
   *  ride's pitch with it, while the gondola rides the lower line. */
  flightArc: 0.45,
  /** Pointer drift in overview and station, in degrees either way. */
  driftYawDeg: 2.5,
  driftPitchDeg: 1.5,
  /** Map rotation: a drag on the empty floor turns the view about its framing's target, left and
   *  right only. In the overview it turns all the way round (the owner, 2026-10-21),
   *  `overviewWidthDeg` for a drag across the visible width, about the network's middle (fit.ts),
   *  every model's box kept `gutterPx` CSS px inside the visible area (the phone's bottom-sheet
   *  layout, then the side panel's), eased in over the first `gutterDeg`. At a station it stops at
   *  stationDeg either way, slowing over the last 20% (with motion reduced, a hard stop there), a
   *  drag across `span` of the visible width turning that whole range, end to end. `[` `]` turn
   *  keyDeg a press. It stays where it's left until the next travel: the flight leaves from the
   *  turned view, which swings back to the composed one over the first `unturn` of its time, more
   *  for a wide turn: `unturnHalf` of it for a half turn (director.ts, unturnShare, unturnPose),
   *  and lands unturned. A dive from an overview turned past 20° takes longer, up to `diveLonger`
   *  more for a half turn (diveDuration), so it never pitches more than 4° a frame. Zoomed in or
   *  panned, the overview turns about the centre of the view at the same distance instead (the
   *  owner, 2026-10-22): wholly once zoomed in to `aboutZoom` (the phones' 1.25x start) or panned
   *  `aboutPan` world units off the framing's target, smoothly between, so the composed overview
   *  turns exactly as before (director.ts, turnPivotShare). */
  turn: { overviewWidthDeg: 180, stationDeg: 15, span: 0.5, keyDeg: 5, unturn: 0.3, unturnHalf: 1, diveLonger: 0.35, gutterPx: [4, 16], gutterDeg: 14, aboutZoom: 0.8, aboutPan: 2 },
  /** Zoom (the owner's test notes): the overview only, by wheel, pinch or `+` `-`. The
   *  camera's distance as a share of the fitted overview's, from 1 (as composed) in to `min`
   *  (a quarter, 4x; it was a half until the owner asked for more, 2026-10-22); `wheel` per CSS
   *  px of wheel travel (a mouse's notch, about 100 px, is about 16%: about 8 notches to the end),
   *  `key` a press (about 18%: 7 presses), eased in over `ease` seconds (a time constant: about
   *  95% there in 3×). Travel resets it (src/input/zoom.ts, director.ts). The closer start
   *  (homeView) is never closer than `home`, the phones' 1.25x (polish-2): a wider portrait view,
   *  a tablet's, filled to its width with the inner ring at 2x and more, crops the rest of the
   *  network. */
  zoom: { min: 0.25, home: 0.8, wheel: 0.0017, key: 0.82, ease: 0.07, phoneEase: 0.9 },
  /** Moving the map (decided 2026-10-22 morning): in the overview a drag on
   *  the empty floor (one finger, the left button) pans it, the floor point grabbed kept under the
   *  pointer, the view's centre kept within `margin` world units of the network's convex hull at
   *  any zoom and turn (fit.ts, clampToHull). Let go, it glides on: the drag's speed over its last
   *  `window` seconds, at most `maxSpeed` of the camera's distance a second, decaying with the time
   *  constant `glide` (so it goes on speed × glide in all: a short, damped coast), stopped below
   *  `stop` of the distance a second; none with motion reduced. Two fingers turn it once they've
   *  twisted `twistDeg` from where they landed, then 1:1 with the twist. On a phone the overview
   *  starts closer, centred on the hub, the inner ring of stations (inside rangeRings[1]) just
   *  filling the width (director.ts, homeView: about 1.3x at 390 px), eased there over
   *  zoom.phoneEase seconds after the arrival plays out (a skip goes straight there); travel back
   *  to the overview lands on it. */
  pan: { margin: 1.5, glide: 0.16, window: 0.08, maxSpeed: 1.6, stop: 0.02, twistDeg: 8 },
  /** Seconds after a key, click or wheel skips the arrival that the wheel doesn't zoom: a trackpad's scroll coasts on past the one that skipped. */
  wheelAfterSkip: 0.4,
  /** Room kept around what fit.ts frames, in world units. To tune at Task 12. */
  fitMargin: 0.6,
  /** CSS px a station keeps free to the right of its model for the label: labels.ts's 6px
   *  gap, the 4px padding either side, and the longest name ("candygoogy-bot", about 110px at
   *  --fs-sm medium) with a little room to the edge. To tune at Task 12. */
  stationLabelPx: 140,
  /** Room kept around a station's model, in world units: less than the overview's fitMargin,
   *  since a station is where a model is seen up close. To tune at Task 12. */
  stationMargin: 0.25,
  /** The station framing's smallest fit scale: never closer than Blender's cam_station, the
   *  overview's rule too. A closer station is recomposed in world.blend (code may fit, never
   *  re-author).
   *  Task 12 (motion audit #3): desktop stations were at s 0.61–0.64. */
  stationMinScale: 1,
  /** On the side-panel layout (panelMinViewportPx and up) a station may come closer than
   *  cam_station after all, until its model and the docked capsule fill about this share of
   *  the visible map's height (fit.ts stationCamera). The bottom-sheet layout keeps
   *  stationMinScale. Owner, 2026-10-19: desktop models read too small at s 1. */
  stationFill: 0.5,
  /** The closest that rule may bring a station: s never below this, whatever stationFill
   *  asks, so a small model doesn't put the camera in its face. */
  stationSideMinScale: 0.5,
  /** The receipt (Task 16): what its framing keeps in view, in Fettle's own space: the strip
   *  fed fully out of the slot (fettle.py: 0.38 wide, about 1.3 over the cover's 0.45 top),
   *  its curl, and the cover's top under it; a shorter receipt lowers the top (the director's
   *  receiptHeight, over min[1]). The fit's margin round it is receiptMargin. */
  receiptBox: { min: [-0.21, 0.36, -0.14], max: [0.21, 1.8, 0.1] },
  receiptMargin: 0.06,
  /** How fast a link draws outward during the arrival, in world units per second: the speed
   *  the links drew at in the Blender playblast, so each starts at reach − length / speed. */
  linkDrawSpeed: 8.5,
  /** The same for a cluster's links (world.py's SUB_LINK_SPEED): the homelab's tree, router →
   *  switch → AP → laptop, draws out three levels deep after homelab's link lands at 1.74 s, and
   *  at this speed its last link still lands by 2.2 s with every other reach time as before the
   *  tree (2026-10-21; at linkDrawSpeed every node would land 0.27 s earlier). */
  subLinkDrawSpeed: 14.5,
  /** Shares of a flight spent joining the lifted link from where the camera was, and leaving
   *  it for the station framing (smoothstep blends); between them it rides the link. */
  flightOnto: 0.4,
  flightOff: 0.45,
  /** How far along the link, ahead of its own progress, the flight camera looks: a point on
   *  the link itself, so below the camera (past the route's end, on along its end tangent).
   *  With the camera 2.2 over the floor-level line (flightLift + linkMast) it looks about 29° down, so the frame reaches 2–9 units ahead and
   *  the destination comes into view mid-flight; the visitor's capsule (visitorLead ahead)
   *  sits about 36° down, still in view. Task 12 (motion audit #1): was 1.8 (40°, 70° at
   *  the route's end, mostly floor). */
  flightLookAhead: 4,
  /** Round a sharp corner at a hub, the ride looks along the way's own heading averaged over
   *  the stretch ahead (director.ts, Route.cornerLook) instead of at the point flightLookAhead
   *  on, which swung across the corner in a few frames where the way doubles back between
   *  neighbouring links. The stretch is long enough that the corner's turn spread over it is
   *  at most `degPerUnit` degrees a unit; how much of that look it takes rises from 0 at a
   *  corner turning `from` degrees to all of it at `to`, eased in and out over `ease` units.
   *  Phase 2 (yaw tuning): exit → idiff turned 61.7° in a frame (71.6 on a phone). Applied
   *  everywhere, the averaged look turned flights away from where they go (yaw-rate patch). */
  flightCornerLook: { degPerUnit: 30, from: 120, to: 160, ease: 2 },
  /** A ride's way is smoothed over this many world units either side (a tent filter), so
   *  where the camera turns from a station's framing onto the link, or rounds the hub
   *  between neighbours, it curves rather than corners at full speed. Task 12 (motion audit
   *  #2A: with one ease the camera keeps its speed through those turns). */
  flightSmoothing: 1,
  /** A ride's way is measured in world units, and every radian the camera turns counts as
   *  this many more, so one ease along it slows the camera only where it has to turn round
   *  (leaving a station framed against the link's way) instead of whipping round at full
   *  speed. Task 12 (motion audit #2A). Phase 2 (yaw): was 2. Once each flight's view
   *  turns the shorter way round (director.ts, followBranches), idiff → colophon on a phone
   *  no longer spins at the hub, and that spin was what had slowed it through the hairpin
   *  there: at 2 it jolted 0.52 (the every-pair test allows 0.45), at 2.75 0.42. The worst
   *  yaw rate goes from 90° to 79° a frame (exit → idiff, phone). */
  flightTurnUnits: 2.75,
  /** How far either side of a turn, in world units, it's spread over in that measure: the
   *  camera starts slowing this far before a hairpin at the hub and is back up to speed
   *  this far after it. Task 12 (motion audit #2A). */
  flightTurnSpread: 2,
  /** How far a flight keeps from the models: beyond each footprint on the floor, and above
   *  the origin's model where it rounds the hub. To tune at Task 12. */
  flightClearance: 1.5,
  /** Between two stations a flight goes via the hub, and the ride alone (flightLift over a
   *  link that meets the floor there) passed about 2 above the origin's model, which then
   *  swept through the frame up close. So the camera keeps at least this far above that
   *  model's top while within its clearance radius: a soft floor, eased in from the route's
   *  start and out to its end, that only raises a camera below it (a phone's station framing
   *  is already higher), its view raised with it so the ride's pitch holds. 3.5 keeps the hub
   *  about as far off as a station keeps its model wherever it shows in frame. Flights to or
   *  from the origin or the overview don't pass over it. Phase 2 (hub lift). */
  flightHubClearance: 3.5,
  /** The steepest a flight looks down, in degrees: a soft cap (director.ts, capPitch) that
   *  leaves the pitch alone up to 12° under it and eases it towards it above (tanh: no
   *  kink), so the view never tips to straight down. Where a flight blends into a station
   *  framing steeper than this, the cap rises with the blend, so that framing is still left
   *  and reached exactly. Phase 2 (pitch cap): about 30 station-to-station pairs peaked at
   *  60–89°, turning round through the floor from a station onto its link; the look now
   *  blends as a yaw and a pitch (aimFrom), which peaks at 49° (desktop, into notary), so
   *  today the cap is a backstop for steeper station cameras to come. */
  flightPitchCap: 60,
  /** The pointer drift's spring (mass 1): critically damped, so it eases and never overshoots. */
  driftSpring: { k: 25, c: 10 },

  // Labels (Task 10)
  /** How long a label takes to fade out and in as it crosses an edge (the canvas, the
   *  panel, the header) in flight. Task 12 (motion audit #11): it blinked. */
  labelFadeMs: 120,
  /** A label's status line: its fade, and the crossfade when its text changes
   *  ("Checking…" → "Working"). Task 12 (motion audit #14). */
  statusFadeMs: 150,
  /** The arrival starts once the origin's model is in and either every model is or this many
   *  seconds have passed since (the owner's model budgets): a fast line has them all and it plays
   *  as ever; on a slow one the rest come in as it plays, each rising as it's in. */
  arrivalLoadWait: 0.4,
  /** A model in while the arrival plays joins its framing (the labels' room round it) over this
   *  many seconds, smoothstepped, rather than in one frame. */
  arrivalJoin: 0.5,
  /** At the arrival's end the pinned statuses let go one by one, in station order, this far
   *  apart. Decorative: it never holds up input. Task 12 (motion audit #14). */
  statusStaggerMs: 40,

  // Panel (Task 10)
  /** The station swap: the old panel fades out, then the new one fades in and rises. */
  panelOutMs: 140,
  panelInMs: 220,
  panelRisePx: 8,
  panelEase: 'cubic-bezier(.2,.8,.2,1)',

  // The visitor's signal (Task 11)
  /** The gondola's pin (on the line) over its cabin's lowest point: visitor.py's DROP, the
   *  model's root extras `drop`. visitor.ts reads the model's own value; this copy lets the
   *  station fit find the dock before the model loads (glb.test checks the two agree). */
  visitorDrop: 0.255,
  /** Docked, the belly hangs this far over the floor: the dock is where the line is
   *  visitorDrop + this high (visitor.py's FLOOR_GAP, which its baked shadow is sized for). */
  visitorDockGap: 0.015,
  /** Share of a flight it spends leading the camera, before pulling ahead to dock. */
  visitorBreakaway: 0.7,
  /** How far along the link it stays ahead of the camera's own progress. Task 12 (motion
   *  audit #1): was 1.2, which the farther look-ahead would leave below the frame. */
  visitorLead: 3,
  /** Where it docks at a station: at least this far from the node's centre along its link,
   *  clear of the model (0.65 grazed the box), and farther out only where the line is still
   *  too low for the hanging cabin (under visitorDrop + visitorDockGap). On the links as
   *  authored, level at linkMast this far from each end, it's this everywhere (the belly
   *  hangs about visitorDockGap over the floor; it was 1.07 to 1.69 out when the links left
   *  the floor, and 0.18 to 0.25 high on the masts' rising arcs). Beside the origin it parks
   *  by the same rule, from the hub end. */
  visitorDock: 0.75,
  /** Whether the turnaround ring (links.ts) is drawn. It isn't: round homelab and the origin it
   *  read as a second ground ring (the owner's test notes). The gondola still rides it.
   *  Drawing it only while the gondola rounds it was tried and rejected (it's on a ring 1 to 12
   *  frames a hop, so the ring only blinked). */
  turnaroundDrawn: false as boolean,
  /** Share of a flight it takes to leave its dock (from rest) and reach its lead, at least;
   *  longer if that would mean averaging more than visitorLaunchSpeed units a second. */
  visitorLaunch: 0.2,
  visitorLaunchSpeed: 10,
  /** Flight speed-up while the pointer or Shift is held. */
  boost: 1.8,
  /** A pointer press counts as a boost after this long without a drag's movement. */
  boostHoldMs: 150,
  /** Time constant of the boost easing in and out (the flight's clock, the gondola's lean
   *  and its trail together): an ease-out, about 95% there in 3×. */
  boostEase: 0.06,
  /** The boost's trail behind the gondola at full boost, in world units, and its width in CSS px. */
  visitorTrail: 1.4,
  visitorTrailPx: 3,

  // Shading (Global Constraints → Shading)
  /** How far a role's dark end leans toward --shadow. The same value as
   *  DEFAULT_SHADE_STRENGTH in src/shading.ts and SHADE_STRENGTH in the Blender preview script
   *  (not in this repo), so the browser and the renders agree; change all three together. */
  shadeStrength: 0.6,
} as const;
