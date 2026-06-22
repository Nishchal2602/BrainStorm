# PM Co-Pilot — Anthropic proxy (Cloudflare Worker)

A ~100-line stateless Worker that holds the owner's Anthropic API key server-side so the extension can ship **without per-user keys**. It validates a shared secret, enforces daily call caps (global + per-IP) via Workers KV to bound spend, then forwards requests to the Anthropic Messages API.

## Why a proxy (not an embedded key)

A key embedded in the extension bundle is **trivially extractable** by anyone who installs it, and Anthropic's spend limit is **monthly/workspace-wide**, not an instant cap — so an exposed key could burn the whole month's budget in a day. The proxy keeps the key off the client and lets you **rotate it instantly**.

> **Honest note:** the `X-Extension-Secret` is also shipped in the extension bundle, so it only deters casual abuse. The **global daily call cap in KV is what actually bounds spend.** Keep it low for a $5 demo (e.g. 40/day). Also set a low **monthly workspace spend limit** at `console.anthropic.com/settings/limits` as defense-in-depth.

## Deploy

```bash
cd proxy
npm install -g wrangler            # or: npx wrangler ...
wrangler login

# 1. Create the KV namespace and paste the printed id into wrangler.toml
wrangler kv namespace create RL

# 2. Set secrets (the key is never committed)
wrangler secret put ANTHROPIC_API_KEY      # your Anthropic key
wrangler secret put PROXY_SHARED_SECRET    # any random string; must match the extension build

# 3. Deploy
wrangler deploy
# → copy the printed https://pm-copilot-proxy.<subdomain>.workers.dev URL
```

Then build the extension with the proxy wired in (repo root):

```bash
# .env (see .env.example)
VITE_PROXY_URL=https://pm-copilot-proxy.<subdomain>.workers.dev
VITE_PROXY_SECRET=<same value as PROXY_SHARED_SECRET>

npm run build
```

## Tune the caps

- **Global / per-IP daily** (`GLOBAL_DAILY_CAP`, `PER_IP_DAILY_CAP`) — coarse spend backstop.
- **Per-user PM Review allowance** (`QUICK_CAP=3`, `STANDARD_CAP=2`, `DEEP_CAP=1`) — total per user, no reset. The extension sends `X-Client-Id` (per-install id) + `X-PM-Depth`; when a user is out, the Worker returns `429 demo_allowance_exhausted` and the extension shows a "full version coming soon" banner.

Edit `[vars]` in `wrangler.toml` and redeploy. Watch live usage with:

```bash
wrangler tail
```

## Key-security checklist (do this when you generate your key)

- [ ] Create a **dedicated Anthropic workspace + API key** for this proxy (isolated, independently revocable).
- [ ] Set the key **only** as a Worker secret: `wrangler secret put ANTHROPIC_API_KEY`. Never put it in the repo, `.env`, or the extension build — the bundle only ever contains the proxy URL + shared secret, never the Anthropic key.
- [ ] Set a **low monthly workspace spend limit** ($5–$10) at `console.anthropic.com/settings/limits` — the hard backstop.
- [ ] Keep the caps low (per-user 3/2/1 + global 40/day).
- [ ] To rotate after any leak: `wrangler secret put ANTHROPIC_API_KEY` again — no extension reship needed.
- [ ] Verify the built `dist/` contains **no real key**: `grep -roE "sk-ant-(api|oat)[a-zA-Z0-9_-]{20,}" dist || echo clean`. (A bare `sk-ant-...` match is just the input placeholder — ignore it; match the real-key pattern instead.)

## Smoke test

```bash
curl -i https://pm-copilot-proxy.<subdomain>.workers.dev \
  -H 'content-type: application/json' \
  -H 'x-extension-secret: <PROXY_SHARED_SECRET>' \
  -d '{"model":"claude-haiku-4-5","max_tokens":16,"messages":[{"role":"user","content":"ping"}]}'
# 200 + a Claude response. Wrong/absent secret → 401. Over the daily cap → 429.
```
