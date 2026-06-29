// Lemma integration config — sibling of src/lib/config.ts (which is left untouched).
// Lazy getters read process.env on each access so a `.env` edit takes effect without
// a code change (Next dev reloads env in-process). Server-only.
//
// In the "Lemma shell" model the Lemma backend runs NO LLM compute, so there is no
// model key here — the Gemini key stays in src/lib/config.ts. We only need to reach
// the pod API and authenticate headlessly with a bearer token.

const env = (name: string): string => (process.env[name] ?? '').trim()

export const lemmaConfig = {
  /** Master switch — when false the review uses the existing in-process orchestrator. */
  get enabled(): boolean {
    return env('LEMMA_ENABLED') === 'true'
  },
  /** Pod API base URL, e.g. http://127-0-0-1.sslip.io:8711 (local stack). */
  get baseUrl(): string {
    return env('LEMMA_BASE_URL')
  },
  /** Auth service URL, e.g. http://127-0-0-1.sslip.io:8711/auth. */
  get authUrl(): string {
    return env('LEMMA_AUTH_URL')
  },
  /** Pod that holds the pocket-pm-review workflow. */
  get podId(): string {
    return env('LEMMA_POD_ID')
  },
  /** Headless bearer token (from `lemma auth login` → ~/.lemma/config.json). */
  get token(): string {
    return env('LEMMA_TOKEN')
  },
  /** Workflow name imported into the pod. */
  get workflowName(): string {
    return env('LEMMA_WORKFLOW_NAME') || 'pocket-pm-review'
  },
  /** Poll cadence + ceiling while driving the run (safety bound; not durable execution). */
  pollIntervalMs: 1500,
  maxPolls: 400,
  /**
   * True only when the Lemma path is both switched on AND fully configured for
   * headless server use. The endpoint requires this before choosing the Lemma
   * runner; otherwise it falls back to the existing orchestrator.
   */
  get configured(): boolean {
    return this.enabled && this.baseUrl.length > 0 && this.podId.length > 0 && this.token.length > 0
  },
}
