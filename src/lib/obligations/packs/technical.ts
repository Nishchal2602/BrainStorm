import type { ObligationPack } from '../types'

// Technical obligation packs — what engineering needs stated before it can build.
// Every `probe` is deliberately generous: a false "already specified" (missing a
// real gap) is far cheaper than a false "missing" (inventing one).

const ob = (
  packId: string,
  attribute: string,
  ask: string,
  why: string,
  severity: 'critical' | 'medium' | 'minor',
  probe: RegExp[],
) => ({ id: `${packId}.${attribute.toLowerCase().replace(/\s+/g, '_')}`, attribute, ask, why, severity, probe })

export const FILE_INGESTION: ObligationPack = {
  id: 'file_ingestion',
  label: 'File ingestion',
  kind: 'technical',
  // NOTE the bounded gap `[^.\n]{0,40}?` in the verb→noun patterns. Requiring the
  // noun immediately after the article ("ingest the file") misses how PRDs actually
  // read ("ingest the daily transactions file"), which silently disabled the whole
  // pack. Bounded and newline/sentence-limited so it can't span unrelated clauses.
  detect: [
    /\b(upload|ingest|import|consume|parse|process|receive|read)\w*\b[^.\n]{0,40}?\b(file|files|feed|batch|export|spreadsheet)\b/i,
    /\b(file|files|feed)\b[^.\n]{0,40}?\b(upload|ingest|import|process)\w*/i,
    /\b(csv|tsv|xlsx|parquet)\b/i,
    /\bfile\s+(upload|ingestion|import|feed|drop|transfer)\b/i,
    /\b(sftp|s3 bucket|file share|file drop)\b/i,
  ],
  obligations: [
    ob('file_ingestion', 'File format', 'The exact accepted format(s) — e.g. CSV, TSV, XLSX, JSON — and whether more than one is allowed.', 'Engineering cannot write a parser without knowing the format, and will guess.', 'critical',
      [/\b(csv|tsv|xlsx|xls|excel|json|xml|parquet|avro|fixed[- ]width)\b/i, /\bfile\s+(format|type)s?\b/i, /\bformat\s*(:|is|will be|must be)/i]),
    ob('file_ingestion', 'Character encoding', 'The expected encoding (e.g. UTF-8) and the behaviour on an undecodable byte.', 'Mis-decoded files corrupt data silently; this surfaces in production, not testing.', 'medium',
      [/\b(utf-?8|utf-?16|ascii|latin-?1|iso-8859|encoding|charset)\b/i]),
    ob('file_ingestion', 'Delimiter and quoting', 'For delimited files: the delimiter, quote character, and escaping rules.', 'A comma inside a quoted field breaks a naive parser; the rule must be explicit.', 'medium',
      [/\b(delimiter|delimited|separator|semicolon|pipe[- ]separated|quote char|quoting|escap)\w*/i]),
    ob('file_ingestion', 'Header row', 'Whether a header row is present, and whether column order is guaranteed.', 'Engineering must know whether to map columns by name or position.', 'medium',
      [/\bheader\s*(row|line)?\b/i, /\bcolumn\s+(order|names?|mapping)\b/i]),
    ob('file_ingestion', 'Schema and required columns', 'The full column list, each column\'s type, and which are required vs optional.', 'Without a schema every field is ambiguous and validation cannot be written.', 'critical',
      [/\bschema\b/i, /\b(required|mandatory|optional)\s+(column|field)s?\b/i, /\bcolumns?\s*(:|are|include)/i, /\bfield\s+definitions?\b/i]),
    ob('file_ingestion', 'Maximum file size', 'The largest file accepted, and expected row counts.', 'Drives memory strategy, streaming vs in-memory parsing, and timeouts.', 'medium',
      [/\b\d+\s*(kb|mb|gb|kib|mib|gib)\b/i, /\b(max|maximum|largest|up to)\b.{0,20}\b(size|rows?|records?)\b/i, /\brow count\b/i]),
    ob('file_ingestion', 'Malformed row behaviour', 'What happens to an invalid row: reject the whole file, skip the row, or quarantine it — and how the user is told.', 'This is the single most common production question and is almost never specified.', 'critical',
      [/\b(malformed|invalid|bad|rejected|quarantin|partial(ly)? (valid|fail)|skip(ped)? rows?|error rows?)\b/i, /\bvalidation (error|failure)/i]),
    ob('file_ingestion', 'Duplicate handling', 'How duplicate rows or a re-uploaded file are handled — is ingestion idempotent?', 'Re-uploads happen constantly; without a rule you get double-counted data.', 'critical',
      [/\b(duplicate|idempoten|de-?dup|already (uploaded|processed)|re-?upload|unique key)\b/i]),
    ob('file_ingestion', 'Source and trigger', 'Where the file arrives from (manual upload, SFTP, S3, API) and what triggers processing.', 'Determines the integration surface and the failure modes to design for.', 'medium',
      [/\b(sftp|s3|bucket|manual upload|drag|api|webhook|scheduled|cron|trigger)\b/i]),
    ob('file_ingestion', 'Retention and PII', 'How long the raw file is kept, where, and whether it contains personal data.', 'Storing raw files with personal data creates retention and privacy obligations.', 'medium',
      [/\b(retention|retain|delete[d]? after|purge|pii|personal data|archiv)\w*/i]),
  ],
}

export const API_INTEGRATION: ObligationPack = {
  id: 'api_integration',
  label: 'External API integration',
  kind: 'technical',
  detect: [
    /\b(call|invoke|integrate|consume|query)\w*\b[^.\n]{0,40}?\b(api|endpoint|third[- ]party|external service|vendor)\b/i,
    /\b(rest api|graphql|webhook|third[- ]party (api|service)|external (api|service)|vendor api)\b/i,
  ],
  obligations: [
    ob('api_integration', 'Authentication', 'How the integration authenticates, and how credentials are stored and rotated.', 'Unspecified auth means secrets end up hardcoded.', 'critical',
      [/\b(oauth|api key|bearer|jwt|hmac|mutual tls|mtls|basic auth|credential|secret|token)\b/i]),
    ob('api_integration', 'Timeout and retry', 'The request timeout, retry policy, and backoff strategy.', 'Without these a slow dependency cascades into an outage.', 'critical',
      [/\b(timeout|retry|retries|backoff|circuit break)\w*/i]),
    ob('api_integration', 'Idempotency', 'Whether calls are safe to retry, and the idempotency key if not.', 'A retried non-idempotent write duplicates the operation.', 'critical',
      [/\bidempoten\w*/i, /\bexactly[- ]once\b/i, /\bduplicate (request|call|charge)/i]),
    ob('api_integration', 'Rate limits', 'The provider\'s rate limit and the behaviour when it is hit.', 'Hitting a limit without handling produces silent partial failures.', 'medium',
      [/\brate limit\w*/i, /\b(throttl|quota|requests? per (second|minute))\w*/i, /\b429\b/]),
    ob('api_integration', 'Failure behaviour', 'What the user sees and what the system does when the dependency is unavailable.', 'Every external call fails eventually; the UX for that must be a decision, not an accident.', 'critical',
      [/\b(unavailable|downtime|degrad|fallback|fail(s|ure)? (gracefully|open|closed)|error (state|message|handling))\w*/i]),
  ],
}

export const BATCH_JOB: ObligationPack = {
  id: 'batch_job',
  label: 'Scheduled / batch processing',
  kind: 'technical',
  detect: [
    /\b(nightly|daily|hourly|weekly|every night)\b[^.\n]{0,30}?\b(job|run|batch|process|sync|reconcil)\w*/i,
    /\b(cron|scheduled job|batch job|background job|batch process)\w*/i,
  ],
  obligations: [
    ob('batch_job', 'Schedule and timezone', 'When it runs, how often, and in which timezone.', '"Daily" without a timezone is ambiguous across regions and breaks at DST.', 'medium',
      [/\b(utc|ist|timezone|time zone|at \d{1,2}(:\d\d)?\s*(am|pm)|midnight|cron)\b/i]),
    ob('batch_job', 'Partial failure behaviour', 'What happens when the run fails midway — resume, restart, or roll back.', 'Without a rule a half-finished run leaves inconsistent data.', 'critical',
      [/\b(partial|resume|restart|roll ?back|checkpoint|re-?process|re-?run)\w*/i]),
    ob('batch_job', 'Alerting', 'Who is notified when a run fails or does not run at all.', 'A silent batch failure is typically found days later by a user.', 'medium',
      [/\b(alert|notif|page|on-?call|monitor|dashboard)\w*/i]),
  ],
}

export const NOTIFICATION: ObligationPack = {
  id: 'notification',
  label: 'Notifications',
  kind: 'technical',
  detect: [
    /\b(notify|notification|notified|reminder)\w*/i,
    /\bsend\b[^.\n]{0,30}?\b(email|sms|push|message|alert)\b/i,
    /\balert\b[^.\n]{0,20}?\b(user|customer|team)\b/i,
  ],
  obligations: [
    ob('notification', 'Channel and template', 'Which channel(s), and the exact copy or template.', 'Unspecified copy becomes an engineering guess shipped to users.', 'medium',
      [/\b(email|sms|push|in-?app|slack|webhook|template|copy)\b/i]),
    ob('notification', 'Throttling', 'Limits so a burst of events cannot spam a user.', 'Event-driven notifications reliably produce spam without a cap.', 'medium',
      [/\b(throttl|rate limit|digest|batch(ed)? notif|frequency cap|at most)\w*/i]),
    ob('notification', 'Opt-out', 'Whether the user can turn it off, and how.', 'Non-transactional messages generally require an opt-out.', 'medium',
      [/\b(opt[- ]out|unsubscribe|preference|mute|turn off)\w*/i]),
  ],
}

export const TECHNICAL_PACKS: readonly ObligationPack[] = [
  FILE_INGESTION,
  API_INTEGRATION,
  BATCH_JOB,
  NOTIFICATION,
]
