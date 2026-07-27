import type { Industry } from '@/lib/types'

// Entity → Obligation → Coverage.
//
// The review is good at judging what is WRITTEN and bad at noticing what is
// ABSENT, because absence isn't salient. "What's missing?" is an open creative
// task; "is the file format specified?" is a closed question. These packs turn the
// second into the review's actual job: detect the entities a PRD mentions, look up
// the attributes those entities oblige it to specify, and check each one.
//
// Authored data, not model output. A wrong obligation is a data fix.

/** One thing a PRD must state for a detected entity to be buildable/compliant. */
export interface Obligation {
  /** Stable id, `pack.attribute` — e.g. 'file_ingestion.format'. */
  id: string
  /** Human label — "File format". */
  attribute: string
  /** What the PRD must actually say. Becomes the model's instruction. */
  ask: string
  /** The consequence of leaving it unstated. Becomes the finding's "why". */
  why: string
  severity: 'critical' | 'medium' | 'minor'
  /**
   * Evidence that this attribute is ALREADY specified. Matched against the FULL
   * untruncated document; a hit suppresses the obligation entirely.
   *
   * This is the guard that makes omission detection safe. The model only ever sees
   * a truncated document, so asking it "is X specified?" invites a false MISSING
   * when X lives in the omitted middle — and inventing missing requirements
   * destroys trust faster than missing real ones. The probe runs over the complete
   * text, so we never claim absence for something we simply couldn't show.
   */
  probe: RegExp[]
}

export interface ObligationPack {
  id: string
  label: string
  kind: 'technical' | 'compliance'
  /** Entity triggers — does this PRD talk about this thing at all? */
  detect: RegExp[]
  /** Extra gating. Compliance packs use this so a SaaS PRD never sees card rules. */
  appliesWhen?: { industry?: Industry[] }
  /**
   * Provenance, compliance packs only — "PCI DSS v4.0 §3.3". Surfaced in the
   * finding so a claim can be checked, and the slot a user-supplied policy
   * document fills later without any code change.
   */
  source?: string
  obligations: Obligation[]
}

/** An unmet obligation, with where its entity was mentioned. */
export interface ObligationGap {
  packId: string
  packLabel: string
  kind: 'technical' | 'compliance'
  source?: string
  obligation: Obligation
  /**
   * Heading of the section that mentioned the entity — so the draft targets the
   * section the reader would expect, instead of the model picking one.
   */
  targetHeading?: string
}
