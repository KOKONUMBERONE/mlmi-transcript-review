import type { Transcript } from '../types'

// Where the local FastAPI service lives. Vite proxying is intentionally NOT
// used so the dev/prod behaviour is identical.
const PREDICT_URL = 'http://localhost:8000/predict'

export class PredictError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'PredictError'
  }
}

/**
 * POST the transcript to the importance-classifier service and get back the
 * same structure with three extra per-word fields:
 *   - predicted_importance: 'high' | 'med' | 'low'
 *   - predicted_proba: { high, med, low }
 *   - combined_risk: 'high' | 'med' | 'low'
 * The upstream `risk` (uncertainty) field is preserved untouched.
 */
export async function predictRisks(
  transcript: Transcript,
  modelName?: string,
): Promise<Transcript> {
  const url = modelName
    ? `${PREDICT_URL}?model_name=${encodeURIComponent(modelName)}`
    : PREDICT_URL

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transcript),
    })
  } catch (e) {
    throw new PredictError(
      'Could not reach the prediction service at http://localhost:8000. ' +
        'Start it with:  uvicorn serve_model:app --port 8000  (run from server/)',
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
    throw new PredictError(`Prediction failed (HTTP ${res.status}). ${detail}`)
  }

  return (await res.json()) as Transcript
}
