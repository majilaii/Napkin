# Teach-flow footage

The onboarding walkthrough (`components/import-education/TeachShareSheetDemo.tsx`)
plays the five clips in this folder full-bleed and draws the coaching layer on
top. These are REAL clips, cut from a single-take screen recording (July 15
2026, iPhone Pro Max, `ScreenRecording_07-15-2026 10-49-23_1.mov`) of the actual
flow: TikTok video -> Share -> TikTok drawer More -> iOS share sheet More ->
Apps list Napkin -> share-extension "add for review".

## Privacy blur (do not skip on a re-record)

Two bands showed real contacts and ship with a heavy gaussian blur baked in:

- `teach-2-tiktok-more.mp4`: TikTok drawer recipients row, source-frame band
  y 1795-2095, full width
- `teach-3-ios-more.mp4`: iOS share sheet AirDrop row, source-frame band
  x 40-1228, y 1620-1965

Clips 4 and 5 start after their entry transitions specifically so the AirDrop
row is never on screen outside the blurred clip. If you re-cut, re-check every
frame that precedes a transition: the Apps list dismissal at ~13.9s briefly
re-shows the share sheet contacts.

## Production commands used

Cut list (source timestamps):

| clip | in | duration | ends frozen on |
| --- | --- | --- | --- |
| `teach-1-share.mp4` | 2.00 | 3.85s | video, share arrow crisp |
| `teach-2-tiktok-more.mp4` | 6.15 | 1.55s | drawer settled, More at row end |
| `teach-3-ios-more.mp4` | 8.65 | 2.65s | sheet settled, app-row More visible |
| `teach-4-apps-napkin.mp4` | 11.75 | 1.95s | Apps list, Napkin top of Suggestions |
| `teach-5-add-review.mp4` | 14.65 | 1.65s | extension card, add for review |

Every clip: crop the 110px status bar, halve resolution, H.264:

```bash
ffmpeg -ss <in> -i master.mov -t <dur> \
  -vf "crop=1290:2686:0:110,scale=646:1344" \
  -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart -an out.mp4
```

Blurred clips insert this before the crop (band coords above):

```bash
-filter_complex "[0:v]split[a][b];[b]crop=<w>:<h>:<x>:<y>,gblur=sigma=28:steps=2[blur];[a][blur]overlay=<x>:<y>,crop=1290:2686:0:110,scale=646:1344[out]" -map "[out]"
```

Stills are the exact final frame: `ffmpeg -sseof -0.05 -i clip.mp4 -frames:v 1 clip-still.png`

## Measuring targets

Open the `-still.png`, find the tap target center, normalize by the still's
646x1344: `x = px_x / 646`, `y = px_y / 1344`, circle `r = radius_px / 646`.
Rect targets (`napkin` row, `addForReview` button) use centered `w`/`h`. Values
live in `TEACH_FOOTAGE` in `components/import-education/teachFootage.ts`, along
with `durationMs` (stall watchdog only) and per-beat `videoWidth`/`videoHeight`
(update if you export at a different resolution - all overlay math reads the
manifest).

## Verify after any swap

- `npm test` (state machine + geometry are unit-tested; jest never loads assets)
- Run the app, Settings -> Import tutorial: each freeze should spotlight the
  real control; check the two blur bands actually cover every name and face
- Toggle Reduce Motion: stills + instant captions, same tap gates
