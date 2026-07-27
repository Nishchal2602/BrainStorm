import type { ObligationPack } from '../types'

// Compliance obligation packs — curated checklists, NOT legal advice.
//
// Every obligation carries a `source` on its pack so a claim can be checked, and
// every finding is framed as "flag for your compliance team", never "this is
// compliant". Stating regulation confidently and wrongly is worse than not
// checking at all, so these packs deliberately cover only well-established,
// widely-documented requirements and stop short of jurisdictional specifics.
//
// This is also the slot a user-supplied policy document fills later: same shape,
// different `source`, no code change.

const ob = (
  packId: string,
  attribute: string,
  ask: string,
  why: string,
  severity: 'critical' | 'medium' | 'minor',
  probe: RegExp[],
) => ({ id: `${packId}.${attribute.toLowerCase().replace(/\s+/g, '_')}`, attribute, ask, why, severity, probe })

export const PAYMENT_CARD: ObligationPack = {
  id: 'payment_card',
  label: 'Payment card handling',
  kind: 'compliance',
  source: 'PCI DSS v4.0 (card data handling) + common card-scheme rules',
  appliesWhen: { industry: ['fintech', 'ecommerce', 'enterprise', 'saas', 'other'] },
  detect: [
    /\b(credit|debit)\s+card\b/i,
    /\b(card\s*(number|holder|data|details)|pan\b|primary account number)/i,
    /\b(cvv|cvc|card verification)\b/i,
    /\b(payment (method|instrument)|checkout|acquirer|card network|visa|mastercard|rupay|amex)\b/i,
  ],
  obligations: [
    ob('payment_card', 'Card number storage and masking', 'Whether the full card number (PAN) is stored at all, and if displayed, that it is masked to first-6/last-4.', 'Storing or displaying a full PAN brings the system into PCI DSS scope and is a common audit failure.', 'critical',
      [/\b(mask|masked|masking|truncat|last[- ]?4|first[- ]?6|tokeni[sz])\w*/i, /\bdo(es)? not store\b/i, /\bpan\b.{0,30}\b(stor|retain)/i]),
    ob('payment_card', 'CVV must never be stored', 'Explicitly that the CVV/CVC is never persisted after authorization.', 'Storing CVV post-authorization is prohibited outright — an explicit statement prevents an accidental implementation.', 'critical',
      [/\bcvv\b.{0,40}\b(not|never|no)\b.{0,20}\b(stor|persist|sav|retain)/i, /\b(not|never)\b.{0,20}\bstor\w*.{0,20}\bcvv\b/i]),
    ob('payment_card', 'Tokenization', 'Whether card details are replaced by a token, and which provider issues it.', 'Tokenization is the standard way to keep card data out of your systems entirely.', 'critical',
      [/\btokeni[sz]\w*/i, /\b(network token|payment token|vault(ing)?)\b/i]),
    ob('payment_card', 'Strong customer authentication', 'Whether 3-D Secure / SCA applies, and the flow when a challenge is issued.', 'A missing 3DS/SCA flow causes declined transactions in regulated markets.', 'critical',
      [/\b(3-?d ?secure|3ds|sca\b|strong customer authentication|otp|two[- ]factor)\b/i]),
    ob('payment_card', 'Chargeback and dispute flow', 'What happens when a cardholder disputes a charge — evidence, timelines, and who acts.', 'Disputes are inevitable and have scheme-mandated response windows.', 'critical',
      [/\b(chargeback|dispute|represent ?ment|retrieval request)\w*/i]),
    ob('payment_card', 'Refund and reversal', 'How refunds and authorization reversals are handled, including partial refunds.', 'Refund behaviour is frequently omitted and then built inconsistently.', 'medium',
      [/\b(refund|reversal|void|cancel(l)?ation of (the )?(charge|payment))\w*/i]),
    ob('payment_card', 'Settlement and reconciliation', 'How captured payments are reconciled against the processor\'s settlement report.', 'Without reconciliation, payment discrepancies go undetected.', 'medium',
      [/\b(settlement|reconcil|payout|ledger|clearing)\w*/i]),
    ob('payment_card', 'Transmission security', 'That card data is only transmitted over TLS and never logged.', 'Card data in application logs is a frequent and serious leak path.', 'critical',
      [/\b(tls|https|encrypt\w* in transit)\b/i, /\b(not|never)\b.{0,25}\blog\w*/i]),
  ],
}

export const PII_DATA: ObligationPack = {
  id: 'pii_data',
  label: 'Personal data handling',
  kind: 'compliance',
  source: 'GDPR / India DPDP Act — general data-protection principles',
  detect: [
    /\b(pii|personal(ly)? (identifiable )?(data|information)|personal data)\b/i,
    /\b(aadhaar|ssn|social security|passport number|date of birth|dob\b)/i,
    /\b(email address|phone number|home address)\b.{0,40}\b(stor|collect|captur)/i,
  ],
  obligations: [
    ob('pii_data', 'Lawful basis and consent', 'Why this personal data may be collected, and how consent is captured if that is the basis.', 'Collecting personal data without a stated basis is the core data-protection failure.', 'critical',
      [/\b(consent|lawful basis|legitimate interest|opt[- ]in|privacy notice|purpose limitation)\b/i]),
    ob('pii_data', 'Retention period', 'How long the data is kept and what happens at the end of that period.', 'Indefinite retention of personal data is not defensible.', 'critical',
      [/\b(retention|retain(ed)? for|delete(d)? after|purge|ttl|expiry)\w*/i]),
    ob('pii_data', 'Deletion and access requests', 'How a user\'s request to access or delete their data is fulfilled, and in what timeframe.', 'These rights are legally mandated and require a designed flow, not an ad-hoc script.', 'critical',
      [/\b(right to (erasure|be forgotten|access)|dsar|data subject|delete my (data|account)|export my data)\b/i]),
    ob('pii_data', 'Encryption', 'That personal data is encrypted at rest and in transit.', 'Encryption is the baseline expectation for personal data.', 'medium',
      [/\bencrypt\w*/i, /\b(at rest|in transit|kms|aes)\b/i]),
    ob('pii_data', 'Data residency', 'Which region the data is stored in, and whether it crosses borders.', 'Cross-border transfer of personal data is restricted in several jurisdictions.', 'medium',
      [/\b(residency|region|data centre|data center|cross[- ]border|localis|localiz|onshore|in-?country)\w*/i]),
    ob('pii_data', 'Access control and audit', 'Who internally can see this data, and whether access is logged.', 'Unlogged internal access to personal data fails audit.', 'medium',
      [/\b(rbac|role[- ]based|access control|least privilege|audit (log|trail)|who can (access|view))\b/i]),
  ],
}

export const KYC_AML: ObligationPack = {
  id: 'kyc_aml',
  label: 'KYC / AML',
  kind: 'compliance',
  source: 'General KYC/AML programme expectations (jurisdiction-specific rules vary)',
  appliesWhen: { industry: ['fintech', 'enterprise', 'other'] },
  detect: [/\b(kyc|know your customer|aml|anti[- ]money laundering|sanctions?|pep\b|onboarding (a )?(customer|merchant))\b/i],
  obligations: [
    ob('kyc_aml', 'Identity verification', 'Which documents/checks establish identity, and the pass/fail criteria.', 'Vague verification produces inconsistent onboarding decisions.', 'critical',
      [/\b(verif\w*|document(ation)? (check|upload)|liveness|selfie|proof of (address|identity)|ocr)\b/i]),
    ob('kyc_aml', 'Screening', 'Whether the customer is screened against sanctions/PEP lists, and how often.', 'Screening is typically mandatory and must be periodic, not one-off.', 'critical',
      [/\b(sanction|screen(ing)?|watchlist|pep\b|adverse media|ofac)\w*/i]),
    ob('kyc_aml', 'Rejection and escalation', 'What happens when a check fails — reject, manual review, or restricted access.', 'Failed checks always occur; the path must be designed.', 'critical',
      [/\b(manual review|escalat|reject(ed|ion)?|fail(ed)? (kyc|verification)|compliance team)\w*/i]),
    ob('kyc_aml', 'Audit trail', 'That verification decisions and evidence are retained for audit.', 'Regulators require the decision trail, not just the outcome.', 'medium',
      [/\b(audit (trail|log)|evidence|record(ed)? (decision|for audit)|immutable)\b/i]),
  ],
}

export const COMPLIANCE_PACKS: readonly ObligationPack[] = [PAYMENT_CARD, PII_DATA, KYC_AML]

/** Standing caveat rendered with every compliance finding. */
export const COMPLIANCE_DISCLAIMER =
  'Compliance checks are curated checklists, not legal advice — confirm with your compliance team.'
