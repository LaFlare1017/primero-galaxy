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
      },
    },
  },
  plugins: [],
};
