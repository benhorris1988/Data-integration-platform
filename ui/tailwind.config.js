/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        xs: ['11px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '20px' }],
        base: ['14px', { lineHeight: '22px' }],
        lg: ['16px', { lineHeight: '24px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['28px', { lineHeight: '36px' }],
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '2px',
        md: '6px',
        lg: '6px',
      },
      colors: {
        bg: '#FAFAFA',
        surface: '#FFFFFF',
        'surface-2': '#F4F4F5',
        border: '#E4E4E7',
        'border-strong': '#D4D4D8',
        text: '#18181B',
        'text-muted': '#71717A',
        'text-subtle': '#A1A1AA',
        'd-bg': '#0A0A0B',
        'd-surface': '#111113',
        'd-surface-2': '#18181B',
        'd-border': '#27272A',
        'd-border-strong': '#3F3F46',
        'd-text': '#FAFAFA',
        'd-text-muted': '#A1A1AA',
        'd-text-subtle': '#71717A',
        brand: '#2563EB',
        'brand-hover': '#1D4ED8',
        success: '#16A34A',
        warning: '#D97706',
        danger: '#DC2626',
        info: '#0891B2',
        queued: '#71717A',
      },
      boxShadow: {
        overlay:
          '0 4px 16px -2px rgba(0,0,0,0.08), 0 2px 6px -1px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
        'overlay-dark': '0 4px 16px -2px rgba(0,0,0,0.5), 0 2px 6px -1px rgba(0,0,0,0.4)',
      },
      keyframes: {
        'lb-pulse': {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(37,99,235,0.5)' },
          '50%': { boxShadow: '0 0 0 6px rgba(37,99,235,0)' },
        },
        'lb-spin': { to: { transform: 'rotate(360deg)' } },
        'lb-shimmer': {
          '0%': { backgroundPosition: '-200px 0' },
          '100%': { backgroundPosition: 'calc(200px + 100%) 0' },
        },
        'lb-fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'lb-pulse': 'lb-pulse 1.6s ease-out infinite',
        'lb-spin': 'lb-spin 0.7s linear infinite',
        'lb-shimmer': 'lb-shimmer 1.2s ease-in-out infinite',
        'lb-fade-in-up': 'lb-fade-in-up 0.18s ease-out',
      },
    },
  },
  plugins: [],
};
