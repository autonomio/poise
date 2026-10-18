/** GitHub review data stays separate from the writer's editable annotations. */
export interface ReviewMessage {
  id: string
  author: string
  body: string
  url: string
  createdAt: string
}

export interface ReviewAnchor {
  quote: string
  before: string
  after: string
  unique: boolean
}

export interface ArticleReview {
  id: string
  kind: 'thread' | 'comment' | 'review'
  repo: string
  site: string
  pr: number
  prUrl: string
  path?: string
  resolved: boolean
  outdated: boolean
  canReply: boolean
  canResolve: boolean
  messages: ReviewMessage[]
  anchor?: ReviewAnchor
  location?: string
}

export interface ArticleReviews {
  reviews: ArticleReview[]
  checkedAt: string | null
  active: boolean
  stale: boolean
  problems: string[]
  retryAt?: string
}

export const REVIEW_INTERVAL_MS = 5 * 60_000

/** Exact passage plus surrounding lines. Ambiguous locations stay in the review list. */
export function locateReview(text: string, anchor: ReviewAnchor): { start: number, end: number } | null {
  if (!anchor.quote.trim()) return null
  const candidates: number[] = []
  for (let at = text.indexOf(anchor.quote); at >= 0; at = text.indexOf(anchor.quote, at + 1)) {
    if ((at === 0 || text[at - 1] === '\n') && (at + anchor.quote.length === text.length || text[at + anchor.quote.length] === '\n')) candidates.push(at)
  }
  if (candidates.length === 1 && anchor.unique) return { start: candidates[0], end: candidates[0] + anchor.quote.length }
  if (!anchor.before && !anchor.after) return null
  const contextual = candidates.filter((at) => (!anchor.before || text.slice(0, at).endsWith(`${anchor.before}\n`))
    && (!anchor.after || text.slice(at + anchor.quote.length).startsWith(`\n${anchor.after}`)))
  return contextual.length === 1 ? { start: contextual[0], end: contextual[0] + anchor.quote.length } : null
}
