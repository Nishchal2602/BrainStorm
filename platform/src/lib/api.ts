/** Tiny client-side fetch helper for JSON API routes. Throws Error(message) on failure. */
export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `Request failed (${res.status})`)
  return data as T
}
