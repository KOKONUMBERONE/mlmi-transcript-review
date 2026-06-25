/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Echo design language: Open Sans throughout (police "Echo" tool font).
        sans: ['Open Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        // Mono kept for tabular timestamps / counters only.
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // Cool, calm surfaces (was warm "forensic" gray).
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f4f6f9', // page background
          subtle: '#e9edf3', // subtle fills / hovers
        },
        border: {
          DEFAULT: '#dfe3ea',
          strong: '#b9c0cc',
        },
        ink: {
          DEFAULT: '#1f2733', // slate near-black
          muted: '#475569',
          faint: '#8a93a3',
        },
        // Echo brand: navy primary + light-blue active.
        brand: {
          DEFAULT: '#33498a',
          dark: '#28376b',
          bg: '#eef2fb', // very light navy tint
          active: '#cceeff', // active/selected segment (Echo light-blue)
        },
        // Echo secondary accent (orange) — used sparingly + as the change-bar.
        accent: {
          DEFAULT: '#f59e0b',
          dark: '#d98c00',
          bg: '#fff6e6',
        },
        risk: {
          high: '#dc2626',
          'high-bg': '#fdecec',
          med: '#d97706',
          'med-bg': '#fff5e6',
        },
        // Case-focus (2b) overlay — violet, distinct from risk + brand.
        focus: {
          DEFAULT: '#7c3aed',
          bg: '#f3f0fe',
        },
        verified: {
          DEFAULT: '#166534',
          bg: '#eef7f0',
          bar: '#22c55e',
        },
        // Track-changes = the reviewer's own edits, in a cool BLUE family so
        // they never compete with the warm risk ramp (red/amber). Deletions are
        // a low-key neutral strike (not red — red is reserved for risk).
        change: {
          ins: '#2563eb',
          'ins-bg': '#eef4ff',
          del: '#64748b',
          'del-bg': '#f1f5f9',
          bar: '#2563eb',
        },
        // Coral "AI-generated — check carefully" banner (Echo warning panel).
        warning: {
          DEFAULT: '#b42318',
          bg: '#fdeceb',
          border: '#e24b4a',
        },
        speaker: {
          officer: '#33498a', // navy
          witness: '#6d28d9', // violet
        },
      },
    },
  },
  plugins: [],
}
