import React from 'react'
import ReactDOM from 'react-dom/client'
import AppFull from './AppFull'
import AppStudy from './AppStudy'
import AppSentence from './AppSentence'
import AppVersions from './AppVersions'
import './index.css'

// Apply the saved theme BEFORE first paint so dark mode never flashes light.
// Mirrors the key used by src/hooks/useTheme.ts.
try {
  if (localStorage.getItem('mlmi.theme') === 'dark') {
    document.documentElement.classList.add('dark')
  }
} catch {
  /* localStorage unavailable — default light */
}

// Build-time shell selection. `vite --mode study` sets VITE_APP_MODE=study
// (see .env.study), `vite --mode sentence` sets VITE_APP_MODE=sentence
// (see .env.sentence), 'full' forces the bare full shell. The DEFAULT build is
// the version launcher: a landing menu where reviewers pick an interface
// variant (word / sentence / future sub-versions) — one deployment, no
// per-version commands.
const App =
  import.meta.env.VITE_APP_MODE === 'study'
    ? AppStudy
    : import.meta.env.VITE_APP_MODE === 'sentence'
      ? AppSentence
      : import.meta.env.VITE_APP_MODE === 'full'
        ? AppFull
        : AppVersions

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
