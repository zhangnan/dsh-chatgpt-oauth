import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCodexUsage, renderCallbackPage, routeState, selectPiLoginOption } from '../lib/index.js'

test('OAuth callback page is branded for DSH, not PI Agent', () => {
  const html = renderCallbackPage({ ok: true })
  assert.match(html, /DSH/)
  assert.match(html, /ChatGPT/)
  assert.doesNotMatch(html, /PI Agent|pi-agent|pi-coding/i)
})

test('selectPiLoginOption chooses browser login', () => {
  const prompt = {
    kind: 'select',
    options: [
      { id: 'browser', label: 'Browser login (default)' },
      { id: 'device_code', label: 'Device code login (headless)' },
    ],
  }
  assert.equal(selectPiLoginOption(prompt, 'browser'), 'browser')
})

test('selectPiLoginOption chooses device-code login', () => {
  const prompt = {
    kind: 'select',
    options: [
      { id: 'browser', label: 'Browser login (default)' },
      { id: 'device_code', label: 'Device code login (headless)' },
    ],
  }
  assert.equal(selectPiLoginOption(prompt, 'device_code'), 'device_code')
})

test('routeState accepts an OAuth-native route', () => {
  assert.deepEqual(routeState({ providers: { 'openai-codex': { displayName: 'ChatGPT' } } }), {
    configured: true,
    compatible: true,
    provider: { displayName: 'ChatGPT' },
  })
})

test('routeState rejects apiKeyEnv because it overrides stored OAuth', () => {
  assert.equal(routeState({ providers: { 'openai-codex': { apiKeyEnv: 'OPENAI_CODEX_API_KEY' } } }).compatible, false)
})

test('routeState rejects model compat switches owned by the pi-ai catalog', () => {
  const state = routeState({ providers: { 'openai-codex': {
    models: [{ id: 'gpt-6-sol', compat: { supportsOpenAIGrammarTools: true } }],
  } } })
  assert.equal(state.compatible, false)
  assert.match(state.issue, /gpt-6-sol.*supportsOpenAIGrammarTools/)
})

test('routeState rejects route-level catalog compat but accepts model IDs from the catalog', () => {
  const invalid = routeState({ providers: { 'openai-codex': {
    compat: { supportsToolSearch: true },
    models: [{ id: 'gpt-6-sol' }, { id: 'gpt-6-luna' }],
  } } })
  assert.equal(invalid.compatible, false)
  assert.match(invalid.issue, /supportsToolSearch/)

  const valid = routeState({ providers: { 'openai-codex': {
    models: [{ id: 'gpt-6-sol' }, { id: 'gpt-6-luna' }],
  } } })
  assert.equal(valid.compatible, true)
  assert.equal(valid.issue, undefined)
})

test('parseCodexUsage follows pi-web Codex window and credits semantics', () => {
  const report = parseCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 17.5, limit_window_seconds: 18000, reset_at: 1_800_000_000 },
      secondary_window: { used_percent: '25', limit_window_seconds: 604800 },
    },
    additional_rate_limits: [{
      limit_name: 'Code review',
      metered_feature: 'reviews',
      rate_limit: { primary_window: { used_percent: 120, limit_window_seconds: 3600 } },
    }],
    credits: { balance: 42 },
  }, 1234)

  assert.equal(report.capturedAt, 1234)
  assert.deepEqual(report.buckets[0], {
    id: 'codex:primary', label: '5h', used: 17.5, remaining: 82.5, limit: 100,
    unit: 'percent', windowMinutes: 300, resetsAt: 1_800_000_000,
  })
  assert.equal(report.buckets[1].label, 'Weekly')
  assert.deepEqual(report.buckets[2], {
    id: 'reviews:primary', label: '1h', groupLabel: 'Code review', used: 100,
    remaining: 0, limit: 100, unit: 'percent', windowMinutes: 60,
  })
  assert.deepEqual(report.metrics, [{ id: 'credits', label: 'Credits', value: 42, unit: 'count' }])
})

test('parseCodexUsage supports unlimited credits without rate-limit windows', () => {
  assert.deepEqual(parseCodexUsage({ credits: { unlimited: true } }, 1).metrics, [
    { id: 'credits', label: 'Credits', value: 'Unlimited' },
  ])
})

test('parseCodexUsage rejects an empty response', () => {
  assert.throws(() => parseCodexUsage({}), /no usage data/i)
})
