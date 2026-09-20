/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      // Entrance animations for server-rendered markup. They are CSS, not
      // framer-motion, on purpose: a motion component with initial="hidden" is
      // server-rendered at opacity 0 and stays invisible until the page's
      // JavaScript has loaded and hydrated (measured: up to 2.4 s on a slow
      // CPU, with the content already in the page at 0.7 s). A CSS animation
      // starts at first paint and needs no script.
      //
      // No fill-mode: a finished animation that keeps filling acts like
      // will-change, which would leave the element a permanent stacking
      // context (and, with a transform, the containing block for every
      // position:fixed child). The resting style is already the end state.
      keyframes: {
        'page-enter': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(-60px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'page-enter': 'page-enter 300ms ease-out',
        'rise-in': 'rise-in 450ms ease-out',
      },
    },
  },
  plugins: [
    require('@tailwindcss/aspect-ratio'),
    require('tailwind-scrollbar')({ nocompatible: true }),
    require('@tailwindcss/forms'),
  ],
}
