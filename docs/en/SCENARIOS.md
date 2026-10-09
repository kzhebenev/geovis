# GeoVis camera flight scenarios

**[Русская версия](../ru/SCENARIOS.md)**

The same help is available on the site: the "Camera flight" block → the "?" button ("How to write a scenario").

## Quick, no JSON
Move the camera with the mouse (left button — pan, right button or Ctrl — tilt and rotate, wheel — zoom), pick a
dataset and a view → **"+ Keyframe"**. Repeat for the next views (each new keyframe comes 5 s later). ▶ — play.
To adjust timing or add captions: the ⤓ "Download scenario (JSON)" button → edit the JSON → ⤒ "Load scenario (JSON)".
Finished scenario → **"Video"** (MP4).

## Keyframe
| Field | Meaning |
|---|---|
| `t` | the second at which the camera arrives at the view (ascending) |
| `camera.longitude/latitude` | the point the camera **is looking at** (orbit — same point, `bearing` changes) |
| `camera.zoom` | 1 — the Earth, 2–3 — a continent/large country, 4–5 — a region, 6–7 — a city |
| `camera.pitch` | 0 — top-down, 45–65 — "fly-over", up to 85 — near the horizon |
| `camera.bearing` | 0 — north up, 90 — looking east |
| `easing` | how we fly **to** the keyframe: `inOutCubic` (default), `linear` (orbit), `inOutSine`, `outCubic` |
| `arc` | long flights (> 25°) follow an arc; `false` disables it |
| `settings` | scene change at the keyframe: `dataset`, `countryDataset`, `year`, `focus`, `mode`, `theme`, `projection`, `palette`, `scale`, `smooth`, `height`, `res`, `cityMinPop`, `cityLimit`, `numbers`, `showLegend`, `lang` |
| `caption` | caption `{"ru": "…", "en": "…"}`, fades in over 0.6 s; `null` removes it |
| `settings.seriesYear` | **smooth year** of a series (population 1975…2100): interpolated between keyframes, columns grow continuously |
| `settings.compareWith` | **difference**: the current dataset minus this one (`"pop1975"`, `"temp"`); `null` turns it off |

## Smooth growth and difference
```json
{"t": 0,  "camera": {...}, "settings": {"dataset": "pop1975", "seriesYear": 1975}},
{"t": 20, "camera": {...}, "settings": {"seriesYear": 2025}},
{"t": 35, "camera": {...}, "settings": {"seriesYear": 2100}, "caption": {"ru": "2100 — прогноз"}}
```
The year changes continuously, just like the camera. For "what changed" — `{"dataset": "pop2025", "compareWith": "pop1975"}`:
growth in red, decline in blue, height — the magnitude of the change.

## Tips
3–6 s per flight, 6–10 s per orbit; start with a wide shot, then "dive in". Pause for 1–2 s before switching datasets.
The frame at moment t is deterministic: what you see on the timeline is what ends up in the video.

## Template
```json
{ "title": {"ru": "Мой сценарий", "en": "My scenario"},
  "keyframes": [
    {"t": 0, "camera": {"longitude": 60, "latitude": 50, "zoom": 2.2, "pitch": 20, "bearing": 0},
     "settings": {"dataset": "pop1975", "focus": "world", "mode": "columns", "theme": "dark", "projection": "map", "scale": "sqrt"},
     "caption": {"ru": "Население, 1975", "en": "Population, 1975"}},
    {"t": 5, "camera": {"longitude": 37.62, "latitude": 55.75, "zoom": 4, "pitch": 55, "bearing": 20}, "easing": "inOutCubic", "caption": null},
    {"t": 8, "camera": {"longitude": 37.62, "latitude": 55.75, "zoom": 4, "pitch": 55, "bearing": 60}, "easing": "linear",
     "settings": {"dataset": "pop2025"}, "caption": {"ru": "2025", "en": "2025"}},
    {"t": 13, "camera": {"longitude": 37.62, "latitude": 55.75, "zoom": 4, "pitch": 55, "bearing": 160}, "easing": "linear"}
  ] }
```

## Video (MP4)
The "Video" button or the API: `POST /api/v1/videos {"scenario": {...}, "fps": 24|25|30, "quality": "720p"|"1080p"|"720p_v"|"1080p_v"}` →
`{id}`; progress — `GET /api/v1/videos/{id}` (`state`, `frame/frames`, `eta_s`); file — `GET /api/v1/videos/{id}.mp4`.
Up to 180 s; queue — one job in progress and up to three waiting (otherwise 429); files are kept for 7 days.
Rendering without a GPU: ~1 s per frame at 720p (30 s at 30 fps ≈ 15 min), 1080p takes roughly twice as long.
