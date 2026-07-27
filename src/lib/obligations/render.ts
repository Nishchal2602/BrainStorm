import type { ObligationGap } from './types'

/**
 * Render unmet obligations as the prompt's COVERAGE CHECKLIST.
 *
 * Framed as closed questions with an explicit reject path. The reject path matters:
 * detection is deliberately generous, so some items WILL already be covered in
 * wording the probe didn't recognise — the model must be able to drop those rather
 * than manufacture a gap to satisfy the checklist.
 */
export function renderCoverageChecklist(gaps: ObligationGap[]): string {
  if (!gaps.length) return ''

  const byPack = new Map<string, ObligationGap[]>()
  for (const g of gaps) {
    const list = byPack.get(g.packLabel) ?? []
    list.push(g)
    byPack.set(g.packLabel, list)
  }

  const blocks: string[] = []
  for (const [packLabel, items] of byPack) {
    const first = items[0]
    const head = [
      `${packLabel}${first.kind === 'compliance' ? ' — COMPLIANCE' : ''}`,
      first.source ? `  reference: ${first.source}` : undefined,
      first.targetHeading ? `  mentioned under: "${first.targetHeading}"` : undefined,
    ].filter(Boolean)
    const lines = items.map(
      (g) =>
        `  - [${g.obligation.severity}] ${g.obligation.attribute}: ${g.obligation.ask}\n    (matters because: ${g.obligation.why})`,
    )
    blocks.push([...head, ...lines].join('\n'))
  }

  return `COVERAGE CHECKLIST — this document mentions the following things, and a deterministic scan of the FULL document found NO statement of these specific attributes.

For EACH item: if the document genuinely does not state it, report it as an issue in the matching bucket (${'technical'} or ${'compliance'}) and, where useful, target the section named above. If the document DOES state it in wording the scan missed, SILENTLY SKIP the item — do not invent a gap to satisfy this list, and do not mention that you skipped it.

${blocks.join('\n\n')}`
}
