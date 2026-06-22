// Build-time configuration, baked in from .env (VITE_-prefixed vars).
// Backend precedence (see createClaudeClient): Gemini → proxy → BYOK.
// - VITE_GEMINI_API_KEY set → call Google Gemini directly (MVP/validation).
// - else VITE_PROXY_URL set → call the owner-key Cloudflare proxy (no per-user key).
// - else                    → BYOK fallback (DirectClaudeClient, user enters a key).

const proxyUrl = (import.meta.env.VITE_PROXY_URL as string | undefined)?.trim() || ''
const proxySecret = (import.meta.env.VITE_PROXY_SECRET as string | undefined)?.trim() || ''
const geminiApiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() || ''
const geminiModel =
  (import.meta.env.VITE_GEMINI_MODEL as string | undefined)?.trim() || 'gemini-2.5-flash'
const demoMode = (import.meta.env.VITE_DEMO_MODE as string | undefined)?.trim() === 'true'

export const config = {
  proxyUrl,
  proxySecret,
  /** Google Gemini API key (baked in at build time — see usesGemini). */
  geminiApiKey,
  /** Gemini model id used for every call (the per-feature Anthropic model is ignored in Gemini mode). */
  geminiModel,
  /** Build-time demo flag — forces sample outputs (no API call). The user can also toggle demo in Settings. */
  demoMode,
  /** True when a Gemini key is configured at build time (takes precedence over the proxy). */
  get usesGemini(): boolean {
    return this.geminiApiKey.length > 0
  },
  /** True when a proxy is configured at build time (owner-key mode). */
  get usesProxy(): boolean {
    return this.proxyUrl.length > 0
  },
  /** True when any server/key backend is configured (no BYOK key gate needed). */
  get hasBackend(): boolean {
    return this.usesGemini || this.usesProxy
  },
}
