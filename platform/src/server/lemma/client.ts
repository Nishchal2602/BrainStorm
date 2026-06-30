import { lemmaConfig } from './config'
import type { LemmaClientPort, LemmaRunView, LemmaRunStatus } from './port'

/**
 * Real LemmaClientPort — direct HTTP calls to the Lemma backend API with
 * Authorization: Bearer <LEMMA_TOKEN>. No SDK needed in Node: the lemma-sdk
 * wraps the same REST API but its auth layer hard-guards on `typeof window`,
 * making every auth path a no-op in Node. Direct fetch bypasses that entirely
 * and the Bearer token approach is confirmed to work (curl-verified).
 *
 * API surface used:
 *   POST /pods/{pod_id}/workflows/{name}/runs        → create run
 *   GET  /pods/{pod_id}/workflow-runs/{run_id}       → poll run
 *   POST /pods/{pod_id}/workflow-runs/{run_id}/form  → advance FORM node
 *   POST /pods/{pod_id}/workflow-runs/{run_id}/cancel
 */
export class LemmaWorkflowClient implements LemmaClientPort {
  private get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${lemmaConfig.token}`,
    }
  }

  private get base() {
    return lemmaConfig.baseUrl.replace(/\/$/, '')
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`Lemma API ${method} ${path} → ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  async startRun(workflowName: string): Promise<LemmaRunView> {
    const podId = lemmaConfig.podId
    const run = await this.req<LemmaRawRun>(
      'POST',
      `/pods/${podId}/workflows/${workflowName}/runs`,
      {},
    )
    return toView(run)
  }

  async getRun(runId: string): Promise<LemmaRunView> {
    const podId = lemmaConfig.podId
    const run = await this.req<LemmaRawRun>('GET', `/pods/${podId}/workflow-runs/${runId}`)
    return toView(run)
  }

  async submitForm(runId: string, nodeId: string, inputs: Record<string, unknown> = {}): Promise<LemmaRunView> {
    const podId = lemmaConfig.podId
    const run = await this.req<LemmaRawRun>('POST', `/pods/${podId}/workflow-runs/${runId}/form`, {
      node_id: nodeId,
      inputs,
    })
    return toView(run)
  }

  async cancel(runId: string): Promise<void> {
    const podId = lemmaConfig.podId
    await this.req('POST', `/pods/${podId}/workflow-runs/${runId}/cancel`)
  }
}

interface LemmaRawRun {
  id: string
  status?: string
  active_wait?: { node_id?: string; wait_type?: string } | null
  error?: string | null
}

function toView(run: LemmaRawRun): LemmaRunView {
  const status = (run.status ?? 'RUNNING') as LemmaRunStatus
  const waitingNodeId = status === 'WAITING' && run.active_wait?.node_id ? run.active_wait.node_id : null
  return { id: run.id, status, waitingNodeId, error: run.error ?? null }
}
