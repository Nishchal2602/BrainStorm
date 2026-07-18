// Platform (Next.js, server-side) configuration for the vendored agent engine.
// Mirrors the extension's config shape but sources values from process.env
// (the extension used Vite import.meta.env.VITE_*). Server-only — imported by the
// vendored claude client through the ReviewOrchestrator.
//
// Every value is read through a getter (not captured into a module-level const at
// import time). In `next dev`, editing `.env` reloads `process.env` in-process
// ("Reload env: .env") but does NOT re-run already-evaluated module top-level code;
// eager consts would stay stale until a full server restart. Lazy getters read the
// current process.env on each access, so a pasted key takes effect on the next call.

const env = (name: string): string => (process.env[name] ?? '').trim()

export const config = {
  get proxyUrl(): string {
    return env('PROXY_URL')
  },
  get proxySecret(): string {
    return env('PROXY_SECRET')
  },
  /** Google Gemini API key (server env — see usesGemini). */
  get geminiApiKey(): string {
    return env('GEMINI_API_KEY')
  },
  /** Gemini model id used for every call. */
  get geminiModel(): string {
    return env('GEMINI_MODEL') || 'gemini-2.5-flash'
  },
  /** Anthropic Claude API key (server env — see usesAnthropic). */
  get anthropicApiKey(): string {
    return env('ANTHROPIC_API_KEY')
  },
  /** Claude model id used for every call when on the Anthropic backend. */
  get anthropicModel(): string {
    return env('ANTHROPIC_MODEL') || 'claude-sonnet-5'
  },
  get demoMode(): boolean {
    return env('DEMO_MODE') === 'true'
  },
  /** True when an Anthropic key is configured (takes precedence over Gemini + proxy). */
  get usesAnthropic(): boolean {
    return this.anthropicApiKey.length > 0
  },
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
    return this.usesAnthropic || this.usesGemini || this.usesProxy
  },
}
