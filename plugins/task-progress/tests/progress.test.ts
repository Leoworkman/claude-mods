import { expect, test } from 'claude-code/testing'

import type { ProgressEntry } from '../types'
import { etaMinutes, fit, fraction, stepsFromTodos, toRows } from '../hooks/progress'

const MIN = 60_000
const NOW = 1_000 * MIN

const entry = (over: Partial<ProgressEntry>): ProgressEntry => ({
  id: 'a',
  title: '剪輯開場動畫',
  turnId: 't1',
  status: 'running',
  startedAt: NOW - 10 * MIN,
  updatedAt: NOW,
  done: 0,
  active: 0,
  total: 0,
  ...over,
})

test('progress follows the steps Claude reported', async () => {
  const steps = stepsFromTodos([
    { status: 'completed' },
    { status: 'completed' },
    { status: 'in_progress' },
    { status: 'pending' },
  ])
  expect(steps).toEqual({ done: 2, active: 1, total: 4 })
  const e = entry(steps)
  expect(Math.round(fraction(e, NOW) * 100)).toBe(63)
  // 10 minutes for 62.5%: about 6 minutes left
  expect(etaMinutes(e, NOW)).toBe(6)
})

test('without steps the bar moves with time and shows no estimate', async () => {
  const e = entry({})
  expect(fraction(e, NOW)).toBeGreaterThan(0.5)
  expect(fraction(e, NOW)).toBeLessThan(0.9)
  expect(etaMinutes(e, NOW)).toBe(null)
})

test('rows: running first, finished for 30 minutes, dismissed and stale hidden', async () => {
  const rows = toRows(
    [
      entry({ id: 'done', status: 'done', endedAt: NOW - 5 * MIN }),
      entry({ id: 'old', status: 'done', endedAt: NOW - 40 * MIN }),
      entry({ id: 'run', done: 1, total: 2 }),
      entry({ id: 'dead', updatedAt: NOW - 5 * MIN }),
      entry({ id: 'gone', turnId: 't9' }),
      entry({ id: 'back', turnId: 't2' }),
    ],
    { gone: 't9', back: 't1' },
    'run',
    NOW,
  )
  expect(rows.map(r => r.id)).toEqual(['run', 'back', 'done'])
  expect(rows[0]?.isSelf).toBe(true)
  expect(rows[2]?.pct).toBe(100)
})

test('names are cut to the cells they get', async () => {
  expect(fit('整理研究資料', 20)).toBe('整理研究資料')
  expect(fit('Motion graphics showreel', 16)).toBe('Motion graphics…')
  expect(fit('整理研究資料與報告', 9)).toBe('整理研究…')
})
