# Pocket PM — native Lemma review (cloud pod)

This turns the PRD review into a **native Lemma app**: five agents run **inside Lemma** on the pod's **default model**, orchestrated by a Lemma **workflow**, writing results to Lemma **tables**. No in-app agents, no Prisma for the review outputs. (This is separate from, and does not touch, the existing FORM-node "shell" workflow in `../pod/`.)

Built from the confirmed cloud API (`https://api.lemma.work/openapi.json`). Resource shapes: `CreateTableRequest`, `CreateAgentRequest`, `WorkflowGraphUpdateRequest`.

## What gets created
- **5 tables** — `pm_reviews`, `customer_evidence`, `competitors`, `findings`, `recommendations` (all keyed by `review_run_id`).
- **5 agents** (default model; `agent_runtime` omitted) — `pocket-pm-analyze`, `-review`, `-customer-voice` (WEB_SEARCH), `-competitor` (WEB_SEARCH), `-synthesis`. Each has instructions + `output_schema` and the `POD` toolset so it writes its own rows.
- **1 workflow** — `pocket-pm-review-native`: `analyze → pm_review → customer_voice → competitor → synthesis → end`, agent nodes fed from `start.payload`.

Everything is in [`resources.json`](./resources.json).

## Apply it

The cloud pod uses SuperTokens session auth (**no durable API key exists** — confirmed against the OpenAPI). The `sAccessToken` expires in ~1h and the browser rotates it, so **grab it fresh and run immediately**:

1. lemma.work → signed in → DevTools → **Network** → any `api.lemma.work` request → copy the **`sAccessToken`** cookie value.
2. ```bash
   LEMMA_TOKEN='<fresh sAccessToken>' node platform/lemma/native/apply.mjs
   ```
   It preflights auth, then creates all 5 tables + 5 agents + the workflow in one shot (409 = already exists → skipped, so re-runs are safe). If it prints `401`, the token already rotated — recopy and rerun.

Alternative (no token juggling): create the same resources in the **Lemma UI** using `resources.json` as the spec, or via the `lemma` CLI (`lemma pods import`) where your login is managed for you.

## Run a review
Start the workflow with the PRD text as payload (the platform extracts PRD text today via `src/server/documentText.ts`, incl. PDF):
```bash
curl -s https://api.lemma.work/pods/$POD/workflows/pocket-pm-review-native/runs \
  -H "authorization: Bearer $LEMMA_TOKEN" -H "content-type: application/json" \
  -d '{"payload":{"review_run_id":"demo-1","prd_text":"<PRD…>","product_name":"…","feature_name":"…"}}'
```
Watch it in the Lemma UI (Workflows → run trace). When it completes, the rows are in the 5 tables (filter by `review_run_id`), readable via `GET /pods/$POD/datastore/tables/<table>/records?...` or `POST /datastore/query`.

## ⚠️ Verify these three (couldn't be tested from here — cloud auth 401'd every server-side replay)
1. **Agents can write their tables.** Agents write via the `POD` toolset per their instructions. If writes are denied by row-level security, grant table write access to each agent (`PUT /pods/$POD/agents/{name}/permissions`, or disable RLS on these tables at create) — the tables are created with `enable_rls` defaulting to **true**.
2. **Run-start payload shape.** Confirm `POST …/workflows/{name}/runs` takes `{ "payload": { … } }` and that `input_mapping` expressions resolve `start.payload.*` (adjust the expression prefix in `resources.json` if the run trace shows unresolved inputs).
3. **Table PK.** Tables define `id` as `UUID auto`. If the pod's convention differs (e.g. auto-added PK, or `SERIAL`), adjust the `id` column / `primary_key_column` in `resources.json`.

## Platform integration (follow-up)
Wiring the Next.js platform to trigger this workflow + read these tables is a **separate step**. Server-side calls from the platform to the cloud pod currently return **401** (the session token can't be replayed server-side; it rotates), so the runtime integration must run **browser-side** via the Lemma TS SDK (cookie auth) — the platform page (a client component) calls `useWorkflowRun().start(...)` and `client.records.list(...)` using the logged-in lemma.work session. That change (and retargeting `src/components/ReviewResults.tsx` to read Lemma tables) is Phase 2, to be done once the pod resources above are verified live.
