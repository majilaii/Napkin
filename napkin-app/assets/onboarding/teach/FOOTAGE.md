# Teach-flow footage

The onboarding walkthrough (`components/import-education/TeachShareSheetDemo.tsx`)
plays the four clips in this folder full-bleed and draws the coaching layer on
top. What ships right now is **generated placeholder footage**: dark frames with
the step label and a white marker drawn exactly where each spotlight expects its
target. Swap in the real recording file-for-file and the system lights up.

## 1. Record once

On an iPhone (the Pro Max 1290x2796 screen is what the numbers below assume):

- Do Not Disturb on, decent battery, no red recording pill surprises you can avoid
- Open TikTok on a food video worth saving (the tableforlater crudo one fits the brand)
- Start a screen recording, then, slowly and cleanly:
  1. Let the video play 2-3 seconds
  2. Tap **Share** (arrow on the right rail)
  3. Wait for TikTok's drawer to settle, tap **More**
  4. Wait for the iOS share sheet to settle, tap **More** at the end of the app row
  5. On the Apps list, scroll until **Napkin** is visible, pause a beat
  6. Tap Napkin, let the share extension confirm, stop recording
- AirDrop devices and suggested contacts WILL appear in the sheet. Rodeo shipped
  theirs with a colleague's contacts visible. If that bothers you, rename devices
  or do the recording after toggling AirDrop receiving off.

## 2. Cut into four clips

Each clip starts at the tap that begins its transition and ends when the UI has
settled on the decision frame (the frame the tutorial freezes on). Keep 0.3s of
steady hold at the end. Target 1.5-4s per clip.

| file | starts | ends frozen on |
| --- | --- | --- |
| `teach-1-share.mp4` | video playing | share arrow visible, pre-tap |
| `teach-2-tiktok-more.mp4` | Share tapped, drawer slides up | drawer settled, More visible |
| `teach-3-ios-more.mp4` | More tapped, iOS sheet rises | sheet settled, app-row More visible |
| `teach-4-apps-napkin.mp4` | More tapped, Apps list opens | list settled, Napkin row visible |

## 3. Crop, scale, encode

Crop the top 110px so the baked-in status bar doesn't clash with the live one
(this is how you spot other apps doing it: Rodeo didn't crop and you can see the
maker's 1:29 status bar). From a 1290x2796 master:

```bash
for clip in teach-1-share teach-2-tiktok-more teach-3-ios-more teach-4-apps-napkin; do
  ffmpeg -i "master-cuts/$clip-raw.mov" \
    -vf "crop=1290:2686:0:110,scale=646:1344" \
    -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart -an \
    "$clip.mp4"
  ffmpeg -sseof -0.05 -i "$clip.mp4" -frames:v 1 -y "$clip-still.png"
done
```

H.264 for simulator + device compatibility. HEVC (`-c:v libx265 -tag:v hvc1`)
saves ~40% if the bundle ever needs it. Expect 0.5-1.5MB per clip at these
settings; the four placeholders total ~160KB so anything under ~6MB total is
budget-neutral versus the old 2.1MB static PNG.

## 4. Measure the targets

Open each `-still.png`, find the center of the tap target, and normalize:

- `x = center_px_x / 646`, `y = center_px_y / 1344`
- circle `r = radius_px / 646` (cover the whole control plus a few px)
- rect targets (`napkin` row): `w`/`h` are the row size normalized the same way

Paste the values into `TEACH_FOOTAGE` in
`components/import-education/teachFootage.ts` (`shape`, and `magnifier.focus*`
for the iOS More beat - `focusW` is the normalized width of the strip you want
enlarged). Update `durationMs` to each clip's real length (drives the stall
watchdog only). If you export at a different resolution, update
`videoWidth`/`videoHeight` per beat; all overlay math reads from the manifest.

## 5. Verify

- `npm test` still green (geometry is unit-tested; the manifest is not loaded by jest)
- Run the app, Settings -> Import tutorial: each freeze should spotlight the real
  control, and the placeholder markers are gone
- Toggle Reduce Motion in iOS settings: stills + instant captions, same tap gates
