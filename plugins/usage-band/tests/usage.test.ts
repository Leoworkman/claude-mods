import { expect, test } from 'claude-code/testing'

import { filled, fmtReset, fmtTokens, pickLimits, toSnap } from '../hooks/usage'

const NOW = Date.parse('2026-10-07T04:00:00Z')

test('context reads as tokens over the window', async () => {
  expect(fmtTokens(342_200)).toBe('342.2k')
  expect(fmtTokens(1_000_000)).toBe('1M')
  expect(fmtTokens(200_000)).toBe('200k')
  expect(fmtTokens(512)).toBe('512')
})

test('the 5-hour window counts down to its reset', async () => {
  expect(fmtReset('2026-10-07T07:12:00Z', NOW)).toBe('3小時12分後重置')
  expect(fmtReset('2026-10-07T04:45:00Z', NOW)).toBe('45分後重置')
  expect(fmtReset('2026-10-09T06:00:00Z', NOW)).toBe('2天2小時後重置')
  expect(fmtReset(undefined, NOW)).toBe('')
})

test('a snapshot takes the 5-hour and weekly windows by kind', async () => {
  const snap = toSnap(
    { tokens: 342_200, window: 1_000_000, percent: 34 },
    [
      { kind: 'seven_day', percentUsed: 82, resetsAt: '2026-10-10T00:00:00Z' },
      { kind: 'five_hour', percentUsed: 27, resetsAt: '2026-10-07T07:12:00Z' },
    ],
    NOW,
  )
  expect(snap.contextPct).toBe(34)
  expect(snap.fiveHour).toEqual({ pct: 27, resetsAt: '2026-10-07T07:12:00Z' })
  expect(snap.weekly).toEqual({ pct: 82 })
})

test('no rate limits reported (API key, before the first response)', async () => {
  const snap = toSnap({ window: 200_000 }, [], NOW)
  expect(snap.tokens).toBe(0)
  expect(snap.contextPct).toBe(0)
  expect(snap.fiveHour).toBe(null)
  expect(snap.weekly).toBe(null)
})

test('bars fill in proportion and never overflow', async () => {
  expect(filled(34, 50)).toBe(17)
  expect(filled(120, 50)).toBe(50)
  expect(filled(-5, 50)).toBe(0)
})

test('a window whose reset passed since it was kept starts over', async () => {
  const snap = toSnap(
    { window: 1_000_000 },
    [
      { kind: 'five_hour', percentUsed: 95, resetsAt: '2026-10-07T03:00:00Z' },
      { kind: 'seven_day', percentUsed: 84, resetsAt: '2026-10-09T00:00:00Z' },
    ],
    NOW,
  )
  expect(snap.fiveHour).toEqual({ pct: 0 })
  expect(snap.weekly).toEqual({ pct: 84 })
})

test("the session's own reading wins over the kept one", async () => {
  const kept = { at: 0, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] }
  const live = [{ kind: 'five_hour', percentUsed: 40 }]
  expect(pickLimits(live, kept)).toEqual(live)
  expect(pickLimits([], kept)).toEqual(kept.rateLimits)
  expect(pickLimits([], undefined)).toEqual([])
})
