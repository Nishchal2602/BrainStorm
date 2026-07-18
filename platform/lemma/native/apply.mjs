#!/usr/bin/env node
// Apply the native Pocket PM pod resources (tables + agents + workflow) to a Lemma pod.
//
// Usage:
//   LEMMA_TOKEN='<fresh sAccessToken>' node platform/lemma/native/apply.mjs
//   (optional) LEMMA_POD_ID=... LEMMA_BASE_URL=https://api.lemma.work
//
// The token is a SuperTokens sAccessToken (grab it fresh from DevTools → Network → any
// api.lemma.work request → the `sAccessToken` cookie). It expires in ~1h and the browser
// rotates it, so run this SOON after copying. The script sends both Bearer and cookie auth.
//
// Idempotent-ish: an "already exists" (409) is logged and skipped, so re-runs are safe.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.LEMMA_BASE_URL || 'https://api.lemma.work'
const POD = process.env.LEMMA_POD_ID || '019f1914-1021-74b2-82c3-9c4d6bf5fdf2'
const TOKEN = process.env.LEMMA_TOKEN
if (!TOKEN) {
  console.error('ERROR: set LEMMA_TOKEN to a fresh sAccessToken. Aborting.')
  process.exit(1)
}
const res = JSON.parse(readFileSync(join(HERE, 'resources.json'), 'utf8'))

const headers = {
  'content-type': 'application/json',
  accept: 'application/json',
  authorization: `Bearer ${TOKEN}`,
  cookie: `sAccessToken=${TOKEN}`,
  origin: 'https://lemma.work',
}

async function call(method, path, body) {
  const r = await fetch(`${BASE}/pods/${POD}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data
  const text = await r.text()
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, ok: r.ok, data }
}

const short = (d) => (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 200)

async function main() {
  // Auth preflight — fail fast with a clear message if the token doesn't authenticate.
  const pre = await call('GET', '')
  if (pre.status === 401) {
    console.error('✗ 401 Unauthorized on GET /pods/{pod}. The token is not valid (expired/rotated).')
    console.error('  Grab a fresh sAccessToken from a live lemma.work session and re-run immediately.')
    process.exit(1)
  }
  console.log(`✓ auth OK (GET pod → ${pre.status})\n`)

  console.log('— Tables —')
  for (const t of res.tables) {
    const r = await call('POST', '/datastore/tables', t)
    console.log(`  ${r.ok ? '✓' : r.status === 409 ? '· exists' : '✗ ' + r.status} ${t.name}${r.ok || r.status === 409 ? '' : '  ' + short(r.data)}`)
  }

  console.log('\n— Agents —')
  for (const a of res.agents) {
    const r = await call('POST', '/agents', a)
    console.log(`  ${r.ok ? '✓' : r.status === 409 ? '· exists' : '✗ ' + r.status} ${a.name}${r.ok || r.status === 409 ? '' : '  ' + short(r.data)}`)
  }

  console.log('\n— Workflow —')
  const wf = res.workflow
  const create = await call('POST', '/workflows', { name: wf.name, description: wf.description, start: wf.start })
  console.log(`  ${create.ok ? '✓ created' : create.status === 409 ? '· exists' : '✗ ' + create.status} ${wf.name}${create.ok || create.status === 409 ? '' : '  ' + short(create.data)}`)
  const graph = await call('PUT', `/workflows/${wf.name}/graph`, wf.graph)
  console.log(`  ${graph.ok ? '✓ graph set' : '✗ graph ' + graph.status + '  ' + short(graph.data)}`)

  console.log('\nDone. Verify in the Lemma UI: 5 tables, 5 agents (default model), workflow "' + wf.name + '".')
  console.log('Then start a run (see README) with { review_run_id, prd_text, product_name, feature_name }.')
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
