/** Conventional Commit prefixes; titles without one remain unclassified. */
export const WORK_TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'style', 'revert', 'unclassified'] as const
export type WorkType = typeof WORK_TYPES[number]

export function workType(title: string): WorkType {
  const prefix = /^([a-z]+)(?:\([^()\r\n]+\))?!?:\s+\S/.exec(title)?.[1]
  return WORK_TYPES.find((type) => type !== 'unclassified' && type === prefix) ?? 'unclassified'
}

/** Submitted non-author reviews observed at or before merge. */
export interface ReviewSummary {
  rounds: number
  missingCommits: number
  changeRequests: number
  dismissed: number
}

export interface WorkReviewAnalytics {
  types: Array<{ type: WorkType, count: number }>
  rounds: {
    median: number | null
    counted: number
    missingReviews: number
    distribution: Array<{ rounds: number, prs: number }>
  }
  changesRequested: { prs: number | null, reviews: number | null, dismissed: number | null, counted: number }
}

export function changeRequestShare(pr: { merged: number, workReview?: WorkReviewAnalytics }): number | null {
  const count = pr.workReview?.changesRequested.prs
  return pr.merged && count !== null && count !== undefined ? count / pr.merged * 100 : null
}
