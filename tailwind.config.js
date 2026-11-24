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
        base: ['15px', { lineHeight: '1.6' }],
      },
      colors: {
        notion: {
          sidebarLight: '#F7F7F5',
          canvasLight: '#FFFFFF',
          hoverLight: '#F1F1EF',
          borderLight: '#E5E5E3',
          sidebarDark: '#202020',
          canvasDark: '#191919',
          elevatedDark: '#262626',
          borderDark: '#2F2F2F',
        },
      },
    },
  },
  plugins: [],
};
