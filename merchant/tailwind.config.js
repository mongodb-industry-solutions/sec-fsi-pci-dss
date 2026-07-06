/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'media',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Brand identity (primary)
        leaf: { DEFAULT: '#00ed64', deep: '#00684a', ink: '#001e2b' },
        highlight: 'var(--highlight)',
        // Warm brand accent (secondary / decorative)
        brand: { DEFAULT: 'var(--brand)', soft: 'var(--brand-soft)' },
        espresso: { DEFAULT: '#4b2e21', dark: '#2b1a13', light: '#7a5140' },
        crema: { DEFAULT: '#f4e9d8', dark: '#e9d9c2' },
        // Semantic tokens (CSS-var driven, theme-aware)
        canvas: 'var(--canvas)',
        surface: { DEFAULT: 'var(--surface)', alt: 'var(--surface-alt)' },
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        primary: { DEFAULT: 'var(--primary)', ink: 'var(--primary-ink)' },
        accent: { DEFAULT: 'var(--accent)', ink: 'var(--accent-ink)' },
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem', '3xl': '1.5rem' },
      boxShadow: {
        card: '0 1px 2px rgba(0,30,43,.06), 0 12px 32px -16px rgba(0,30,43,.22)',
        glow: '0 0 0 1px rgba(0,237,100,.35), 0 8px 30px -8px rgba(0,237,100,.45)',
      },
      backdropBlur: { xs: '2px' },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
};
