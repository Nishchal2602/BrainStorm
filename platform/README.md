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

Verify the core without the browser: `npx tsx scripts/e2e.ts` (exercises services,
state machines, timeline, file storage, and access control against the DB).

## What's built (this phase)
- **CRUD + UI:** Products, Features (with stage transitions), PRD upload, Review-run shells
  (created `Pending` — agents run later), Decisions (`Proposed` → approve/reject), Files, Members.
- **State machines** (`src/server/stateMachines`) enforce Feature/PRD/ReviewRun/Decision/Product
  lifecycles; every mutation writes a **Timeline** event (`src/server/timeline.ts`).
- **Auth** (`src/lib/auth.ts`) — credentials + JWT; membership-gated access (`src/server/access.ts`).

## Deferred (still under design)
Agent execution / review orchestration (PMReview, CustomerEvidence, Competitors, Findings
tables exist as models only), polished approval routing, and Experiments (out of scope).

> Prisma 7 note: the DB URL lives in `prisma.config.ts` (not `schema.prisma`); the runtime
> client uses the `@prisma/adapter-pg` driver adapter (`src/lib/db.ts`).
