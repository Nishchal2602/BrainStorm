import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import manifest from './manifest.config'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // A build-time Gemini key is baked into the JS bundle and is trivially
  // extractable from a published extension (unzip the CRX, grep the key). This
  // is a deliberate, accepted tradeoff for the free-tier Gemini MVP — there's no
  // spend risk on the free tier, only shared-quota exhaustion if the key is
  // scraped. Just make sure this is visible at build time rather than silent.
  if (command === 'build' && env.VITE_GEMINI_API_KEY?.trim()) {
    console.warn(
      '\n⚠️  VITE_GEMINI_API_KEY is set — this key will be embedded in the published bundle and is ' +
        'extractable by anyone. Fine on the Gemini free tier (no spend risk), but consider a Google ' +
        'Cloud quota alert so a scraped key can\'t silently exhaust your daily allowance.\n',
    )
  }

  return {
    plugins: [react(), crx({ manifest })],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // crxjs HMR needs a stable port for the extension.
      port: 5173,
      strictPort: true,
      hmr: { port: 5173 },
    },
  }
})
