# MLMI Transcript Review

A local-first transcript-review research prototype for inspecting imperfect
speech recognition in high-stakes interviews. The interface combines
word-level risk marks, sentence-confidence tints, audio-linked editing, and a
locally run AI toolkit for evidence finding, outline generation, grounded
questions, conflict checking, and timeline extraction.

This repository is the reproducible software artifact for the dissertation
*AI Transcription for High-Stakes Settings*. It contains the review interface,
the local model service, public-domain demonstration stimuli, and study modes.
Participant records and answer keys are not included.

## Highlights

- Word and sentence uncertainty views with reversible display controls.
- Audio-linked word correction and sentence rewriting.
- Local Ollama tools: Find, Assistant, Conflicts, Timeline, and Outline.
- Local MiniLM importance classification and semantic retrieval.
- Five interface variants plus police-feedback and participant-study flows.
- Browser-local behavioural event logging with JSON/CSV export.
- Transcript JSON import and an optional independent local ASR endpoint.

## Local architecture

```text
Browser (Vite + React)
        |
        | http://127.0.0.1:8000
        v
FastAPI model service
   |-- MiniLM + importance classifier
   `-- Ollama at http://127.0.0.1:11434
```

The default configuration is local-only. Transcript content and study events
remain on the machine. Study results are exported manually from the browser.

## Requirements

- Node.js 18 or newer
- Python 3.11 or newer
- [Ollama](https://ollama.com/)

## Run locally

Install and start the local language model:

```bash
ollama pull qwen2.5:7b-instruct
ollama serve
```

In another terminal, start the model service:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
cd server
uvicorn serve_model:app --host 127.0.0.1 --port 8000
```

Then start the interface from the repository root:

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open the local URL printed by Vite. The first semantic request may download the
MiniLM weights; inference then runs locally.

## Interface modes

Set `VITE_APP_MODE` in `.env.local`:

| Value | Entry point |
| --- | --- |
| omitted | Five-version launcher |
| `full` | Complete review workspace |
| `sentence` | Sentence-confidence interface |
| `study` | Study launcher and trial runner |

Audio-to-transcript processing is optional and disabled in `.env.example`.
Enable it only when an independent local service implementing the transcript
API is running on port 8001. Transcript JSON import works without that service.

## Verification

```bash
npx tsc --noEmit
npm run build
python3 -m compileall -q server
```

## Repository layout

- `src/core/ReviewWorkspace.tsx` — shared review workspace.
- `src/core/config.ts` — feature flags for every interface variant.
- `src/study/` — study trials, conditions, and questionnaires.
- `server/serve_model.py` — local FastAPI model service.
- `server/focus_llm.py` — Ollama-backed transcript retrieval.
- `public/stimuli/` — frozen demonstration transcripts, audio, and panels.
- `scripts/` — stimulus preparation, comparison, and local scoring utilities.

## Data and research use

The bundled stimuli are demonstration material. Do not commit participant
exports, contact details, answer keys, local model caches, or environment files.
The existing `.gitignore` excludes the corresponding working directories.

## Citation

Citation metadata is provided in [`CITATION.cff`](CITATION.cff).

## License

Code is released under the MIT License. Bundled audio and transcript stimuli
retain their original public-domain or source-specific status; see
`public/stimuli/` for the material used by the prototype.
