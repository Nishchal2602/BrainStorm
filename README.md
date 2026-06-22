# PM Co-Pilot

An AI Chrome extension (Manifest V3) that gives Product Managers contextual help on any page — powered by Claude. Ships with an **owner-key model** (a tiny serverless proxy holds the key) so testers use it with **no key of their own**.

It understands the **page type**, adapts to your **PM mode**, and renders **artifact-style cards** — not raw JSON.

## Features

| Feature | Status | What it does |
|---|---|---|
| 🔍 **PM Review** (flagship) | **Active (MVP)** | Reads the page, researches the web with Claude's `web_search` tool, and returns **graded, cited insight cards** (Competitor / Research / Customer Voice / Regulatory — each with **Evidence Type** + **Confidence** badges, framed by the customer's job-to-be-done), plus **Risks**, **Implementation Considerations**, a prominent **Critical Unknowns** card, and an **"If I were the PM"** recommendation. |
| ✅ Action Items | Soon | Atomic, owned, prioritized tasks (with due-date inference). |
| 💬 Slack Update | Soon | Completed / In Progress / Blocked, with precise state definitions. |
| 📄 Summarize | Soon | Executive summary, key insights with implications, ranked risks, open questions. |

The MVP ships **PM Review only**; the other three are visible as **"Soon"** (code + prompts are in place — launching them is flipping a `comingSoon` flag).

Plus: a first-class **"Detected: …" page-type badge** (Jira / Confluence / Notion / Linear / Google Doc / Web), **PM Modes** (Product Manager / Founder / Product Analyst), a **Research Depth** selector for PM Review (Quick / Standard / Deep → web-search budget 3 / 8 / 15), and **History**.

**Per-user limits:** each user gets **3 Quick / 2 Standard / 1 Deep** PM Reviews (total, no reset), enforced server-side by the proxy. When exhausted, the panel shows a "full version coming soon" banner.

## Architecture

React 18 · TypeScript · TailwindCSS · Vite · `@crxjs/vite-plugin` (MV3). The service worker calls the model through a single `ClaudeClient` seam. The backend is chosen at build time, in this precedence:

- **Gemini mode (MVP / validation):** set `VITE_GEMINI_API_KEY` and the extension calls Google Gemini directly for every action (the UI model picker is ignored). Research Depth maps to grounding thoroughness + token budget. → `GeminiClient`. Simplest path — no proxy to deploy.
- **Owner-key mode (Anthropic, for distribution):** a Cloudflare Worker proxy (`proxy/`) holds your key server-side, enforces per-user (3/2/1) + global daily caps, and forwards to Anthropic. The extension sends a shared secret + a per-install id. → `ProxyClaudeClient`.
- **BYOK fallback (local dev):** if neither is configured at build time, users paste their own Anthropic key (Settings → Advanced). → `DirectClaudeClient`.

### Gemini mode (fastest way to validate)

```bash
cp .env.example .env        # set VITE_GEMINI_API_KEY=<your key from aistudio.google.com/apikey>
npm install && npm run build
```

Load `dist/` unpacked. PM Review then runs on `gemini-2.5-flash` (override with `VITE_GEMINI_MODEL`) using Google Search grounding for citations. **Note:** the key is baked into the bundle (extractable from an installed unpacked extension) — fine for free-tier Gemini validation; for wider distribution, move the key behind the proxy. Set a usage cap in Google AI Studio / Cloud as a backstop.

**Cost posture (Balanced):** Sonnet 4.6 for PM Review, Haiku 4.5 for the other three; PM Review defaults to Quick depth. Page input is capped (~12k chars; ~20k for PM Review) and the instruction-heavy system prompt is **prompt-cached**, so quality is high and ~$5 stretches across ~50–100 calls.

## Try it now — no API key (demo mode)

You can exercise the entire UI before wiring up a key. Demo mode returns **sample outputs** through the real parsers/cards — no API call.

```bash
npm install
npm run build      # leave .env unset
```

Load `dist/` unpacked (see below), open the side panel, and click **"Explore with sample data →"** on the first screen (or toggle **Demo mode** in Settings). Every feature returns a realistic sample so you can test modes, the "Detected: …" badge, cards, Copy, and History. A **DEMO** badge shows while it's on; turn it off in Settings once your key/proxy is live. (You can also force it at build time with `VITE_DEMO_MODE=true`.)

## Prerequisites

- Node 18+
- An Anthropic API key — https://console.anthropic.com/settings/keys
- (Owner-key mode) a free Cloudflare account for the Worker proxy

## Setup

### 1. Deploy the proxy (owner-key mode)

See [`proxy/README.md`](proxy/README.md). In short: create a KV namespace, `wrangler secret put ANTHROPIC_API_KEY` and `PROXY_SHARED_SECRET`, `wrangler deploy`, copy the `*.workers.dev` URL. Also set a low **monthly workspace spend limit** at `console.anthropic.com/settings/limits` as a backstop.

### 2. Build the extension

```bash
npm install
cp .env.example .env        # set VITE_PROXY_URL + VITE_PROXY_SECRET (owner-key mode)
                            # leave them empty to build in BYOK dev mode
npm run build               # typecheck + production build → dist/
```

### 3. Load it

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `dist/`
3. Click the **PM Co-Pilot** toolbar icon on any web page → the side panel opens
4. Owner-key mode: it just works (no key prompt). BYOK mode: Settings → Advanced → paste your key.

### Dev mode (HMR)

```bash
npm run dev
```

## Verify it works

1. **Proxy** (owner-key mode): `curl` it with the right `X-Extension-Secret` → 200; wrong/absent → 401; over the daily cap → 429 (see `proxy/README.md`).
2. **Zero-key UX:** fresh install → a feature runs without entering any key.
3. **Trust check:** open a Jira ticket, a Notion doc, and a Linear issue → the badge reads the correct "Detected: …".
4. **Flagship:** on a product page, pick a Mode + Research Depth, click **PM Review** → cited insight cards (with Confidence + Evidence Type), Risks, Implementation Considerations, Critical Unknowns, and the "If I were the PM" recommendation. Insights embed real evidence (a stat/quote + source), not vague claims.
5. **Cost posture:** in `wrangler tail`, confirm Action Items/Slack/Summarize run on Haiku and PM Review on Sonnet, and that PM Review continuations show `cache_read_input_tokens > 0`.
6. **Other features** + **History** + **Copy** all work; Mode changes shift tone.

## Notes / security

- **Why a proxy:** a key embedded in the extension bundle is trivially extractable, and Anthropic's spend limit is monthly/workspace-wide (not an instant cap). The proxy keeps the key server-side and rotatable.
- **Honest caveat:** the `X-Extension-Secret` also ships in the bundle, so it only deters casual abuse — the **Worker's global daily call cap is what actually bounds spend.** Keep it low for a $5 demo.
- Page extraction is a self-contained DOM reader injected on demand (no content script runs until you invoke a feature).
- **Out of scope (MVP):** per-user auth, usage dashboard, Stripe (the proxy is the foundation), streaming, Web Store submission. Future per `CLAUDE.md`: multi-page intelligence, company context, agentic PM.
```
