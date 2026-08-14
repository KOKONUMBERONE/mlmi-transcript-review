# Stimuli

A registered clip is a transcript, an audio file, and optional frozen
local-model panels. Freezing the panels makes a clip load deterministically and
without model latency.

- `<id>.json` — transcript with word and sentence signals.
- `<id>.mp3` — matching audio.
- `<id>.timeline.json` — extracted events.
- `<id>.outline.json` — chapter outline.
- `<id>.anomalies.json` — potential conflicts.
- `<id>.triage.json` — sentence-importance results.

Register clips in `src/study/trials.ts` under `STIMULI`. An unregistered id
falls back to the bundled demonstration transcript.

No media is distributed here beyond the demonstration panels. Anything you add
is yours to license and attribute; the repository's MIT License covers code
only.
