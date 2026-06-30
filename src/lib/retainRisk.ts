import type { Word } from '../types'

// One token of a whole-sentence rewrite, paired with the original word it was
// matched to (so its risk colouring is retained) or null when it's new/changed.
export interface RetainToken {
  text: string // the rewritten surface form (keeps punctuation/case for display)
  word: Word | null // matched original word — carries risk/combined_risk
  index: number | null // original word index (for click → inspect), null if unmatched
}

// Normalise for matching: lowercase, drop punctuation but keep apostrophes so
// "don't" still matches "don't" and "Gun." matches "gun".
function clean(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9']/g, '')
}

const LOOKAHEAD = 6 // bound so a far-away duplicate word can't steal risk

/**
 * Greedy, in-order token match for a rewritten sentence. Each rewrite token is
 * matched to the next equal original word (consuming it), so unchanged runs
 * keep their original risk and an inserted/edited word doesn't grab a later
 * original's risk. Reordered/duplicated/heavily-edited words fall through to
 * `word: null` (rendered plain) — a documented, cosmetic-only limitation.
 */
export function matchOverrideTokens(overrideText: string, originalWords: Word[]): RetainToken[] {
  const tokens = overrideText.split(/\s+/).filter(Boolean)
  const out: RetainToken[] = []
  let cursor = 0
  for (const tok of tokens) {
    const key = clean(tok)
    if (!key) {
      out.push({ text: tok, word: null, index: null }) // pure punctuation
      continue
    }
    let matched = -1
    const limit = Math.min(originalWords.length, cursor + LOOKAHEAD)
    for (let j = cursor; j < limit; j++) {
      if (clean(originalWords[j].text) === key) {
        matched = j
        break
      }
    }
    if (matched >= 0) {
      out.push({ text: tok, word: originalWords[matched], index: matched })
      cursor = matched + 1 // consume it + treat skipped originals as deleted
    } else {
      out.push({ text: tok, word: null, index: null }) // new / changed token
    }
  }
  return out
}
