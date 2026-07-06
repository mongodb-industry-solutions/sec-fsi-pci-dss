/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Espresso Works branding palette
        espresso: { DEFAULT: '#4b2e21', dark: '#3a231a', light: '#7a5140' },
        crema: '#e9d9c2',
      },
    },
  },
  plugins: [],
};
