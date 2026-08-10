import type { LogEvent } from '../types'

// The public dissertation artifact is local-only. Study events remain in the
// existing in-browser event log and can be exported manually by the reviewer.
export const studyUploadEnabled = false

/** Random id tying all of one local study session's snapshots together. */
export function newStudySessionId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

export interface StudySnapshot {
  session_id: string
  participant_id: string
  cb_group: string
  trials_completed: number
  complete: boolean
  n_events: number
  events: LogEvent[]
}

/** Compatibility no-op: public builds never send study data off the device. */
export async function uploadStudySnapshot(
  _snapshot: StudySnapshot,
  _options: { attempts?: number } = {},
): Promise<void> {
  return Promise.resolve()
}
