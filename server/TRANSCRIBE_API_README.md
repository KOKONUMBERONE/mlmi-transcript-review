# Transcribe API

ASR transcription service for the reviewer UI. Runs 4 ASR models on an audio file and returns a transcript in the schema format expected by the frontend.

## Setup

I assume you have a python venv activated to install the requirements.txt.

```bash
cd server
pip install -r requirements.txt
uvicorn transcribe_api:app --port 8001
```

Wait for `All models loaded. Ready.` before sending requests (~2-3 min on first start).

## Endpoints

### `GET /health`
Check that all 4 models are loaded and the service is ready.

### `POST /transcribe`
Upload an audio file, get back a transcript JSON.

**Request:** multipart form with an `audio` field (`.wav`, `.mp3`, `.m4a`, `.ogg`, `.flac`)

**Response:** transcript JSON in the existing schema shape — same as the mock transcript, with `whisper-large`, `parakeet`, `wav2vec2`, and `qwen3asr` as model keys.

**curl:**
```bash
curl -X POST http://localhost:8001/transcribe \
  -F "audio=@interview.wav"
```
For example, I used this from the server directory (there's a sample audio file in the directory: `spontaneous-speech-sco-30994.mp3` ). You can test the API in your terminal with this, before connecting to the UI.
```bash
curl -X POST http://localhost:8001/transcribe \
  -F "audio=@spontaneous-speech-sco-30994.mp3" \
  -o outputs/output.json
```
**JavaScript:**
```js
const form = new FormData()
form.append('audio', audioFile)
const res = await fetch('http://localhost:8001/transcribe', {
  method: 'POST', body: form
})
const transcript = await res.json()
```

## Notes

- Processing time: ~2 min per 50s of audio on CPU
- `risk` fields are placeholders (`"low"` for all words) — real cross-model uncertainty scores come in Stage 2
- `alternatives` fields are empty — Stage 2 will populate these from cross-model word alignment
- `speaker` is `"Speaker"` for all segments — diarization not implemented
- Runs on `localhost:8001` to avoid conflict with the importance classifier on `localhost:8000`
- `paraRisk` is computed as the highest `risk` value across all words in the segment — currently `"low"` everywhere since word-level risk is not yet populated