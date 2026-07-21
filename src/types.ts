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
  // Per-word audio timestamps (seconds) for karaoke highlighting. Optional —
  // older transcripts (and non-Whisper models) may omit them, in which case the
  // karaoke highlight simply doesn't run. Real values come from Whisper
  // return_token_timestamps (cross-attention DTW); even-distributed otherwise.
  start?: number
  end?: number
  alternatives?: string[]
  predicted_importance?: Risk
  predicted_proba?: { high: number; med: number; low: number }
  combined_risk?: Risk
  // Which gate granted HIGH importance in the cascade: 'l1' = rule-based
  // statutory lexicon, 'l2' = classifier. Audit-only; set by /predict.
  predicted_importance_source?: 'l1' | 'l2'
}

// Display-time risk policy — the tunable "operating point". Differs by build:
// the deployment/full build is quiet (require both signals + a tiny statutory
// always-red set + a per-segment flag budget); the study build is a pass-
// through of the importance-dominant combined_risk. Only affects the combined
// dimension; uncertainty / importance / none are rendered as-is.
export interface RiskPolicy {
  // Require uncertainty ≥ med (not importance alone) for a word to read HIGH —
  // except the always-red set. full = true, study = false.
  requireUncertaintyForHigh: boolean
  // 'statutory' keeps a tiny negation+weapon set red even at low uncertainty
  // (the "confidently wrong" gun/not cell). 'none' = no always-red set.
  alwaysRed: 'statutory' | 'none'
  // Cap reds per segment at this fraction of content words (always-red exempt);
  // surplus would-be-reds drop to amber. null = uncapped. full ≈ 0.15, study = null.
  flagBudgetPerSegmentPct: number | null
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

// Sentence-importance triage (sentence build): binary per-segment overlay from
// a local LLM — which SENTENCES a reviewer should re-listen to first. The
// transcript's 2a scores are never touched; this is navigation/colour overlay.
export interface TriageSegment {
  id: number
  importance: 'high' | 'low'
  rank?: number           // 1-based, across the whole transcript (high only)
  reason?: string         // ≤8-word why (head-dot tooltip)
}

export interface TriageResult {
  segments: TriageSegment[]
}

// Sentence-layer signal (launcher sentence versions): which AI signal drives
// the whole-sentence tint — ASR confidence (`paraRisk`), LLM importance
// (/triage), or the gated combination of the two ("likely mis-transcribed AND
// matters" — the word-level deployment principle applied at sentence level).
export type SentenceSignal = 'confidence' | 'importance' | 'both'

// Editing interaction mode (police feedback 2026-07-08). 'assisted' = the
// research-grade flow (click a word → candidate popup; edit-sentence → editor
// with candidates/reasons). 'document' = "edit like Word": click the sentence
// text and just type; blur/Enter saves. Both commit through the same
// whole-sentence rewrite path (`segmentTextEdits` → alignRewrite), so risk
// retention, track-changes, audit and export are identical.
export type EditMode = 'assisted' | 'document'

// Cross-sentence contradiction check (anomaly build): the local LLM flags
// PAIRS of segments that appear to conflict. Pointing overlay only — each pair
// carries the two segment ids, a coarse type, and a short note; the reviewer
// re-checks both against the audio. "No conflicts" is a valid result.
export type ConflictType = 'time' | 'place' | 'person' | 'statement'

export interface ConflictPair {
  a: number               // first segment id
  b: number               // second segment id (≠ a)
  type: ConflictType
  note: string            // ≤12-word what-conflicts note
}

export interface AnomalyResult {
  conflicts: ConflictPair[]
}

// Event timeline (timeline build): the local LLM lists the concrete events
// described in the recording, each citing the segment it is stated in (`id`)
// plus any spoken time reference. Clicking an event seeks the audio to the
// cited segment — a navigation overlay, nothing asserted without a citation.
export interface TimelineEvent {
  id: number              // segment id the event is stated in
  time: string            // spoken time reference ("9:42", "last Saturday…") or ""
  event: string           // ≤10-word what-happened
}

export interface TimelineResult {
  events: TimelineEvent[]
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

// One token of a rendered whole-sentence rewrite, after word-level diffing the
// rewrite against the original words (see src/lib/retainRisk.ts alignRewrite).
// 'keep' carries the matched original Word (real risk + real start/end);
// 'insert' is human-authored (no risk). Deleted originals are dropped (not
// emitted). start/end are the karaoke range: 'keep' = the Word's; 'insert' =
// interpolated, or shared across a block run (same blockId). Absent when the
// originals carry no timestamps.
export interface AlignedToken {
  text: string
  op: 'keep' | 'insert'
  word: Word | null
  originalIndex: number | null
  start?: number
  end?: number
  blockId?: number
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
  | 'sort_change' // legacy — Order sort control removed 2026-07-02; never emitted since, may appear in earlier v2 logs
  | 'export'
  | 'transcript_load'
  | 'audio_load'
  | 'focus_apply'
  | 'focus_clear'
  | 'focus_snippet_click'
  | 'trial_start'
  | 'trial_end'
  | 'question_answer'
  | 'tab_switch'
  | 'dimension_change'
  | 'segment_view'
  | 'segment_expand'
  | 'segment_hover'
  | 'segment_split'
  | 'segment_merge'
  | 'speaker_change'
  | 'outline_run'
  | 'outline_open'
  | 'outline_part_click'
  | 'outline_chapter_click'
  // Sentence-importance triage (sentence build only).
  | 'triage_run'
  // Contradiction check (anomaly build only).
  | 'anomaly_run'
  | 'anomaly_jump'
  // Event timeline (timeline build only).
  | 'timeline_run'
  | 'timeline_event_click'
  // Assistant chat (full build): metadata-only events — see the chat_* fields.
  | 'chat_send'
  | 'chat_answer'
  | 'chat_citation_click'
  | 'chat_clear'

// 'marker' = left-panel jump lists (timeline list, outline, conflicts);
// 'timeline' = the full-width TimelineStrip (marker or track click).
export type SeekTrigger = 'waveform' | 'segment' | 'marker' | 'keyboard' | 'programmatic' | 'word' | 'timeline'

export interface LogEvent {
  // Always present:
  t_ms: number           // ms since session start (monotonic, high-res)
  t_iso: string          // wall-clock ISO timestamp
  type: EventType
  reviewer: string
  model: string
  participant_id: string // study participant code, e.g. "P01" — "demo" if unset
  condition: string      // study condition code, e.g. "C3" — "demo" if unset
  theme?: 'light' | 'dark' // active UI theme (study locks it at setup)

  // Trial context (set by the study trial runner; absent in the full build):
  t_in_trial_ms?: number // ms since the current trial started
  block?: number
  trial_index?: number
  difficulty?: string
  stimulus_id?: string
  task_type?: string     // three-session study: 't1' (proofread) | 't2' (long recording) | 't3' (voice notes). Assistance factor is derivable from `condition`: C1→plain, C4→full.

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
  // Progressive disclosure: how a sentence got expanded to word level —
  // 'manual' = reviewer clicked it, 'auto' = playhead entered it.
  expand_trigger?: 'manual' | 'auto'
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
  // Police in-task case questions (question_answer events; stimulus_id carries
  // which task). Answer stored flat as a string — multi-select joined with ' | '.
  question_id?: string
  question_type?: string       // 'mc' | 'open' | 'scale' | 'task'
  question_value?: string
  // tab_switch payload: which panel came into view (or was collapsed away).
  //   left:find | left:chat | left:timeline | left:conflicts | left:collapsed
  //   right:questions | right:review | right:collapsed | right:expanded
  tab?: string
  // filter_change payload. Four value namespaces share this field — match on
  // the full string, NOT a prefix ('high' is the Show filter; 'highlights:high'
  // is the word-highlight toggle):
  //   Show segment filter (both builds): 'all' | 'high+med' | 'high'
  //   Highlights toggle  (full only):    'highlights:all' | 'highlights:high'
  //   Marks toggle       (both builds):  'marks:hover' | 'marks:always'
  //   Sentence signal (sentence versions): 'sentence_signal:confidence|importance|both'
  filter?: string
  sort?: string // legacy — populated only by pre-2026-07-02 sort_change events
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
  // Sentence triage (sentence build): how many sentences the LLM marked
  // important (part_count doubles as the window count on triage_run rows).
  triage_high?: number
  // Contradiction check (anomaly build): pairs returned by an anomaly_run;
  // on anomaly_jump, the other half of the pair + its coarse type.
  anomaly_count?: number
  partner_id?: number
  anomaly_type?: ConflictType
  // Event timeline (timeline build): events returned by a timeline_run.
  timeline_count?: number
  chapter_id?: number       // which part/chapter a click belongs to (chapter_* reused for parts)
  chapter_title?: string
  chapter_start?: number    // seconds
  chapter_end?: number      // seconds
  // Assistant chat (full build): metadata ONLY — message text / answers are
  // ephemeral and must never enter the log (it is exportable).
  chat_turn?: number        // 1-based turn index within the conversation
  chat_chars?: number       // length of the sent question / received answer
  chat_citations?: number   // citations attached to an answer
  chat_latency_ms?: number  // round-trip time of the /chat call
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
