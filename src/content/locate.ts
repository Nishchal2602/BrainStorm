import type { ResolvedTarget } from '@/lib/navigation'

/**
 * Self-contained target locator. Injected into the reviewed tab via
 * chrome.scripting.executeScript({ func: locateAndHighlight, args: [target] }),
 * so it MUST NOT reference module-scope values — the type import is erased and
 * every helper lives nested in the function body (same contract as
 * extractFromPage).
 *
 * Lookup ladder, most → least precise:
 *   1. DOM anchor id (exact)
 *   2. Heading text (normalized exact → ancestor-path disambiguation →
 *      substring → token overlap)
 *   3. Excerpt fuzzy match over body text (TreeWalker)
 * On a hit: smooth-scroll to center + a ~2.5s highlight flash using saved-and-
 * restored inline styles only (no CSS injected into the host page).
 */
export function locateAndHighlight(target: ResolvedTarget): { found: boolean } {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/["'“”‘’`]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const toks = (s: string): string[] => norm(s).split(' ').filter((t) => t.length >= 3)

  const overlap = (a: string, b: string): number => {
    const ta = toks(a)
    const tb = new Set(toks(b))
    if (!ta.length || !tb.size) return 0
    let hit = 0
    for (const t of ta) if (tb.has(t)) hit++
    return hit / Math.min(ta.length, tb.size)
  }

  const visible = (el: HTMLElement): boolean => {
    if (el.closest('nav,header,footer,aside')) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0
  }

  const headingEls = (): HTMLElement[] =>
    (Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')) as HTMLElement[]).filter(
      visible,
    )

  const headingText = (el: HTMLElement): string => (el.innerText ?? '').replace(/\s+/g, ' ').trim()

  /** Ancestor-heading texts for a heading (walk preceding higher-level headings). */
  const pathOf = (el: HTMLElement): string[] => {
    const level = /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 6
    const out: string[] = []
    let want = level - 1
    const all = headingEls()
    for (let i = all.indexOf(el) - 1; i >= 0 && want >= 1; i--) {
      const h = all[i]
      const hl = /^H[1-6]$/.test(h.tagName) ? Number(h.tagName[1]) : 6
      if (hl <= want) {
        out.unshift(headingText(h))
        want = hl - 1
      }
    }
    return out
  }

  const findHeading = (text: string, path: string[]): HTMLElement | null => {
    const wanted = norm(text)
    if (!wanted) return null
    const els = headingEls()

    // Exact normalized match; disambiguate duplicates by ancestor path overlap.
    const exact = els.filter((el) => norm(headingText(el)) === wanted)
    if (exact.length === 1) return exact[0]
    if (exact.length > 1) {
      if (path.length) {
        const scored = exact
          .map((el) => ({ el, s: overlap(path.join(' '), pathOf(el).join(' ')) }))
          .sort((a, b) => b.s - a.s)
        return scored[0].el
      }
      return exact[0]
    }

    // Substring either way (specific → generic), longest heading first.
    const subs = els
      .filter((el) => {
        const ht = norm(headingText(el))
        return ht.length >= 4 && (ht.includes(wanted) || wanted.includes(ht))
      })
      .sort((a, b) => headingText(b).length - headingText(a).length)
    if (subs.length) return subs[0]

    // Token-overlap fuzzy — tolerate minor rewording since review time.
    let best: HTMLElement | null = null
    let bestScore = 0
    for (const el of els) {
      const s = overlap(text, headingText(el))
      if (s > bestScore) {
        bestScore = s
        best = el
      }
    }
    return bestScore >= 0.6 ? best : null
  }

  const findExcerpt = (excerpt: string): HTMLElement | null => {
    const needle = norm(excerpt).slice(0, 80)
    if (needle.length < 8) return null
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent && n.textContent.trim().length >= 8
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    })
    // Single-node pass first (fast, most common), then a windowed two-node join
    // to survive excerpts split across inline elements.
    let prevText = ''
    let prevEl: HTMLElement | null = null
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = (n.parentElement ?? null) as HTMLElement | null
      if (!parent || parent.closest('script,style,nav,header,footer,aside')) continue
      const t = norm(n.textContent ?? '')
      if (t.includes(needle) || (prevText + ' ' + t).includes(needle)) {
        const el = t.includes(needle) ? parent : (prevEl ?? parent)
        const block = el.closest(
          'p,li,td,th,blockquote,pre,dd,dt,div,section,article,h1,h2,h3,h4,h5,h6',
        ) as HTMLElement | null
        return block ?? el
      }
      prevText = t
      prevEl = parent
    }
    return null
  }

  const flash = (el: HTMLElement): void => {
    const saved = {
      outline: el.style.outline,
      outlineOffset: el.style.outlineOffset,
      background: el.style.backgroundColor,
      transition: el.style.transition,
      borderRadius: el.style.borderRadius,
    }
    el.style.transition = 'background-color 300ms ease, outline-color 300ms ease'
    el.style.outline = '2px solid #6366f1'
    el.style.outlineOffset = '3px'
    el.style.borderRadius = el.style.borderRadius || '4px'
    el.style.backgroundColor = 'rgba(99, 102, 241, 0.14)'
    window.setTimeout(() => {
      el.style.backgroundColor = saved.background
      el.style.outline = saved.outline ? saved.outline : 'transparent solid 2px'
      window.setTimeout(() => {
        el.style.outline = saved.outline
        el.style.outlineOffset = saved.outlineOffset
        el.style.transition = saved.transition
        el.style.borderRadius = saved.borderRadius
      }, 350)
    }, 2500)
  }

  try {
    let el: HTMLElement | null = null

    if (target.kind === 'id') {
      el = document.getElementById(target.id)
      // The id may anchor an empty <a>; highlight the associated heading instead.
      if (el && (el.innerText ?? '').trim().length === 0) {
        el = (el.closest('h1,h2,h3,h4,h5,h6') as HTMLElement | null) ?? el.nextElementSibling as HTMLElement | null ?? el
      }
      if (!el) el = findHeading(target.headingText, [])
    } else if (target.kind === 'heading') {
      el = findHeading(target.headingText, target.path)
      if (!el) el = findExcerpt(target.headingText)
    } else {
      el = findExcerpt(target.excerpt)
    }

    if (!el) return { found: false }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flash(el)
    return { found: true }
  } catch {
    return { found: false }
  }
}
