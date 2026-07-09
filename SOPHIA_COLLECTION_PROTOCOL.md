# Sophia — Session Collection Protocol (v2)

**Goal:** collect clean, *comparable* sessions so the data can honestly answer:
1. **Personal north star** — what does *my* coherent state look like (my EEG-when-resonant signature, my personal baseline)?
2. **The tones hypothesis** — do the neuro-adaptive tones reach cardiovascular resonance (~0.1 Hz HRV) **faster / deeper than without them**?
3. **The 432 player** — does the Aetheria 432Hz player help, and do the two **work better together**?
*All three are hypotheses until the held-out data proves them.*

The measures are already logged per window (v66): **onset latency** (time to first sustained resonance) and **resonance fraction** (how much of the session you held it).

---

## The design: a 2×2 factorial (two independent switches)

Two things you turn on/off independently — **Sophia's adaptive tones** and the **Aetheria 432Hz player** (aetheria432.com / YouTube). That gives four cells:

| | Tones OFF | Tones ON |
|---|---|---|
| **Player OFF** | ① **silent** (control) | ② **tones only** |
| **Player ON**  | ③ **432 only** | ④ **both** |

This is what lets the data separate: the tones' own effect, the 432 player's own effect, and whether **they combine**.

**Interleave across the cells** — don't do all of one cell then all of another (that confounds condition with practice + time of day). Rotate, e.g. `① ② ④ ③ ② ① ④ ③ …`, kept roughly balanced.

**Cost, honestly:** four cells ≈ **double the collecting**. Aim for **≥4 clean sessions per cell (~16+ total)** before a full factorial read. You *can* start collecting now and I'll report whatever cells have enough — but the interaction ("better together") needs all four cells populated. If that's too much, tell me your top-priority question and we'll collect a reduced set first.

---

## Per-session checklist

**Setup**
- [ ] Hard-refresh once ever so the **v66** service worker is active.
- [ ] Muse S Athena on, good contact on all sensors.
- [ ] **Polar H10 connected and streaming the whole session** — mandatory. HRV is the anchor; no H10 = unusable for the tests. Confirm "Signal check: passed."
- [ ] Capture a **Rest Baseline** first (🧘 button, 60 s) — **with both tones AND the 432 player OFF**, so it's a true silent reference. Keep the `.csv` **and** the `.msv.json`.

**The session — set this cell's two switches**
- [ ] **Adaptive tones:** ON or OFF per the cell.
- [ ] **432 player:** ON or OFF per the cell. If ON, use the **same track/playlist and the same volume** every time, and note the track — otherwise the player condition isn't comparable. Keep the tones audible over the music in cell ④.
- [ ] **Duration ≥ ~15 min** (min ~10). The first ~2 min never count — HRV needs ≥2 min for a valid resonance estimate — so longer sits give far more usable windows.
- [ ] **Awake and alert**, eyes open, still, consistent posture. (Falling asleep swamps everything and gets the session auto-excluded.)
- [ ] **Breathe freely — do NOT deliberately slow-breathe.** Slow breathing alone drives 0.1 Hz resonance; free breathing keeps the test about the audio. Same breathing in every cell.

**After**
- [ ] Export the session (keep both the **JSON** — MSV + per-window ratios + HRV — and the CSV).
- [ ] Add one line to the collection log (below).

---

## Collection log — one line per session

Keep a file `collection-log.csv` next to the exports. The condition isn't in the export filename, so **this log is how the harness knows which cell a session belongs to.** Two switch columns = factorial-native (the harness can group by either factor).

```
date,time,session_timestamp,tones,player,player_track,breathing,sleep_hrs,caffeine,notes
2026-07-10,09:15,2026-07-10T09-15-22,off,off,,free,7,N,silent control, calm
2026-07-10,14:40,2026-07-10T14-40-03,on,off,,free,7,Y,tones only
2026-07-11,09:05,2026-07-11T09-05-11,off,on,alignment-playlist-1,free,6,N,432 only
2026-07-11,15:20,2026-07-11T15-20-44,on,on,alignment-playlist-1,free,6,N,both together
```

- `session_timestamp` = the stamp in the exported filename (pairs the row to the file).
- `tones` / `player` = on / off (the two factors).
- `player_track` = which 432 playlist/track (blank when player off) — keep it the **same** across player-on sessions.
- Log the honest context: sleep, caffeine, how the day/TBI felt, interruptions.

---

## What counts as a "clean" (usable) session
- Polar connected throughout, signal check passed.
- Awake / not sleep-like (the harness auto-flags δ-rise + HR-drop and excludes them).
- ≥ ~10 min so valid (≥2 min) HRV windows exist.
- Minimal movement/artifact.

## The don't-fool-ourselves rules
- **Keep every session** — good and bad. The harness excludes confounded ones *transparently*; you don't pre-filter.
- **Treat the cells the same** — same posture, breathing, time-of-day spread, and (for player-on) same track + volume.
- **Never slow-breathe on the audio cells but not the silent one** — that manufactures an effect out of breathing.
- **Nothing is "proven"** until it survives the held-out train/test split. One good-looking session is not evidence.

---

## When you have ≥4 clean per cell
Run: `node tools/calibration-harness.mjs --dir <your session folder>`

It reports your personal-baseline ratios and your **HRV-supervised EEG signature** (validated: peak 0.075–0.12 Hz over ≥120 beats). Once the factorial comparison is wired in, it'll also report — held-out — each cell's **onset latency** and **resonance fraction**, the tones main effect, the 432 main effect, and whether they **work better together**.
