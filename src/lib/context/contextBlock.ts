import type {
  CompanyStage,
  ExperienceLevel,
  FamiliarityLevel,
  Industry,
  ReviewContext,
  ReviewType,
  UserContext,
  UserRole,
} from '@/lib/types'

// Human-readable labels for the stored enum values (UI shows these too).
const ROLE_LABEL: Record<UserRole, string> = {
  product_manager: 'Product Manager',
  founder: 'Founder',
  product_designer: 'Product Designer',
  engineer: 'Engineer',
  other: 'Other',
}
const EXPERIENCE_LABEL: Record<ExperienceLevel, string> = {
  '0-2': '0–2 years',
  '3-5': '3–5 years',
  '6-10': '6–10 years',
  '10+': '10+ years',
}
const INDUSTRY_LABEL: Record<Industry, string> = {
  saas: 'SaaS',
  ai: 'AI',
  fintech: 'Fintech',
  ecommerce: 'E-commerce',
  healthcare: 'Healthcare',
  consumer: 'Consumer',
  enterprise: 'Enterprise Software',
  other: 'Other',
}
const STAGE_LABEL: Record<CompanyStage, string> = {
  startup: 'Startup (<50 employees)',
  growth: 'Growth (50–500 employees)',
  enterprise: 'Enterprise (500+ employees)',
}
const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  prd: 'PRD Review',
  feature_spec: 'Feature Spec Review',
  user_story: 'User Story Review',
  roadmap: 'Roadmap Review',
  product_strategy: 'Product Strategy Review',
  brainstorming: 'Brainstorming',
  exec_comm: 'Executive Communication Review',
}
const FAMILIARITY_LABEL: Record<FamiliarityLevel, string> = {
  exploring: 'Exploring',
  some_knowledge: 'Some Knowledge',
  domain_expert: 'Domain Expert',
}

export const ROLE_OPTIONS = ROLE_LABEL
export const EXPERIENCE_OPTIONS = EXPERIENCE_LABEL
export const INDUSTRY_OPTIONS = INDUSTRY_LABEL
export const STAGE_OPTIONS = STAGE_LABEL
export const REVIEW_TYPE_OPTIONS = REVIEW_TYPE_LABEL
export const FAMILIARITY_OPTIONS = FAMILIARITY_LABEL

/** Indent a "Label: value" line only when value is non-empty; else null. */
function line(label: string, value: string | undefined): string | null {
  const v = (value ?? '').trim()
  return v ? `  ${label}: ${v}` : null
}

/**
 * Builds the human-readable context block injected BEFORE the document in a PM
 * Review. Empty fields and empty sections are omitted; returns '' if there is
 * nothing meaningful to inject.
 */
export function buildContextBlock(user: UserContext, review?: ReviewContext): string {
  const sections: string[] = []

  const profile = [
    line('Role', user.role ? ROLE_LABEL[user.role] : ''),
    line('Experience', user.experienceLevel ? EXPERIENCE_LABEL[user.experienceLevel] : ''),
  ].filter(Boolean)
  if (profile.length) sections.push('User Profile:\n' + profile.join('\n'))

  const company = [
    line('Name', user.companyName),
    line('Industry', user.industry ? INDUSTRY_LABEL[user.industry] : ''),
    line('Stage', user.companyStage ? STAGE_LABEL[user.companyStage] : ''),
  ].filter(Boolean)
  if (company.length) sections.push('Company:\n' + company.join('\n'))

  const product = [
    line('Name', user.productName),
    line('Description', user.productDescription),
    line('Primary User', user.primaryUser),
  ].filter(Boolean)
  if (product.length) sections.push('Product:\n' + product.join('\n'))

  if (user.businessGoal.trim()) sections.push('Business Goal:\n  ' + user.businessGoal.trim())

  if (review) {
    const r = [
      line('Feature', review.featureName),
      line('Problem', review.problemStatement),
      line('Target User', review.targetUser),
      line('Success Metric', review.successMetric),
      line('Review Type', REVIEW_TYPE_LABEL[review.reviewType]),
      line('Familiarity', FAMILIARITY_LABEL[review.familiarityLevel]),
    ].filter(Boolean)
    if (r.length) sections.push('Current Review Context:\n' + r.join('\n'))
  }

  if (!sections.length) return ''
  return 'USER & REVIEW CONTEXT (ground truth — applies to the document below):\n\n' + sections.join('\n\n')
}
