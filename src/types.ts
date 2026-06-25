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

// The active highlight layer rendered in the transcript. 'none' = C1 (plain
// text, no risk colouring); the three RiskDimension values colour as before.
export type HighlightLayer = RiskDimension | 'none'

// ----- User-study interface conditions (C1–C4) -----
// Each condition is the shared review skeleton with a different highlight
// layer (+ case focus for C4). The mapping condition → highlight layer lives
// in src/core/conditions.ts (Phase 1).
export type Condition = 'C1' | 'C2' | 'C3' | 'C4'

// ----- Component 2b: case-focused evidence retrieval (overlay) -----
// A focus item the reviewer declares: a label plus optional reviewer-typed
// aliases (surface variants). Aliases are never auto-generated — no LLM call.
export interface FocusItem {
  label: string
  aliases: string[]
}

export type FocusMatchType = 'exact' | 'alias' | 'semantic' | 'llm'

// Which retrieval engine the focus box uses. 'lexical' = the deterministic
// exact/alias/pattern/expand/embedding path; 'ai' = a local LLM reads the whole
// transcript in context. Both return the same FocusResult shape.
export type FocusMode = 'lexical' | 'ai'

// One retrieved evidence snippet for a focus term. `original_combined_risk`
// preserves what 2a's default scoring showed, so the HIGH upgrade stays a
// traceable overlay rather than silently overwriting the classifier.
// How a literal hit matched: exact string, a morphological variant (stem), a
// compound/prefix (partial), a sounds-alike name (phonetic), a typo/ASR slip
// (fuzzy), or a built-in identifier pattern. null for pure semantic hits.
export type FocusMatchDetail =
  | 'literal'
  | 'stem'
  | 'partial'
  | 'phonetic'
  | 'fuzzy'
  | 'pattern'
  | 'expanded'

export interface FocusSnippet {
  segment_id: number
  segment_start: number
  match_type: FocusMatchType
  match_detail?: FocusMatchDetail | null
  focus_score: number
  evidence: string
  highlight_word_indices: number[]
  highlight_spans: string[]
  original_combined_risk: Risk
  // AI mode only: the local LLM's relevance score (mirrors focus_score) and a
  // short plain-English reason it judged this segment relevant.
  llm_relevance_score?: number
  llm_reason?: string
}

export interface FocusTermResult {
  focus_label: string
  query: string
  // Words auto-derived from the transcript's own vocabulary that were merged
  // into the search (e.g. "weapon" -> ["gun","knife"]). Empty when none.
  auto_aliases: string[]
  snippets: FocusSnippet[]
}

export interface FocusResult {
  terms: FocusTermResult[]
}

// ----- Long-transcript outline (centre "Outline" sub-page / modal) -----
// A navigable, two-level "table of contents" for a (possibly hours-long)
// transcript. The local LLM groups consecutive segments into fine CHAPTERS,
// then a synthesis pass groups those into a handful of coarse PARTS and writes
// an overall summary. It is a navigation overlay only — the transcript is never
// mutated; clicking a part/chapter just seeks the audio to its `segment_start`.
export interface OutlineChapter {
  id: number              // 1-based chapter index (across the whole outline)
  start_id: number        // first segment id in the chapter
  end_id: number          // last segment id in the chapter
  segment_start: number   // seconds — start of the first segment
  segment_end: number     // seconds — end of the last segment
  title: string           // short topic label (≤ ~8 words)
  gist: string            // 1–2 line summary of what is discussed
}

// A coarse top-level section grouping several consecutive chapters. Carries the
// longer narrative description; the number of parts is duration-adaptive so even
// a 3-hour recording stays skimmable.
export interface OutlinePart {
  id: number              // 1-based part index
  start_id: number        // first segment id in the part
  end_id: number          // last segment id in the part
  segment_start: number   // seconds — start of the part
  segment_end: number     // seconds — end of the part
  title: string           // section title
  description: string     // 2–3 sentence description of the section
  chapters: OutlineChapter[]
}

export interface OutlineResult {
  summary: string         // 3–6 sentence overview of the whole recording
  parts: OutlinePart[]
}

// Per-word overlay used by the transcript view: which focus term marked this
// word and how. Derived on the front-end from FocusResult — kept off `Word` so
// the transcript's 2a scores are never overwritten.
export interface FocusWordHit {
  focus_label: string
  match_type: FocusMatchType
  match_detail?: FocusMatchDetail | null
  focus_score: number
  llm_reason?: string
}

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
  | 'focus_apply'
  | 'focus_clear'
  | 'focus_snippet_click'
  | 'trial_start'
  | 'trial_end'
  | 'dimension_change'
  | 'segment_view'
  | 'segment_split'
  | 'segment_merge'
  | 'speaker_change'
  | 'outline_run'
  | 'outline_open'
  | 'outline_part_click'
  | 'outline_chapter_click'

export type SeekTrigger = 'waveform' | 'segment' | 'marker' | 'keyboard' | 'programmatic'

export interface LogEvent {
  // Always present:
  t_ms: number           // ms since session start (monotonic, high-res)
  t_iso: string          // wall-clock ISO timestamp
  type: EventType
  reviewer: string
  model: string
  participant_id: string // study participant code, e.g. "P01" — "demo" if unset
  condition: string      // study condition code, e.g. "C3" — "demo" if unset

  // Trial context (set by the study trial runner; absent in the full build):
  t_in_trial_ms?: number // ms since the current trial started
  block?: number
  trial_index?: number
  difficulty?: string
  stimulus_id?: string

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
  word_risk?: Risk             // uncertainty bin of the word
  word_importance?: Risk       // 2a predicted_importance
  word_combined_risk?: Risk    // 2x2 combined risk
  word_proba_high?: number     // 2a P(importance=HIGH), continuous (for calibration)
  from_text?: string
  to_text?: string
  via?: 'candidate' | 'manual'
  occurrences?: number         // batch correct-all: how many identical tokens one decision fixed
  chosen_model?: string        // which ASR model produced the chosen candidate
  reason?: string
  filter?: string
  sort?: string
  from_dimension?: RiskDimension
  to_dimension?: RiskDimension
  export_kind?: string
  audio_duration?: number
  transcript_filename?: string
  audio_filename?: string
  segment_count?: number
  time_budget_ms?: number   // fixed review time T for the trial
  // Focus mode (2b):
  focus_terms?: string      // comma-joined labels the reviewer ran
  focus_label?: string      // which term a snippet click belongs to
  focus_match_type?: FocusMatchType
  focus_match_detail?: FocusMatchDetail
  focus_score?: number
  focus_hits?: number       // total snippets returned across all terms
  focus_mode?: FocusMode | 'merged'  // 'lexical' | 'ai' | 'merged' (lexical+AI)
  // Outline (long-transcript two-level chapters):
  part_count?: number       // top-level Parts returned by an outline_run
  chapter_count?: number    // fine chapters returned by an outline_run
  chapter_id?: number       // which part/chapter a click belongs to (chapter_* reused for parts)
  chapter_title?: string
  chapter_start?: number    // seconds
  chapter_end?: number      // seconds
}

export interface HistoryEntry {
  id: string
  timestamp: string         // HH:MM:SS — second-precision
  reviewer: string          // who made the change
  kind: 'edit' | 'delete' | 'verify' | 'unverify' | 'split' | 'merge' | 'speaker'
  segmentId: number
  segmentIds?: number[]     // bulk verify/unverify: all affected segments (one summary entry)
  wordIndex?: number
  from?: string             // previous displayed text (or "(deleted)")
  to?: string               // new displayed text (omitted for delete)
  reason?: string           // optional short note ("not in audio", etc.)
}
