// The seam between our review driver and Lemma. The runner depends ONLY on this
// interface — never on `lemma-sdk` directly — so (a) tests/CI use a FakeLemmaClient
// with no Docker stack, and (b) the SDK's browser-oriented deps never leak into the
// build or the in-process fallback path.
//
// Shapes mirror the real SDK (lemma-sdk WorkflowRunResponse / FlowRunStatus), reduced
// to exactly what the FORM-gated shell needs.

export type LemmaRunStatus = 'PENDING' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

/** Reduced view of a Lemma workflow run. */
export interface LemmaRunView {
  id: string
  status: LemmaRunStatus
  /**
   * node_id of the FORM the run is currently WAITING on (human form wait), or null.
   * The driver runs the matching agent and advances with submitForm(node_id).
   */
  waitingNodeId: string | null
  /** Server error message when the run FAILED. */
  error?: string | null
}

export interface LemmaClientPort {
  /** Start a run of the named workflow. Returns the initial view (typically WAITING on the first FORM). */
  startRun(workflowName: string): Promise<LemmaRunView>
  /** Fetch current run state. */
  getRun(runId: string): Promise<LemmaRunView>
  /** Submit the active FORM (node_id must match the run's active wait) to advance the run. */
  submitForm(runId: string, nodeId: string, inputs?: Record<string, unknown>): Promise<LemmaRunView>
  /** Best-effort cancel (used when the driver aborts mid-run). */
  cancel(runId: string): Promise<void>
}

/** Terminal states the driver stops polling on. */
export const TERMINAL: ReadonlySet<LemmaRunStatus> = new Set(['COMPLETED', 'FAILED', 'CANCELLED'])
