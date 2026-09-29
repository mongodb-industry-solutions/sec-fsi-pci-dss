import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        'mongodb-green': '#00ED64',
        'mongodb-dark': '#001E2B',
        'mongodb-gray': '#3D4F58',
      },
    },
  },
  plugins: [],
};

export default config;
