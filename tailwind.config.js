/** @type {import('tailwindcss').Config} */

// Colours are CSS variables (channel triplets like "51 73 138") defined in
// src/index.css for :root (light) and .dark (dark). The rgb(var(--x) /
// <alpha-value>) form keeps every opacity utility (e.g. bg-brand/40) working
// while letting a single `.dark` class on <html> flip the whole palette.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
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
          DEFAULT: v('surface'),
          muted: v('surface-muted'), // page background
          subtle: v('surface-subtle'), // subtle fills / hovers
        },
        border: {
          DEFAULT: v('border'),
          strong: v('border-strong'),
        },
        ink: {
          DEFAULT: v('ink'), // primary text (near-black in light)
          muted: v('ink-muted'),
          faint: v('ink-faint'),
        },
        // Echo brand: navy primary + light-blue active.
        brand: {
          DEFAULT: v('brand'),
          dark: v('brand-dark'),
          bg: v('brand-bg'), // very light navy tint
          active: v('brand-active'), // active/selected segment
        },
        // Echo secondary accent (orange) — used sparingly + as the change-bar.
        accent: {
          DEFAULT: v('accent'),
          dark: v('accent-dark'),
          bg: v('accent-bg'),
        },
        risk: {
          high: v('risk-high'),
          'high-bg': v('risk-high-bg'),
          med: v('risk-med'),
          'med-bg': v('risk-med-bg'),
        },
        // Case-focus (2b) overlay — violet, distinct from risk + brand.
        focus: {
          DEFAULT: v('focus'),
          bg: v('focus-bg'),
        },
        verified: {
          DEFAULT: v('verified'),
          bg: v('verified-bg'),
          bar: v('verified-bar'),
        },
        // Track-changes = the reviewer's own edits, cool BLUE family.
        change: {
          ins: v('change-ins'),
          'ins-bg': v('change-ins-bg'),
          del: v('change-del'),
          'del-bg': v('change-del-bg'),
          bar: v('change-bar'),
        },
        // Coral "AI-generated — check carefully" banner (Echo warning panel).
        warning: {
          DEFAULT: v('warning'),
          bg: v('warning-bg'),
          border: v('warning-border'),
        },
        speaker: {
          officer: v('speaker-officer'),
          witness: v('speaker-witness'),
        },
      },
    },
  },
  plugins: [],
}
