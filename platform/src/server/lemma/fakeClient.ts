import type { LemmaClientPort, LemmaRunView } from './port'

/**
 * In-memory LemmaClientPort that faithfully simulates a sequential FORM-gated
 * workflow: a run starts WAITING on the first node and advances one node per
 * submitForm until the last, then COMPLETED. Used by the e2e test and as a
 * deterministic stand-in so CI needs no Lemma stack (no Docker).
 *
 * `failAtNode` lets a test force a FAILED run when a given node is submitted,
 * to exercise the driver's failure path.
 */
export class FakeLemmaClient implements LemmaClientPort {
  private seq = 0
  private runs = new Map<string, { idx: number; status: LemmaRunView['status'] }>()

  constructor(
    private readonly nodeOrder: string[],
    private readonly failAtNode?: string,
  ) {}

  private view(id: string): LemmaRunView {
    const r = this.runs.get(id)!
    if (r.status !== 'WAITING') return { id, status: r.status, waitingNodeId: null }
    return { id, status: 'WAITING', waitingNodeId: this.nodeOrder[r.idx] ?? null }
  }

  async startRun(_workflowName: string): Promise<LemmaRunView> {
    const id = `fake-run-${++this.seq}`
    this.runs.set(id, { idx: 0, status: this.nodeOrder.length ? 'WAITING' : 'COMPLETED' })
    return this.view(id)
  }

  async getRun(runId: string): Promise<LemmaRunView> {
    if (!this.runs.has(runId)) throw new Error(`unknown run ${runId}`)
    return this.view(runId)
  }

  async submitForm(runId: string, nodeId: string, _inputs?: Record<string, unknown>): Promise<LemmaRunView> {
    const r = this.runs.get(runId)
    if (!r) throw new Error(`unknown run ${runId}`)
    const expected = this.nodeOrder[r.idx]
    if (nodeId !== expected) throw new Error(`node mismatch: expected ${expected}, got ${nodeId}`)
    if (this.failAtNode && nodeId === this.failAtNode) {
      r.status = 'FAILED'
      return this.view(runId)
    }
    r.idx += 1
    r.status = r.idx >= this.nodeOrder.length ? 'COMPLETED' : 'WAITING'
    return this.view(runId)
  }

  async cancel(runId: string): Promise<void> {
    const r = this.runs.get(runId)
    if (r) r.status = 'CANCELLED'
  }
}
