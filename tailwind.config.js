/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        base: ['17px', { lineHeight: '1.6' }],
      },
      colors: {
        surface: {
          light: '#FFFFFF',
          muted: '#F8FAFC',
          dark: '#09090B',
          darkCard: '#0F172A',
          darkBorder: '#1E293B',
        },
      },
    },
  },
  plugins: [],
};
