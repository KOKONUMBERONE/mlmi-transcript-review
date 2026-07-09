// Backend base URLs — configurable so the app works both locally and hosted.
//
//   local dev (default): model API on :8000, ASR on :8001 (127.0.0.1, not
//     "localhost", so an IPv6 ::1 squatter can't intercept — see predictApi).
//   hosted: set VITE_API_BASE (and optionally VITE_ASR_BASE) to the deployed
//     backend URL at build time (Vercel env var), e.g. https://api.example.com
//
// One import point for every *Api.ts, so there is a single place to repoint the
// backend for a deploy. Trailing slashes are trimmed so `${API_BASE}/predict`
// is always well-formed.
const trim = (u: string) => u.replace(/\/+$/, '')

export const API_BASE = trim(import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000')
export const ASR_BASE = trim(import.meta.env.VITE_ASR_BASE ?? 'http://127.0.0.1:8001')

// Hosted demos don't run the heavy ASR ensemble, so audio→transcript is hidden
// there. Default on for local dev; set VITE_ASR_ENABLED=false for the hosted
// build (reviewers use the frozen demo case + transcript-JSON upload instead).
export const ASR_ENABLED = (import.meta.env.VITE_ASR_ENABLED ?? 'true') !== 'false'
