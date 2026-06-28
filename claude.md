# PM Co-Pilot — Project Context

## Product Overview

PM Co-Pilot is an AI-powered Chrome Extension designed to help Product Managers reduce repetitive operational work and spend more time on product thinking, stakeholder management, and decision-making.

The extension acts as an intelligent layer on top of a PM's daily workflow, helping them understand information faster, extract insights, and generate common product artifacts instantly.

The goal is to become the default AI companion for Product Managers across tools such as Jira, Confluence, Notion, Linear, GitHub, Slack, Google Docs, and product documentation websites.

---

# Pocket PM Platform (`platform/`) — the persistent Product OS

The repo now also contains **`platform/`** — a standalone **Next.js (App Router) + Prisma + PostgreSQL + Auth.js** monolith that turns Pocket PM from a one-time reviewer into a persistent, AI-native **Product Operating System**. It is self-contained (own `package.json`/build) and does **not** affect the extension build.

* **Data model** (`platform/prisma/schema.prisma`): Products, Product Members (RBAC), Features, PRDs (versioned), Review Runs, PM Review, Customer Evidence, Competitors (+ Snapshots), Findings, Decisions, Files, Timeline — plus a `User` table for auth. State machines (`platform/src/server/stateMachines`) enforce Feature/PRD/ReviewRun/Decision/Product lifecycles; **every mutation writes a `Timeline` event**. Business logic lives in `platform/src/server/services/*`; route handlers stay thin.
* **Review orchestration** (`platform/src/server/reviewOrchestrator.ts`): clicking **Review PRD** creates a `ReviewRun` (Pending), then runs the Pocket PM agents **sequentially** — Shared Analysis → PM Review → Customer Voice → Competitor → Recommendation — persisting every output (PMReview, CustomerEvidence, Competitor/Snapshot, Findings, a `Decision` (Proposed), and `ReviewRun.recommendation`). Runs async via Next `after()`; the Feature page polls `ReviewRun.agentStatus` for live per-agent progress (Pending → Running → Completed/Failed). The canonical Shared Analysis is persisted on `ReviewRun.sharedAnalysis`. Persistence (`platform/src/server/persistence.ts`) is kept isolated from AI execution.
* **Agents are reused, not rewritten.** The intelligence engine (`src/lib/agents`, `src/lib/claude`, `src/lib/features/{parse,pmReview,def,quality}`, `src/lib/types`) is **vendored verbatim** into `platform/src/lib/` — AI logic byte-unchanged. The ONLY adaptation is `platform/src/lib/config.ts`, which reads `process.env` (`GEMINI_API_KEY`/`GEMINI_MODEL`) instead of Vite `import.meta.env`. **Do not fork the AI logic**; keep the two copies in sync until they are extracted into a shared package.
* **Recommendation = a `Decision` (Proposed)** per the workflow spec — there is no separate Recommendation table.
* **Run it:** `cd platform && cp .env.example .env` (set `GEMINI_API_KEY` for live reviews) → `npm run db` (embedded Postgres, no Docker; `docker compose up` is an alternative) → `npm run prisma:migrate` → `npm run dev`. Verify the pipeline headlessly with `npx tsx scripts/e2e-review.ts`.
* **Out of scope (hackathon MVP):** approval workflows, PRD editing, collaborative review, notifications/Slack/Jira, continuous monitoring, background-refresh/autonomous jobs, binary-PRD text extraction (markdown/text PRDs only).

---

# Vision

Build the most useful AI assistant for Product Managers.

The product should feel like having a highly competent Associate Product Manager available at all times.

Instead of replacing PMs, the system should amplify their effectiveness by reducing context switching, documentation effort, and communication overhead.

---

# Core Problem

Product Managers spend a significant portion of their day on repetitive work:

* Reading lengthy documentation
* Understanding tickets
* Writing updates
* Creating PRDs
* Extracting action items
* Summarizing meetings and discussions
* Translating technical information into business language

This work is valuable but often low leverage.

The result is:

* Context overload
* Slow decision-making
* Reduced time for strategic thinking
* Increased burnout

---

# Solution

PM Co-Pilot sits inside the browser and provides contextual AI assistance on any page.

It works on any web page, with first-class page-type detection for:

* Jira tickets
* Confluence pages
* Notion docs
* Linear issues
* Google Docs
* Generic web pages (PRDs, technical docs, competitor sites, articles)

GitHub and Slack are future surfaces (not in the current MVP).

The extension understands page content and generates PM-focused outputs.

---

# Target Users

## Primary Users

### Product Managers

* Associate Product Managers
* Product Managers
* Senior Product Managers
* Group Product Managers

## Secondary Users

### Founders

* Startup founders
* Indie hackers
* Product-led operators

### Product Analysts

* Business analysts
* Product operations teams

### Product Marketing Managers

* GTM planning
* Product launch preparation

---

# User Outcomes

Users should be able to:

* Understand long content quickly
* Generate artifacts faster
* Improve communication quality
* Reduce repetitive writing work
* Stay focused on decision-making

---

# Current MVP Scope

The MVP is focused on validating demand from real Product Managers. Build only what is required to validate usage and retention.

**Active now:**

* PM Review (flagship) — the only live feature.

**Built, gated behind a "Soon" flag** (launching = flipping the flag):

* Action Item Extraction
* Slack Update Generation
* Summarization

**Context layer (added):**

* One-time onboarding profile + a lightweight per-review context, injected into PM Review.

**V2 direction (opt-in beta):**

* Deep Intelligence — a lightweight, token-minimal multi-agent path that classifies the doc, runs specialist agents, and returns a build decision (see Product Direction).

Still out of scope:

* Team collaboration features
* Authentication systems / user accounts
* Enterprise permissions
* Databases (browser storage only for now)
* Heavy infrastructure or a workflow-orchestration platform

Note: a single lightweight orchestrator now exists as the opt-in V2 path (≈2 LLM calls per run, no orchestration platform). Keep it minimal — "avoid heavy multi-agent/orchestration infra" still holds.

The objective is validation, not platform completeness.

---

# Flagship Feature

## PM Review

PM Review is the primary differentiator.

The review should behave like a strong Senior Product Manager reviewing work.

Reviews should evaluate:

* Problem clarity
* User understanding
* Success metrics
* Solution quality
* Requirements completeness
* Risks
* Edge cases
* Technical feasibility
* Execution readiness

Reviews should not primarily focus on:

* Grammar
* Formatting
* Writing style

The objective is improving product thinking and execution quality.

PM Review now uses captured context — the onboarding profile plus a per-review feature/problem/target-user/success-metric — to judge whether the proposed solution actually solves the stated problem and achieves the outcome, not just the document in isolation.

An opt-in **Deep Intelligence (beta)** path runs the V2 multi-agent orchestrator and ends in a build decision (see Product Direction).

---

# Product Principles

## Principle 1

Context Before Generation

The AI should first understand the page before producing output.

## Principle 2

Speed Matters

All actions should complete within a few seconds.

The extension should feel instantaneous.

## Principle 3

Minimize User Input

Infer as much context as possible from the page.

Do not repeatedly ask users for information that can be derived automatically.

Deliberate exception: a one-time onboarding profile and a lightweight, prefilled per-review context are captured to make reviews specific. Keep this minimal — single-line fields, autosaved, skippable.

## Principle 4

Professional Output

Generated content should be ready for workplace usage.

Outputs should require minimal editing.

---

# Product Decision Framework

When multiple implementation options exist:

1. Prefer simplicity over extensibility.
2. Prefer shipping over abstraction.
3. Prefer user value over engineering elegance.
4. Prefer explicit code over clever code.
5. Avoid solving hypothetical future problems.
6. Build the smallest solution that can validate a hypothesis.
7. Do not create infrastructure before it is needed.
8. Optimize for learning speed.

---

# Technical Stack

## Frontend

* React
* TypeScript
* TailwindCSS
* Vite

## AI Layer

Provider-agnostic client seam (`createClaudeClient`) that selects the transport by the configured/pasted key:

* **Google Gemini** — the active backend for the MVP/validation (default `gemini-2.5-flash`).
* **Anthropic Claude** — supported (BYOK `sk-ant-…` or the owner-key proxy); auto-detected by key prefix.

Use the latest, most capable models. Keep prompts centralized and token-minimal.

Responsibilities:

* PM Review (web-grounded)
* Document classification + final synthesis (V2 Deep Intelligence)
* Action Items / Slack Updates / Summarization (structured output; currently gated "Soon")

## Backend

Only introduce backend services when required.

Implemented:

* Cloudflare Worker proxy (owner-key mode) — holds the API key server-side, enforces per-user + daily caps. Optional: the extension also supports BYOK and a build-time key.

Potential future responsibilities:

* Usage tracking
* Intelligence Graph sync (see Product Direction)

---

# Engineering Principles

## Code Quality

All code should be production quality.

Prefer:

* Readability
* Simplicity
* Maintainability

Avoid:

* Premature optimization
* Over-abstraction
* Unnecessary complexity

## Architecture

* Keep business logic outside UI components.
* Favor pure functions where possible.
* Reuse existing patterns.
* Keep prompts centralized.
* Avoid duplicated logic.
* Avoid duplicated prompt templates.

## Refactoring

Do not perform large refactors unless explicitly requested.

When modifying code:

* Understand existing patterns first.
* Extend existing systems when reasonable.
* Minimize disruption.

---

# Output Quality Standards

Generated outputs should be:

* Professional
* Structured
* Concise
* Actionable

Avoid:

* Generic AI language
* Excessive disclaimers
* Filler content
* Repetition

The output should feel ready to paste into:

* Slack
* Jira
* Notion
* Confluence
* Product documents

---

# Working Style

Before implementing:

1. Understand the existing codebase.
2. Explain the proposed approach.
3. Identify impacted files.
4. Reuse existing patterns.
5. Implement the smallest viable change.

When uncertain:

* Ask a question.
* Do not make assumptions.

When building:

Think like a startup engineer working directly with the founder.

---

# Git Rules

Before creating any commit:

1. Run:

   git config user.name

   git config user.email

2. Verify:

   user.name = Nishchal Mundotia

   user.email = [nishchalmundotia2002@gmail.com](mailto:nishchalmundotia2002@gmail.com)

3. If values differ:

   * Stop immediately.
   * Ask for confirmation.
   * Do not commit.

4. Never add:

   * Co-authored-by metadata
   * AI attribution
   * Generated-by metadata

5. Never modify git configuration without explicit approval.

---

# Product Direction (V2)

Evolve PM Co-Pilot from a document reviewer into an AI Product Intelligence platform.

## Multi-agent Product Intelligence

An orchestrator classifies the document, decides which specialist agents are relevant (Customer Voice, Research, Competitor, Compliance, Solution Critic, PRD Quality), runs them in parallel, and synthesizes their findings. Agents are contract-only stubs today (no external retrieval); the framework is built so each becomes a real implementation as an isolated change. Token-minimal: only classification + synthesis call the model.

## Recommendation Engine

Synthesis ends in a decision, not just a report: `build` / `build_with_changes` / `validate_first` / `do_not_build`, with confidence and rationale.

## Intelligence Graph (the data moat)

Every run captures structured data — industry, feature category, risks, competitors, pain points, missing requirements, decision. Aggregated across many runs this becomes proprietary product intelligence (e.g. "across N fintech onboarding PRDs, the top missing requirement is fraud scenarios"). Capture is live; the cross-user graph/dashboard + backend sync are future.

---

# Success Metrics

## User Metrics

* Weekly Active Users
* Daily Active Users
* Retention

## Product Metrics

* Summaries Generated
* Action Items Extracted
* Slack Updates Generated
* PRDs Generated
* PM Reviews Generated

## Business Metrics

* Chrome Store Installs
* Conversion Rate
* Paid Subscribers
* Team Accounts

---

# MVP Success Criteria

The MVP is successful when:

1. Users can install from the Chrome Store.
2. Users can summarize any page.
3. Users can extract action items.
4. Users can generate Slack updates.
5. Users can generate PRD skeletons.
6. Users can run PM Reviews.
7. At least 10 real PMs use the product repeatedly.

The objective of the MVP is validation, learning, and retention—not perfection.
