/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every colour is a CSS variable, so the dark scheme redefines values rather than duplicating
        // classes. The bank's identity is deliberately not the provider's: an operator should be able to
        // tell at a glance which institution's administration they are looking at.
        canvas: 'var(--canvas)',
        surface: { DEFAULT: 'var(--surface)', alt: 'var(--surface-alt)' },
        line: 'var(--border)',
        ink: { DEFAULT: 'var(--ink)', soft: 'var(--ink-soft)' },
        bank: { DEFAULT: 'var(--bank)', ink: 'var(--bank-ink)' },
        accent: 'var(--accent)',
      },
    },
  },
  plugins: [],
};
