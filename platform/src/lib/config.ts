// Platform (Next.js, server-side) configuration for the vendored agent engine.
// Mirrors the extension's config shape but sources values from process.env
// (the extension used Vite import.meta.env.VITE_*). Server-only — imported by the
// vendored claude client through the ReviewOrchestrator.

const proxyUrl = (process.env.PROXY_URL ?? '').trim()
const proxySecret = (process.env.PROXY_SECRET ?? '').trim()
const geminiApiKey = (process.env.GEMINI_API_KEY ?? '').trim()
const geminiModel = (process.env.GEMINI_MODEL ?? '').trim() || 'gemini-2.5-flash'
const demoMode = (process.env.DEMO_MODE ?? '').trim() === 'true'

export const config = {
  proxyUrl,
  proxySecret,
  /** Google Gemini API key (server env — see usesGemini). */
  geminiApiKey,
  /** Gemini model id used for every call. */
  geminiModel,
  demoMode,
  /** True when a Gemini key is configured (takes precedence over the proxy). */
  get usesGemini(): boolean {
    return this.geminiApiKey.length > 0
  },
  /** True when a proxy is configured (owner-key mode). */
  get usesProxy(): boolean {
    return this.proxyUrl.length > 0
  },
  /** True when any server/key backend is configured. */
  get hasBackend(): boolean {
    return this.usesGemini || this.usesProxy
  },
}
