# MLMI Transcript Review

A local-first transcript-review research prototype for inspecting imperfect
speech recognition in high-stakes interviews. The interface combines
word-level risk marks, sentence-confidence tints, audio-linked editing, and a
locally run AI toolkit for evidence finding, outline generation, grounded
questions, conflict checking, and timeline extraction.

This repository is the reproducible software artifact for the dissertation
*AI Transcription for High-Stakes Settings*. It contains the review interface,
the local model service, and a bundled demonstration case. The study
recordings, their annotated transcripts, participant records and answer keys
are not included: the study modes are present as code, but you supply your own
material for them.

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
        |-- http://127.0.0.1:8000 ---> FastAPI model service
        |                                |-- MiniLM + importance classifier
        |                                `-- Ollama at http://127.0.0.1:11434
        |
        `-- http://127.0.0.1:8001 ---> FastAPI transcription service
                                         |-- WhisperX (align + diarise)
                                         |-- Qwen3-ASR / Parakeet
                                         `-- LLM selector -> merged transcript
```

Both services are optional to each other. The review interface needs only the
model service on :8000; the transcription service on :8001 turns audio into the
transcript JSON the interface reads, and can be skipped if you bring your own
transcripts.

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
Enable it once the transcription service is running on port 8001:

```bash
source .venv/bin/activate
pip install -r server/requirements-transcribe.txt
cd server && uvicorn transcribe_api:app --port 8001
```

It loads several speech models on first run and wants a lot of memory; set
`SKIP_QWEN3ASR=1` to leave the heaviest one out. `server/TRANSCRIBE_API_README.md`
covers the endpoints, and `server/transcribe_to_disk.py` runs the same pipeline
from the command line for long recordings. Transcript JSON import works without
any of this.

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
- `public/stimuli/` — where frozen transcripts, audio and panels are registered.
  Ships with the guided-demo panels only; see its README to add your own clips.
- `scripts/` — stimulus preparation, comparison, and local scoring utilities.

## Data and research use

The study recordings and their transcripts are not distributed with this
repository. Do not commit participant exports, contact details, answer keys,
local model caches, or environment files.
The existing `.gitignore` excludes the corresponding working directories.

## Citation

Citation metadata is provided in [`CITATION.cff`](CITATION.cff).

## License

Code is released under the MIT License. The bundled demonstration case is
synthetic. Any audio or transcripts you add under `public/stimuli/` retain
their own original status.
