/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Silkscreen"', '"DotGothic16"', 'monospace'],
        rpg: ['"DotGothic16"', '"Noto Sans TC"', 'sans-serif'],
        sans: ['"Noto Sans TC"', '-apple-system', 'BlinkMacSystemFont', '"PingFang HK"', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#fdf2ee',
          100: '#fae0d6',
          200: '#f4bfa9',
          500: '#d44836',
          600: '#b83525',
          700: '#932619',
        },
        tavern: {
          parchment: '#F3E7CC',
          paper: '#FFF9EB',
          wood: '#5C3822',
          woodDark: '#3B2314',
          woodLight: '#8C5633',
          gold: '#F7C948',
          ink: '#2F1B0E',
        },
      },
    },
  },
  plugins: [],
};
