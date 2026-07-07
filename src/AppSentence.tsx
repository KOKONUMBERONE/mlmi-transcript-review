import ReviewWorkspace from './core/ReviewWorkspace'
import { SENTENCE_CONFIG } from './core/config'
import { useEventLog } from './state/useEventLog'

// Sentence-importance build (Police Scotland feedback round): a local LLM
// triages which sentences matter; word uncertainty marks appear only inside
// those. Same workspace, different paradigm — see SENTENCE_CONFIG.
export default function AppSentence() {
  const events = useEventLog()
  return <ReviewWorkspace config={SENTENCE_CONFIG} events={events} />
}
