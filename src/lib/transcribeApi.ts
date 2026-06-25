import type { Transcript } from '../types'
import { PredictError } from './predictApi'

// Busola's ASR transcription service (separate from the importance classifier
// on :8000). Runs the 4 ASR models locally and returns a transcript already in
// the front-end schema shape — see server/TRANSCRIBE_API_README.md.
// 127.0.0.1 (not "localhost") so an IPv6 ::1 squatter can't intercept it.
const TRANSCRIBE_URL = 'http://127.0.0.1:8001/transcribe'

/**
 * Upload an audio file to the local ASR service and get back a transcript in
 * the front-end schema (validated by the caller before use). The service is
 * optional: if it isn't running, this throws a PredictError with an actionable
 * message and the caller keeps the audio loaded for playback. Transcription is
 * slow (the models run on CPU), so callers should show a progress indicator.
 */
export async function transcribeAudio(file: Blob): Promise<Transcript> {
  const form = new FormData()
  // Field name must be `audio` to match transcribe_api.py's UploadFile param.
  form.append('audio', file, file instanceof File ? file.name : 'audio')

  let res: Response
  try {
    res = await fetch(TRANSCRIBE_URL, { method: 'POST', body: form })
  } catch (e) {
    throw new PredictError(
      'Could not reach the transcription service at http://127.0.0.1:8001. ' +
        'Start it with:  uvicorn transcribe_api:app --port 8001  (run from server/)',
      e,
    )
  }

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.detail ?? ''
    } catch {
      /* ignore */
    }
    throw new PredictError(`Transcription failed (HTTP ${res.status}). ${detail}`)
  }

  return (await res.json()) as Transcript
}
