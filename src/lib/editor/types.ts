import type { PatchAnchor } from '@/lib/features/pmReview'

// Shared contracts for the document-editor layer (Phase 2.5 — apply AI Drafts
// to the live document via the DOM). Provider-neutral; NotionEditor is the only
// implementation today.

export interface ApplyResult {
  success: boolean
  /** Human-readable, shown in the UI. */
  reason?: string
  /** Machine reason, logged + recorded (see the error taxonomy). */
  code?: string
  insertedBlocks?: number
  /** Section hash AFTER a successful apply — the UI refreshes patch.anchor.sectionHash with it. */
  newSectionHash?: string
  /** Heading blockId actually used — the UI caches it on the anchor (session fast path). */
  headingBlockId?: string
  /** Which InsertStrategy landed the edit ('execCommand' | 'inputEvent' | 'clipboard'). */
  strategyUsed?: string
}

export interface ApplyRequest {
  action: 'append' | 'replace'
  /** Locally-derived anchor (never model-supplied); sectionHash is the change gate. */
  anchor: PatchAnchor
  /** Action-driven body: appendBody / replacementBody semantics. */
  body: string
}
