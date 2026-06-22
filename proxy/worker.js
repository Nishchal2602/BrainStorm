/**
 * PM Co-Pilot — Anthropic API proxy (Cloudflare Worker).
 *
 * Holds the owner's Anthropic API key server-side so the extension can ship
 * without per-user keys. The extension sends X-Extension-Secret; the Worker
 * validates it, enforces daily call caps (global + per-IP) via Workers KV to
 * bound spend, then forwards the request verbatim to the Anthropic Messages API.
 *
 * Secrets / vars (set with `wrangler secret put` / wrangler.toml):
 *   ANTHROPIC_API_KEY    (secret)  — the owner's key, never exposed to clients
 *   PROXY_SHARED_SECRET  (secret)  — must match the extension's VITE_PROXY_SECRET
 *   GLOBAL_DAILY_CAP     (var)     — max calls/day across everyone (default 40)
 *   PER_IP_DAILY_CAP     (var)     — max calls/day per IP (default 10)
 *   QUICK_CAP            (var)     — PM Reviews per user at Quick depth, total (default 3)
 *   STANDARD_CAP         (var)     — PM Reviews per user at Standard depth, total (default 2)
 *   DEEP_CAP             (var)     — PM Reviews per user at Deep depth, total (default 1)
 *   RL                   (KV)      — namespace for rate-limit counters
 *
 * The extension sends X-Client-Id (per-install id) and X-PM-Depth (quick|standard|deep);
 * per-user caps are total (no reset). The global daily cap is the spend backstop.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

function cors(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-extension-secret, x-client-id, x-pm-depth, anthropic-beta',
    'access-control-max-age': '86400',
    ...extra,
  }
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors(extra) },
  })
}

function todayKey() {
  // UTC day bucket, e.g. "2026-06-17"
  return new Date().toISOString().slice(0, 10)
}

async function readCount(kv, key) {
  return parseInt((await kv.get(key)) || '0', 10)
}

async function bump(kv, key, ttlSeconds) {
  const next = (await readCount(kv, key)) + 1
  await kv.put(key, String(next), { expirationTtl: ttlSeconds })
  return next
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() })
    }
    if (request.method !== 'POST') {
      return json(405, { error: { message: 'Method not allowed' } })
    }

    // 1. Auth: shared secret (deters casual abuse; the daily cap is the real guard).
    const secret = request.headers.get('x-extension-secret') || ''
    if (!env.PROXY_SHARED_SECRET || secret !== env.PROXY_SHARED_SECRET) {
      return json(401, { error: { message: 'Unauthorized' } })
    }

    // 2. Rate limiting (bounds spend even if the secret leaks). This is the
    //    real spend guard — fail CLOSED if the KV binding is missing, otherwise
    //    a misconfigured deploy would forward unlimited traffic.
    if (!env.RL) {
      return json(503, { error: { message: 'Proxy not fully configured (rate limiter unavailable).' } })
    }
    const day = todayKey()
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    const clientId = request.headers.get('x-client-id') || ip
    const depth = (request.headers.get('x-pm-depth') || '').toLowerCase()
    const globalCap = parseInt(env.GLOBAL_DAILY_CAP || '40', 10)
    const perIpCap = parseInt(env.PER_IP_DAILY_CAP || '10', 10)
    const depthCaps = {
      quick: parseInt(env.QUICK_CAP || '3', 10),
      standard: parseInt(env.STANDARD_CAP || '2', 10),
      deep: parseInt(env.DEEP_CAP || '1', 10),
    }
    const dayTtl = 172800 // 48h, comfortably past the UTC day
    const userTtl = 31536000 // ~1 year — per-user caps are total ("no reset")

    // Check BEFORE incrementing so rejected requests don't burn quota.
    const curGlobal = await readCount(env.RL, `count:${day}`)
    if (curGlobal >= globalCap) {
      return json(429, {
        error: { message: 'Daily demo limit reached for PM Co-Pilot. Try again tomorrow.' },
      })
    }
    const curIp = await readCount(env.RL, `ip:${day}:${ip}`)
    if (curIp >= perIpCap) {
      return json(429, {
        error: { message: 'You have hit the daily limit for the shared demo key.' },
      })
    }
    // Per-user, per-depth allowance (total, no reset). Skips if depth is unknown.
    let userKey = null
    if (depthCaps[depth] !== undefined) {
      userKey = `u:${clientId}:${depth}`
      const curUser = await readCount(env.RL, userKey)
      if (curUser >= depthCaps[depth]) {
        return json(429, {
          error: {
            type: 'demo_allowance_exhausted',
            message: "You've used your free PM Reviews — the full version is coming soon.",
          },
        })
      }
    }
    // All caps have room — count this allowed request.
    await bump(env.RL, `count:${day}`, dayTtl)
    await bump(env.RL, `ip:${day}:${ip}`, dayTtl)
    if (userKey) await bump(env.RL, userKey, userTtl)

    // 3. Forward to Anthropic with the owner's key.
    let bodyText
    try {
      bodyText = await request.text()
    } catch {
      return json(400, { error: { message: 'Invalid request body' } })
    }

    const upstreamHeaders = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    }
    // Forward a beta header if the extension sends one (future-proofing).
    const beta = request.headers.get('anthropic-beta')
    if (beta) upstreamHeaders['anthropic-beta'] = beta

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: upstreamHeaders,
      body: bodyText,
    })

    const respText = await upstream.text()

    // 4. Lightweight burn-rate log (visible in `wrangler tail`).
    try {
      const parsed = JSON.parse(respText)
      const u = parsed.usage || {}
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          ip,
          status: upstream.status,
          model: parsed.model,
          input_tokens: u.input_tokens,
          output_tokens: u.output_tokens,
          cache_read_input_tokens: u.cache_read_input_tokens,
        }),
      )
    } catch {
      /* non-JSON (e.g. error) — skip logging body */
    }

    return new Response(respText, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', ...cors() },
    })
  },
}
