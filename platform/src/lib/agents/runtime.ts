/** Error raised when an operation exceeds its time budget. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Timed out after ${ms}ms: ${label}`)
    this.name = 'TimeoutError'
  }
}

/**
 * Races a promise against a timeout. Rejects with TimeoutError if the budget is
 * exceeded. (The underlying work isn't truly cancelled unless the callee honors
 * an AbortSignal — passed via AgentContext.metadata.signal when available.)
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Monotonic-ish clock; falls back to 0 deltas if performance is unavailable. */
export function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0
}
