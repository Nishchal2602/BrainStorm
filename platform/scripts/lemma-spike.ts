import 'dotenv/config'
import { lemmaConfig } from '@/server/lemma/config'
import { LemmaWorkflowClient } from '@/server/lemma/client'
import { TERMINAL } from '@/server/lemma/port'

// Connectivity spike — run against a REAL local Lemma stack (Docker required) to prove
// the SDK plumbing the LemmaReviewRunner relies on:
//   headless bearer auth (LEMMA_TOKEN) + runs.create → runs.get(WAITING/node_id) →
//   submitForm advancing the workflow to COMPLETED.
// It just advances each FORM with { ok: true } (no agents) — pure plumbing check.
//
//   cd platform && cp .env.example .env   # set LEMMA_* (see lemma/README.md), then:
//   npm run lemma:spike

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!lemmaConfig.configured) {
    throw new Error(
      'Lemma is not configured. Set LEMMA_ENABLED=true and LEMMA_BASE_URL/LEMMA_POD_ID/LEMMA_TOKEN in platform/.env (see lemma/README.md).',
    )
  }
  const client = new LemmaWorkflowClient()
  console.log(`Starting workflow "${lemmaConfig.workflowName}" on pod ${lemmaConfig.podId} …`)
  let view = await client.startRun(lemmaConfig.workflowName)
  console.log('  run', view.id, '→', view.status, view.waitingNodeId ? `@${view.waitingNodeId}` : '')

  let polls = 0
  while (!TERMINAL.has(view.status)) {
    if (polls++ > lemmaConfig.maxPolls) throw new Error('exceeded poll budget')
    if (view.status === 'WAITING' && view.waitingNodeId) {
      console.log(`  submitForm(${view.waitingNodeId})`)
      view = await client.submitForm(view.id, view.waitingNodeId, { ok: true })
      console.log('   →', view.status, view.waitingNodeId ? `@${view.waitingNodeId}` : '')
      continue
    }
    await sleep(lemmaConfig.pollIntervalMs)
    view = await client.getRun(view.id)
  }

  if (view.status !== 'COMPLETED') {
    throw new Error(`run ended ${view.status}${view.error ? `: ${view.error}` : ''}`)
  }
  console.log('\nLEMMA SPIKE OK ✅  (auth + create/get/submitForm advanced a real run to COMPLETED)')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nLEMMA SPIKE FAILED ❌\n', e instanceof Error ? e.message : e)
    process.exit(1)
  })
