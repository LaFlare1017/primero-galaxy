/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        void: '#030308',
        nebula: '#0A0A1A',
        'star-bright': '#FFFFFF',
        'star-dim': '#4A4A6A',
        'maturity-low': '#FF6B35',
        'maturity-mid': '#F7C548',
        'maturity-high': '#00D9C0',
        trajectory: '#7B61FF',
        'ui-muted': '#8E8EAE', // ≥4.5:1 on void/nebula (was #6B6B8A @ 4.0:1)
        'ui-dim': '#B0B0C8',
        'border-subtle': '#1A1A3A',
        // shadcn-compatible token layer (Circle extraction): standard names so
        // vendored shadcn/ui components work verbatim. Dark values at :root
        // (Galaxy/FinBench chrome), light values under .delegate-light — see
        // the :root/.delegate-light blocks in app/globals.css.
        background: 'var(--sc-background)',
        foreground: 'var(--sc-foreground)',
        card: 'var(--sc-card)',
        'card-foreground': 'var(--sc-card-foreground)',
        popover: 'var(--sc-popover)',
        'popover-foreground': 'var(--sc-popover-foreground)',
        primary: 'var(--sc-primary)',
        'primary-foreground': 'var(--sc-primary-foreground)',
        secondary: 'var(--sc-secondary)',
        'secondary-foreground': 'var(--sc-secondary-foreground)',
        muted: 'var(--sc-muted)',
        'muted-foreground': 'var(--sc-muted-foreground)',
        accent: 'var(--sc-accent)',
        'accent-foreground': 'var(--sc-accent-foreground)',
        destructive: 'var(--sc-destructive)',
        border: 'var(--sc-border)',
        input: 'var(--sc-input)',
        ring: 'var(--sc-ring)',
      },
      borderRadius: {
        lg: 'var(--sc-radius)',
        md: 'calc(var(--sc-radius) - 2px)',
        sm: 'calc(var(--sc-radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Geist', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        title: '-0.02em',
        label: '0.05em',
      },
      animation: {
        'fade-in': 'fadeIn 0.8s ease-out forwards',
        'fade-out': 'fadeOut 0.6s ease-in forwards',
        'slide-in-right': 'slideInRight 0.6s ease-out forwards',
        'pulse-slow': 'pulseSlow 4s ease-in-out infinite',
        breathe: 'breathe 9s ease-in-out infinite',
        marquee: 'marquee 45s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        pulseSlow: {
          '0%, 100%': { opacity: '0.8' },
          '50%': { opacity: '1' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
