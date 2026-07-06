import type { ReviewContext, UserContext } from '@/lib/types'

const USER_KEY = 'pm_user_context'
const DISMISSED_KEY = 'pm_onboarding_dismissed'
const DRAFT_KEY = 'pm_review_draft'

export const DEFAULT_USER_CONTEXT: UserContext = {
  role: '',
  experienceLevel: '',
  companyName: '',
  industry: '',
  companyStage: '',
}

export const DEFAULT_REVIEW_CONTEXT: ReviewContext = {
  featureName: '',
  problemStatement: '',
  targetUser: '',
  successMetric: '',
  // Fixed for the MVP: PRD reviews only, always an expert-level critique.
  reviewType: 'prd',
  familiarityLevel: 'domain_expert',
}

// The UIs autosave on every keystroke, so read-modify-write calls can overlap.
// Serialize them on a single tail so a later patch never reads stale storage and
// clobbers an earlier field (lost-update race).
let writeTail: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeTail.then(fn, fn)
  writeTail = run.catch(() => undefined)
  return run
}

/** The persisted onboarding profile, merged with defaults (back-compatible). */
export async function getUserContext(): Promise<UserContext> {
  const obj = await chrome.storage.local.get(USER_KEY)
  return { ...DEFAULT_USER_CONTEXT, ...(obj[USER_KEY] as Partial<UserContext> | undefined) }
}

export function setUserContext(patch: Partial<UserContext>): Promise<UserContext> {
  return serialize(async () => {
    const next = { ...(await getUserContext()), ...patch }
    await chrome.storage.local.set({ [USER_KEY]: next })
    return next
  })
}

/** True once the user has completed onboarding (presence of onboardedAt). */
export async function isOnboarded(): Promise<boolean> {
  return Boolean((await getUserContext()).onboardedAt)
}

/** Whether the user dismissed onboarding ("Skip for now") — don't re-prompt. */
export async function getOnboardingDismissed(): Promise<boolean> {
  const obj = await chrome.storage.local.get(DISMISSED_KEY)
  return Boolean(obj[DISMISSED_KEY])
}

export async function setOnboardingDismissed(value: boolean): Promise<void> {
  await chrome.storage.local.set({ [DISMISSED_KEY]: value })
}

/** Autosaved draft of the per-review context — prefills the review modal. */
export async function getReviewDraft(): Promise<ReviewContext> {
  const obj = await chrome.storage.local.get(DRAFT_KEY)
  return { ...DEFAULT_REVIEW_CONTEXT, ...(obj[DRAFT_KEY] as Partial<ReviewContext> | undefined) }
}

export function setReviewDraft(patch: Partial<ReviewContext>): Promise<ReviewContext> {
  return serialize(async () => {
    const next = { ...(await getReviewDraft()), ...patch }
    await chrome.storage.local.set({ [DRAFT_KEY]: next })
    return next
  })
}
