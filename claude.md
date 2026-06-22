# PM Co-Pilot — Project Context

## Product Overview

PM Co-Pilot is an AI-powered Chrome Extension designed to help Product Managers reduce repetitive operational work and spend more time on product thinking, stakeholder management, and decision-making.

The extension acts as an intelligent layer on top of a PM's daily workflow, helping them understand information faster, extract insights, and generate common product artifacts instantly.

The goal is to become the default AI companion for Product Managers across tools such as Jira, Confluence, Notion, Linear, GitHub, Slack, Google Docs, and product documentation websites.

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

Users can invoke the extension while viewing:

* Jira tickets
* Confluence pages
* Notion docs
* PRDs
* Technical documentation
* GitHub pull requests
* Product requirement documents
* Competitor websites

The extension understands page content and generates PM-focused outputs.

---

# Target Users

## Primary Users

### Product Managers

* Associate Product Managers
* Product Managers
* Senior Product Managers
* Group Product Managers

---

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

# MVP Features

## 1. Page Summarization

### User Flow

User opens any webpage.

Clicks:

```text
Summarize Page
```

System generates:

* Executive Summary
* Key Insights
* Risks
* Open Questions

---

## 2. Action Item Extraction

### User Flow

User opens:

* Meeting notes
* PRD
* Ticket
* Documentation

Clicks:

```text
Extract Action Items
```

System returns:

* Tasks
* Owners (if identifiable)
* Priority
* Due dates (if mentioned)

---

## 3. Slack Update Generator

### User Flow

User opens:

* Jira ticket
* GitHub PR
* Linear task

Clicks:

```text
Generate Slack Update
```

Output:

```text
🚀 Progress Update

Completed:
...

In Progress:
...

Blocked:
...
```

---

## 4. PRD Skeleton Generator

### User Flow

User opens:

* Feature request
* Ticket
* Customer feedback thread

Clicks:

```text
Generate PRD
```

System generates:

* Problem Statement
* Goals
* User Stories
* Success Metrics
* Risks
* Open Questions

---

# Product Principles

## Principle 1

Context Before Generation

The AI should first understand the page before producing output.

---

## Principle 2

Speed Matters

All actions should complete within a few seconds.

The extension should feel instantaneous.

---

## Principle 3

Minimize User Input

The extension should infer as much context as possible from the page.

Users should not need to repeatedly explain context.

---

## Principle 4

Professional Output

Generated content should be ready for work usage.

Outputs should require minimal editing.

---

# Technical Architecture

## Frontend

Chrome Extension

Stack:

* React
* TypeScript
* TailwindCSS
* Vite

---

## AI Layer

Primary Model:

* Claude API

Responsibilities:

* Summarization
* Extraction
* Draft generation
* PRD creation

---

## Backend (Optional MVP)

Node.js or FastAPI

Responsibilities:

* API proxy
* Rate limiting
* Usage tracking
* Prompt orchestration

---

## Data Flow

```text
User Opens Page
        ↓
Content Extracted
        ↓
Page Context Builder
        ↓
Prompt Constructor
        ↓
Claude API
        ↓
Structured Response
        ↓
Extension UI
```

---

# Future Features


## Multi-page intelligence

PRD
+
Jira Epic
+
Design Doc
+
Customer Feedback

→ Single recommendation


## Company context

Previous PRDs
Roadmap
Strategy
Metrics

→ Recommendations aware of organizational context



## Agentic PM

Research
↓
Generate PRD
↓
Generate Tickets
↓
Generate Success Metrics
↓
Generate Launch Plan

# Success Metrics

## User Metrics

* Weekly Active Users
* Daily Active Users
* Retention

---

## Product Metrics

* Summaries Generated
* Action Items Extracted
* Slack Updates Generated
* PRDs Generated

---

## Business Metrics

* Chrome Store Installs
* Conversion Rate
* Paid Subscribers
* Team Accounts

---

# MVP Definition

The MVP is successful when:

1. Users can install from Chrome Store.
2. Users can summarize any page.
3. Users can extract action items.
4. Users can generate Slack updates.
5. Users can generate PRD skeletons.
6. At least 10 real PMs use it repeatedly.

The objective of MVP is validation, not perfection.
