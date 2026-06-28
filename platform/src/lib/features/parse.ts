import type { Confidence, EvidenceType, Section, SourceRef } from '@/lib/types'

export function isBullet(line: string): boolean {
  return /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)
}

/** Parse a JSON object from model text, tolerating accidental code fences. */
export function parseJsonObject<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
  return JSON.parse(cleaned) as T
}

export function cleanBullet(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
}

const CONFIDENCES: Confidence[] = ['High', 'Medium', 'Low']

export function asConfidence(raw: string): Confidence | undefined {
  const v = raw.trim().toLowerCase()
  return CONFIDENCES.find((c) => c.toLowerCase() === v)
}

export function asEvidenceType(raw: string): EvidenceType | undefined {
  const v = raw.trim().toLowerCase()
  if (v.includes('research') || v.includes('academ') || v.includes('paper')) return 'Research Paper'
  if (v.includes('customer') || v.includes('voice') || v.includes('user') || v.includes('social'))
    return 'Customer Voice'
  if (v.includes('competitor') || v.includes('competit')) return 'Competitor'
  if (v.includes('regulat') || v.includes('complian') || v.includes('legal')) return 'Regulatory'
  return undefined
}

export function sourcesCard(sources: SourceRef[]): Section | null {
  if (!sources.length) return null
  return {
    heading: 'Sources',
    tone: 'sources',
    bullets: sources.map((s) => (s.title ? `${s.title} — ${s.url}` : s.url)),
  }
}

/** Flatten a result into copy-friendly plain text. */
export function sectionsToCopyText(title: string, sections: Section[]): string {
  const out: string[] = [title, '']
  for (const s of sections) {
    out.push(s.heading)
    const badges = [s.evidenceType, s.confidence ? `Confidence: ${s.confidence}` : '']
      .filter(Boolean)
      .join(' · ')
    if (badges) out.push(badges)
    if (s.body) out.push(s.body)
    if (s.bullets) for (const b of s.bullets) out.push(`• ${b}`)
    if (s.sourceUrl) out.push(`Source: ${s.sourceUrl}`)
    out.push('')
  }
  return out.join('\n').trim()
}
