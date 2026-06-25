import ReviewWorkspace from './core/ReviewWorkspace'
import { FULL_CONFIG } from './core/config'
import { useEventLog } from './state/useEventLog'

// Full / Scottish-police build: every feature, free risk-dimension toggle,
// upload + record + auto-transcribe, free-text case focus.
export default function AppFull() {
  const events = useEventLog()
  return <ReviewWorkspace config={FULL_CONFIG} events={events} />
}
