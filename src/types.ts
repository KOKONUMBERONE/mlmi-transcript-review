export type Risk = 'high' | 'med' | 'low'

export type ModelName =
  | 'Model A (Whisper-large)'
  | 'Model B (wav2vec2)'
  | 'Model C (Consensus)'

// `risk` is the *uncertainty* dimension (confidence-based, upstream).
// The three `predicted_*` fields are the *importance* dimension and the
// 2x2 combination, written by the local FastAPI service in /predict.
export interface Word {
  text: string
  risk: Risk
  alternatives?: string[]
  predicted_importance?: Risk
  predicted_proba?: { high: number; med: number; low: number }
  combined_risk?: Risk
}

// Which signal the transcript view colours words by.
export type RiskDimension = 'uncertainty' | 'importance' | 'combined'

// `speaker` is open-ended: pipelines that skip diarization emit a single
// generic label (e.g. "Speaker"), pipelines that do diarization can emit
// arbitrary names. The UI maps known labels (Officer/Witness) to themed
// colours and falls back to a neutral colour for everything else.
export interface Segment {
  id: number
  speaker: string
  start: number
  end: number
  paraRisk: Risk
  words: {
    [modelName: string]: Word[]
  }
}

export interface Transcript {
  audioDuration: number
  segments: Segment[]
}

// A reviewer's override on a single word. The word is always kept in view
// (deleted words show as strikethrough) so the chain-of-custody is preserved.
export interface EditState {
  text: string
  deleted: boolean
  reason?: string
}

// Flat, pandas-friendly schema for behavioural events. Every meaningful
// interaction emits one row. Most fields are optional — only the four base
// columns are guaranteed present on every row.
export type EventType =
  | 'session_start'
  | 'play'
  | 'pause'
  | 'seek'
  | 'speed_change'
  | 'model_switch'
  | 'segment_focus'
  | 'word_click'
  | 'popup_open'
  | 'popup_close'
  | 'edit_apply'
  | 'word_delete'
  | 'word_restore'
  | 'verify'
  | 'unverify'
  | 'filter_change'
  | 'sort_change'
  | 'export'
  | 'transcript_load'
  | 'audio_load'

export type SeekTrigger = 'waveform' | 'segment' | 'marker' | 'keyboard' | 'programmatic'

export interface LogEvent {
  // Always present:
  t_ms: number           // ms since session start (monotonic, high-res)
  t_iso: string          // wall-clock ISO timestamp
  type: EventType
  reviewer: string
  model: string
  participant_id: string // study participant code, e.g. "P01" — "demo" if unset
  condition: string      // study condition code, e.g. "A_plain" — "demo" if unset

  // Event-specific fields (all optional, flat for pandas):
  audio_position?: number
  from_position?: number
  to_position?: number
  trigger?: SeekTrigger
  old_speed?: number
  new_speed?: number
  from_model?: string
  to_model?: string
  segment_id?: number
  segment_start?: number
  segment_risk?: Risk
  word_index?: number
  word_text?: string
  word_risk?: Risk
  from_text?: string
  to_text?: string
  via?: 'candidate' | 'manual'
  reason?: string
  filter?: string
  sort?: string
  export_kind?: string
  audio_duration?: number
  transcript_filename?: string
  audio_filename?: string
  segment_count?: number
}

export interface HistoryEntry {
  id: string
  timestamp: string         // HH:MM:SS — second-precision
  reviewer: string          // who made the change
  kind: 'edit' | 'delete' | 'verify' | 'unverify'
  segmentId: number
  wordIndex?: number
  from?: string             // previous displayed text (or "(deleted)")
  to?: string               // new displayed text (omitted for delete)
  reason?: string           // optional short note ("not in audio", etc.)
}
