/** A normalized discussion (Reddit post + its top comments). Produced by both the
 * Reddit client and the grounded fallback, so one path serves both. */
export interface RedditComment {
  body: string
  score: number
  author?: string
  authorFlair?: string
}

export interface DiscussionDoc {
  id: string
  title: string
  subreddit: string
  score: number
  numComments: number
  url: string
  body: string
  comments: RedditComment[]
  author?: string
  authorFlair?: string
  /** How many distinct problem terms appear in title+body (relevance gate/rank). */
  relevanceScore?: number
}

/** One quotable unit fed to the verifier: the post body or a single comment. */
export interface DiscussionUnit {
  docIndex: number
  /** 'post' for the post title+body, or 'c0'/'c1'… for a comment. */
  unitId: string
  text: string
  /** Upvotes on this specific unit (post score or comment score). */
  score: number
  author?: string
  authorFlair?: string
  subreddit: string
  url: string
}
