import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app from the repository subpath
// (https://USERNAME.github.io/REPOSITORY/). The base is configurable so the
// same configuration works locally, on a fork with a different repository
// name, and on a custom domain:
//
//   - Default:            /smart-whiteboard/   (matches this repository)
//   - Override:           VITE_BASE_PATH=/ npm run build
//   - Custom domain:      VITE_BASE_PATH=/ npm run build
//
// `npm run dev` serves under the configured base as well
// (http://localhost:5173/smart-whiteboard/) so dev and prod behave alike.
const base = process.env.VITE_BASE_PATH ?? '/smart-whiteboard/'

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
})
