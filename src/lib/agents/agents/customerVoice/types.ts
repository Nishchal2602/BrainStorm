/** A normalized discussion (Reddit post + its top comments). Produced by both the
 * Reddit client and the grounded fallback, so one extraction path serves both. */
export interface RedditComment {
  body: string
  score: number
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
}
