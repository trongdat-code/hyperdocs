/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Google Sans Flex',
          'Google Sans',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['Google Sans Code', 'JetBrains Mono', 'monospace'],
      },
      fontSize: {
        base: ['15px', { lineHeight: '1.6' }],
      },
      colors: {
        notion: {
          canvasLight: '#FFFFFF',
          sidebarLight: '#FBFBFA',
          hoverLight: '#F3F3F1',
          borderLight: '#E8E8E5',
          inkLight: '#262624',
          mutedLight: '#6B6A66',
          canvasDark: '#191919',
          sidebarDark: '#202020',
          elevatedDark: '#262626',
          borderDark: '#2F2F2F',
          inkDark: '#ECECEA',
          mutedDark: '#9B9A97',
        },
      },
    },
  },
  plugins: [],
};
