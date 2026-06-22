import type { DetectedSource } from '@/lib/types'

/** Detect the kind of page from its URL alone (runs in the service worker, no DOM). */
export function detectSource(url: string): DetectedSource {
  let host = ''
  let path = ''
  try {
    const u = new URL(url)
    host = u.hostname.toLowerCase()
    path = u.pathname.toLowerCase()
  } catch {
    return 'generic'
  }

  if (host.endsWith('notion.so') || host.endsWith('notion.site')) return 'notion'
  if (host === 'linear.app' || host.endsWith('.linear.app')) return 'linear'
  if (host === 'docs.google.com') return 'gdocs'

  if (host.endsWith('atlassian.net') || host.includes('jira') || host.includes('confluence')) {
    // Confluence lives under /wiki on Atlassian Cloud; Jira issues under /browse or /jira.
    if (path.startsWith('/wiki') || host.includes('confluence')) return 'confluence'
    return 'jira'
  }

  return 'generic'
}

export const SOURCE_LABEL: Record<DetectedSource, string> = {
  jira: 'Jira Ticket',
  confluence: 'Confluence Page',
  notion: 'Notion Doc',
  linear: 'Linear Issue',
  gdocs: 'Google Doc',
  generic: 'Web Page',
}
