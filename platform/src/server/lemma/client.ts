import type { LemmaClient } from 'lemma-sdk'
import { lemmaConfig } from './config'
import type { LemmaClientPort, LemmaRunView, LemmaRunStatus } from './port'

/**
 * Real LemmaClientPort backed by `lemma-sdk`.
 *
 * Two deliberate isolation choices:
 *  1. `lemma-sdk` is **dynamically imported** (not a top-level import) so its
 *     browser-oriented deps (supertokens-web-js) never execute during `next build`
 *     or on the in-process fallback path — only when a live Lemma review actually runs.
 *  2. Headless auth: the SDK's documented token path reads `localStorage.lemma_token`
 *     and then sends `Authorization: Bearer <token>`. Node has no localStorage, so we
 *     install a minimal shim seeded with LEMMA_TOKEN before constructing the client.
 *
 * The SDK type is imported with `import type` (erased at compile time — no runtime import).
 */
export class LemmaWorkflowClient implements LemmaClientPort {
  private client: LemmaClient | null = null

  private async getClient(): Promise<LemmaClient> {
    if (this.client) return this.client
    if (!lemmaConfig.token) throw new Error('LEMMA_TOKEN is required for headless Lemma access')
    installTokenShim(lemmaConfig.token)
    let mod: typeof import('lemma-sdk')
    try {
      mod = await import('lemma-sdk')
    } catch (e) {
      throw new Error(`Failed to load lemma-sdk: ${e instanceof Error ? e.message : String(e)}`)
    }
    this.client = new mod.LemmaClient({
      apiUrl: lemmaConfig.baseUrl,
      authUrl: lemmaConfig.authUrl || `${lemmaConfig.baseUrl}/auth`,
      podId: lemmaConfig.podId,
    })
    return this.client
  }

  async startRun(workflowName: string): Promise<LemmaRunView> {
    const c = await this.getClient()
    return toView(await c.workflows.runs.create(workflowName))
  }

  async getRun(runId: string): Promise<LemmaRunView> {
    const c = await this.getClient()
    return toView(await c.workflows.runs.get(runId, lemmaConfig.podId))
  }

  async submitForm(runId: string, nodeId: string, inputs: Record<string, unknown> = {}): Promise<LemmaRunView> {
    const c = await this.getClient()
    return toView(await c.workflows.runs.submitForm(runId, { node_id: nodeId, inputs }, lemmaConfig.podId))
  }

  async cancel(runId: string): Promise<void> {
    const c = await this.getClient()
    await c.workflows.runs.cancel(runId, lemmaConfig.podId)
  }
}

/** Map the SDK's WorkflowRunResponse onto our reduced view. */
function toView(run: {
  id: string
  status?: string
  active_wait?: { node_id?: string; wait_type?: string } | null
  error?: string | null
}): LemmaRunView {
  const status = (run.status ?? 'RUNNING') as LemmaRunStatus
  const waitingNodeId = status === 'WAITING' && run.active_wait?.node_id ? run.active_wait.node_id : null
  return { id: run.id, status, waitingNodeId, error: run.error ?? null }
}

/**
 * Minimal Node localStorage shim seeded with the Lemma token. The SDK reads
 * `localStorage.getItem('lemma_token')` to enable Bearer auth; everything else is a no-op.
 * Idempotent and non-destructive (won't clobber an existing localStorage).
 */
function installTokenShim(token: string): void {
  const g = globalThis as unknown as { localStorage?: Storage }
  if (g.localStorage) return
  const store: Record<string, string> = { lemma_token: token }
  g.localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length
    },
  } as Storage
}
