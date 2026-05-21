/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f5f5f4',
          subtle: '#e8e7e4',
        },
        border: {
          DEFAULT: '#d4d2ce',
          strong: '#a09e99',
        },
        ink: {
          DEFAULT: '#1a1917',
          muted: '#4a4846',
          faint: '#787470',
        },
        risk: {
          high: '#dc2626',
          'high-bg': '#fef2f2',
          med: '#d97706',
          'med-bg': '#fffbeb',
        },
        verified: {
          DEFAULT: '#166534',
          bg: '#f0fdf4',
          bar: '#22c55e',
        },
        speaker: {
          officer: '#1e3a5f',
          witness: '#4a1d6b',
        },
      },
    },
  },
  plugins: [],
}
