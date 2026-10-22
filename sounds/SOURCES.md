# The map's sounds: where each one comes from

They came with the map's secrets, approved by the owner 2026-10-20. Off by default: the header's
"Sound" toggle switches them on. No sound packs and no downloaded libraries.

**Every sound is made in code** (the owner, 2026-10-21: nothing will be recorded). Each is
synthesised at runtime with Web Audio in `src/moments/sound-synth.ts`, shaped on how the real
thing sounds: filtered noise bursts, short swept tones, modal resonators (a few decaying sines:
a door, a plastic stop, a steel wire), granular crackle (paper, a tear's teeth, a bead chain)
and band-passed noise sweeps (air, friction, fans). Nothing is downloaded for them: they come
with the sound engine, a lazy chunk fetched only once sound is on.

The cues (which sound at which frame of which clip) are `CUES` in `src/moments/sound.ts`; the
levels `TRIM_DB` in `sound-synth.ts`. Frames are the clips' own, as authored in each model's
Blender source (not in this repo) and shipped in its GLB, at 24 fps.

(The recordings' path, `sounds/recorded/` and `scripts/sound-sprite.mjs`, stays in the code,
unused: with no sprite, nothing is fetched.)

| Name | Kind | What it imitates | Where it fires (node, clip, frame) |
|---|---|---|---|
| `clack` | made | a hard plastic cover hitting its stop | origin `poke_power`: the cover up (4), back down (10) |
| `snap` | made | a toggle switch snapping over its spring | origin `poke_power`: the toggle down (7) |
| `relay` | made | a relay dropping out or pulling in | origin `off`; origin `on` (quieter) |
| `humDown` | made | a room of powered things, mains hum dying away | origin `off`: one hum for the whole network (1.5 s) |
| `humUp` | made | the same hum coming back | origin `on`: the reboot (2.6 s) |
| `beep` | made | a PC speaker's POST beep | the power moment's end, as the last link is in |
| `dock` | made | a small metal grip closing on a line | the gondola's `dock` (8) |
| `stamp` | made | a rubber stamp on paper over a felt pad: a dull thud, the paper's slap, the rubber peeling off | notary `poke`: the strike (11) |
| `tap` | made | a knuckle's dry knock on wood | notary `poke_refuse` (11, 19); siel-eolie `poke`: the lockout's jolt (15); candygoogy-bot's plane back on its pin (`poke` 19, `arrive` 60, the trip's end) |
| `thump` | made | something soft set down | notary `poke` (28), `poke_refuse` (29); fettle `poke`: its landing (11); desktop `poke`: the tower landing (10); colophon `poke`: the board shut (44) |
| `breaker` | made | a DIN-rail breaker toggled: its spring's click, then the handle's clack on its stop | siel-eolie `poke`: each toggle back up (6, 8 … 18, 22); `poke_test`: the tripped ones dropping (7–12); the reset (power moment, 2, 12 … 22) |
| `rcd` | made | an RCD tripping on its test button: a sharper crack and a heavier thunk than a breaker, the panel door rattling | siel-eolie `poke_test`: the trip (5) |
| `click` | made | a small push button | fettle `poke`: the feed key (2); siel-eolie `poke_test`: the T button (2); colophon `poke_lamp`: the chain's switch (3); candygoogy-bot: the launcher's kick (`poke_stand` 6, `arrive` 6) |
| `feed` | made | a thermal receipt printer feeding: its stepper's buzz, the gears, the paper | fettle `poke` (11–14); `arrive`: the back-feed (0–6), three feeds (13, 21, 29); `trip`: the back-feed and the bursts (12, 17, 22, 27); `tear`: the fresh stub (18–21) |
| `slide` | made | a plastic stacking tray sliding on its runners onto its stop | idiff `poke`: the trays apart (0, 1) and home (8, 9) |
| `flick` | made | a card flicked off its bundle | idiff `poke_card` (3); `poke_card_tidy`: off the floor (0) |
| `pat` | made | a card or sheet landing flat | idiff `poke_card`: on the floor (13); `poke_card_tidy`: back on the bundle (11); switch `poke_cable`: the cable on the floor (13); the paper plane on the server's lid |
| `whoosh` | made | a paper plane through the air | candygoogy-bot `poke`: the barrel roll (4–17); `arrive`: the launch (6) and the loop's flare (36); secret 3's flight: off the launcher, and off the server's lid |
| `postcard` | made | a postcard knocking against a wire rack | eolietech `poke`: out of the pocket (0), back onto the wire (50, 52); `arrive` (0, 66, 68) |
| `fans` | made | a desktop's fans spun up hard and back to idle | desktop `poke` (0–30) |
| `plug` | made | an RJ45 plug's latch clicking out of its port, or home | switch `poke_cable`: unplugged (1); `poke_cable_tidy`: plugged back in (14) |
| `key` | made | a mechanical keycap bottoming out | experiments `poke_keyboard` (3, 9): no poke of the homelab cluster presses a key |
| `riffle` | made | a book's leaf riffling | colophon `poke`: three leaves (12, 15, 18) |
| `chain` | made | a ball chain springing back and swinging | colophon `poke_lamp` (4) |
| `knock` | made | a knuckle on a wooden door, heard from the other side | exit `poke`: three knocks (3, 8, 13) |
| `latch` | made | a door's latch bolt drawn and snapping back | exit `poke`: the knob tried (23), let go (30) |
| `tear` | made | a receipt torn off on a printer's serrated bar | fettle `tear` (0–3): the tear-off drag and "Keep the receipt" both play it |

**Silent by design:** traffic, the camera's flights, hover and labels; each node going off or on
(one hum for the whole network instead). Under reduced motion the clips' sounds play as their
clips are played (a poke plays on its frames; an arrival's sounds as it jumps to its end, as
before), and the plane's trip makes none: nothing flies.
