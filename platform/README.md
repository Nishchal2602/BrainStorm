# Pocket PM Platform

The persistent, AI-native **Product Operating System** — a Next.js full-stack monolith
(App Router + Prisma + PostgreSQL + Auth.js) where product knowledge, decisions and
(soon) agents evolve over time. This is the **foundation**: schema for all 14 data-dictionary
tables, a state-machine layer, a timeline event log, auth, file storage, and the workspace UI.

Lives alongside the Pocket PM Chrome extension (repo root) but is fully self-contained.

## Stack
Next.js (App Router, TS) · Prisma 7 + PostgreSQL · Auth.js v5 (email/password, JWT) ·
Tailwind v4 · zod · file storage (local disk in dev, S3-compatible in prod).

## Run it

```bash
cd platform
cp .env.example .env          # adjust AUTH_SECRET for anything non-local

# 1) Start Postgres (no Docker needed — embedded Postgres on :54329)
npm run db                    # leave running;  OR:  docker compose up -d

# 2) Apply the schema
npm run prisma:migrate        # prisma migrate dev

# 3) Dev server
npm run dev                   # http://localhost:3000  → sign up → create a product
```

Verify without the browser (DB up): `npx tsx scripts/e2e.ts` (services/state-machines/timeline/
storage/access), `npx tsx scripts/e2e-review.ts` (full review pipeline → persisted results),
`npx tsx scripts/e2e-lemma-review.ts` (the Lemma execution path via a fake client, no Docker).

## What's built
- **CRUD + UI:** Products, Features (stage transitions), PRD upload, Decisions
  (`Proposed` → approve/reject), Files, Members.
- **Review orchestration:** **Review PRD** runs the Pocket PM agents end-to-end
  (Shared Analysis → PM Review → Customer Voice → Competitor → Recommendation) via
  `src/server/reviewOrchestrator.ts`, persisting PMReview/CustomerEvidence/Competitor+Snapshot/
  Findings/Decision; the Feature page polls live per-agent progress.
- **State machines** (`src/server/stateMachines`) enforce lifecycles; every mutation writes a
  **Timeline** event (`src/server/timeline.ts`).
- **Auth** (`src/lib/auth.ts`) — credentials + JWT; membership-gated access (`src/server/access.ts`).

## Review execution engine (Lemma optional)
By default reviews run **in-process** (the orchestrator above). You can instead have the review
execute as a **real [Lemma](https://github.com/lemma-work/lemma-platform) workflow** — an
**additive, opt-in** path behind `LEMMA_ENABLED`:

| Lemma owns | Pocket PM owns |
|---|---|
| Workflow graph, run lifecycle, step sequencing, run status | Agent compute (Gemini), persistence, ReviewRun mirror, timeline, UI |

Lemma's steps run inside its own runtime and can't call our TypeScript agents, so we use Lemma
as the **workflow engine that sequences** the 5 steps (one `FORM` node each): the
`LemmaReviewRunner` (`src/server/lemma/`) starts a Lemma run, and for each step runs the existing
agent in-app + persists, then advances the run with `submitForm`. The Feature page shows a
**"Executed using Lemma Workflow"** card. If Lemma is disabled, unconfigured, or unreachable, the
review **automatically falls back** to the in-process orchestrator — so the Lemma stack is never a
hard dependency. The existing orchestrator and the agents are **unchanged**.

Setup (Docker + the Lemma stack) and env vars: **`lemma/README.md`**. Validate connectivity with
`npm run lemma:spike`.

## Deferred (still under design)
Polished approval routing; Experiments (out of scope); binary-PRD text extraction (markdown/text PRDs only).

> Prisma 7 note: the DB URL lives in `prisma.config.ts` (not `schema.prisma`); the runtime
> client uses the `@prisma/adapter-pg` driver adapter (`src/lib/db.ts`).
