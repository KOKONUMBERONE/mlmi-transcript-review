# Frozen study stimuli

Each registered clip consists of a transcript, an audio file, and optional
frozen local-model panels. Frozen panels make study trials deterministic and
avoid model latency during a session.

- `<id>.json` — transcript with word and sentence signals.
- `<id>.mp3` — matching audio.
- `<id>.timeline.json` — extracted events.
- `<id>.outline.json` — chapter outline.
- `<id>.anomalies.json` — potential conflicts.
- `<id>.triage.json` — sentence-importance results.

Register clips in `src/study/trials.ts` under `STIMULI`. Unregistered ids fall
back to the bundled demonstration transcript.

The media files are research stimuli and are not relicensed by the repository's
MIT License. Verify the status and attribution requirements of any stimulus
before redistributing it or replacing it with other material.
