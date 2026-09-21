/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        canvas: 'var(--bg-main)', surface: 'var(--bg-panel)', subtle: 'var(--bg-subtle)',
        ink: 'var(--text-main)', muted: 'var(--text-soft)', line: 'var(--border-color)',
        brand: { DEFAULT: 'var(--brand)', soft: 'var(--brand-soft)' },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
      },
      boxShadow: { panel: '0 1px 2px rgb(16 24 40 / 0.03)', dialog: '0 24px 80px rgb(0 0 0 / 0.22)' },
    },
  },
  plugins: [],
};
