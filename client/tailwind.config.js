/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] },
      colors: {
        canvas: 'var(--bg-main)', surface: 'var(--bg-panel)', subtle: 'var(--bg-subtle)',
        ink: 'var(--text-main)', muted: 'var(--text-soft)', line: 'var(--border-color)', 'line-strong': 'var(--border-strong)',
        brand: { DEFAULT: 'var(--brand)', soft: 'var(--brand-soft)', strong: 'var(--brand-strong)', fill: '#5955d9', 'fill-strong': '#4740be', mark: '#7167ee' },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)', fill: '#127a5f', 'fill-strong': '#0e6650' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)', fill: '#bc3c4d', 'fill-strong': '#a52a3a' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
        // The navigation rail and sign-in artwork stay dark in both themes.
        chrome: { DEFAULT: '#151b2b', ink: '#e3e7ef', text: '#b4bccd', muted: '#8f9ab0', accent: '#b0a7ff', avatar: '#34354e', tooltip: '#202635' },
        chart: { sales: '#7265df', expenses: '#b7b2dc', accent: '#b68361' },
      },
      boxShadow: { panel: '0 1px 2px rgb(16 24 40 / 0.04)', float: '0 6px 20px rgb(16 24 40 / 0.18)', dialog: '0 24px 80px rgb(0 0 0 / 0.22)' },
    },
  },
  plugins: [],
};
