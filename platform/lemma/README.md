# Lemma integration — running Pocket PM reviews on a real Lemma workflow

Pocket PM can execute the PRD review as a **real [Lemma](https://github.com/lemma-work/lemma-platform) workflow run**. This is an **opt-in, additive** path: when it's off or unavailable, reviews run on the existing in-process orchestrator exactly as before.

## How it works (the "shell" model)

Lemma is a standalone platform (Python backend + Next.js frontend) whose workflow steps run **inside its own runtime** — it has no node type that calls out to our Next.js code, and the TS SDK is a **client**, not a step executor. So Lemma cannot run our TypeScript/Gemini agents directly.

Instead, Pocket PM uses Lemma as the **workflow engine that sequences** the review, and runs the agents itself:

```
Review PRD → Pocket PM starts the `pocket-pm-review` Lemma run
           → Lemma WAITs on FORM node "sharedAnalysis"
           → Pocket PM runs DocumentAnalyzer, persists, submitForm(sharedAnalysis) ──┐
           → Lemma WAITs on "pmReview" → run PM Review agent, persist, submitForm ────┤  (repeat per node)
           → … customerVoice … competitor … recommendation …                         │
           → Lemma run COMPLETED → ReviewRun Completed                               ─┘
```

| Lemma owns | Pocket PM owns |
|---|---|
| Workflow graph, run lifecycle, node sequencing, step history, run status | Agent compute (Gemini), persistence (Prisma), ReviewRun mirror, timeline, UI |

Each of the 5 nodes is a `FORM` node: the run suspends `WAITING` on it, the app runs that agent + persists via the existing persistence layer, then advances with `submitForm(node_id)`. Node ids **must** match the runner's stage keys: `sharedAnalysis`, `pmReview`, `customerVoice`, `competitor`, `recommendation`.

## One-time setup (requires Docker or Podman)

1. **Install + start the Lemma stack** (runs Postgres/Redis/SuperTokens + the FastAPI backend + frontend locally):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/lemma-work/lemma-platform/main/install.sh | bash
   lemma-stack start          # backend at http://127-0-0-1.sslip.io:8711
   ```
2. **Authenticate + select the local server** (writes a token to `~/.lemma/config.json`):
   ```bash
   lemma auth login
   lemma servers select local
   ```
3. **Create a pod and import this workflow.** The canonical way to get a valid skeleton is to scaffold, then keep our 5 node ids:
   ```bash
   lemma pod init pocket-pm --with-starter      # creates a pod; note its pod id
   lemma workflow init pocket-pm-review         # scaffolds workflows/pocket-pm-review/pocket-pm-review.json
   # Replace the scaffolded nodes/edges with the ones in this repo:
   #   platform/lemma/pod/workflows/pocket-pm-review/pocket-pm-review.json
   lemma pods import .                           # from the pod directory
   ```
   (If your Lemma version's workflow schema differs from the reference JSON here, prefer the scaffolded shape and just ensure the five FORM node **ids** are exactly the stage keys above.)
4. **Get a headless token.** Copy the access token from `~/.lemma/config.json` (or your CLI auth output) for the env below.

## Wire Pocket PM to Lemma

In `platform/.env`:
```bash
LEMMA_ENABLED="true"
LEMMA_BASE_URL="http://127-0-0-1.sslip.io:8711"
LEMMA_AUTH_URL="http://127-0-0-1.sslip.io:8711/auth"
LEMMA_POD_ID="<your pod id>"
LEMMA_TOKEN="<access token>"
LEMMA_WORKFLOW_NAME="pocket-pm-review"
```
Restart `npm run dev`. Now **Review PRD** starts a real Lemma run; the Feature page shows a **Workflow Execution** card (engine Lemma · workflow id · per-step ✓). Inspect the run independently with:
```bash
lemma workflow runs get <run-id>
```

## Turning it off / fallback

Set `LEMMA_ENABLED="false"` (or leave the vars blank) and reviews use the in-process orchestrator. The Lemma runner also **auto-falls-back** to the orchestrator if the stack is unreachable when a review starts — so a down Lemma never blocks reviews.

## Note: Gemini key stays in Pocket PM

Because Lemma only sequences (it runs no LLM in this model), you do **not** configure a model key in Lemma. The agents call Gemini using Pocket PM's own `GEMINI_API_KEY`.
