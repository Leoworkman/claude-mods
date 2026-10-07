import { expect, mock, test } from 'claude-code/testing'

import { barSvg } from '../hooks/progress'

test('the bar is a rounded track with the filled part over it', async () => {
  const svg = barSvg(72, 400, 8, '#d97757', '#3a3a3a')
  expect(svg).toContain('width="400" height="8" rx="4" fill="#3a3a3a"')
  expect(svg).toContain('width="288" height="8" rx="4" fill="#d97757"')
  // 1% still draws a round cap, not a squashed sliver
  expect(barSvg(1, 400, 8, 'x', 'y')).toContain('width="8" height="8" rx="4" fill="x"')
  expect(barSvg(0, 400, 8, 'x', 'y')).not.toContain('fill="x"')
})

const NOW = Date.parse('2026-10-07T04:00:00Z')
const MIN = 60_000

const ENTRIES = [
  { id: 'a', title: '剪輯開場動畫', turnId: 't1', status: 'running', startedAt: NOW - 10 * MIN, updatedAt: NOW, done: 7, active: 1, total: 10 },
  { id: 'b', title: '修登入錯誤', turnId: 't2', status: 'done', startedAt: NOW - 20 * MIN, updatedAt: NOW - MIN, endedAt: NOW - MIN, done: 3, active: 0, total: 3 },
]

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

test('the band draws on the terminal and the desktop', async ($, on) => {
  // The shared folder as two other sessions left it.
  mock.env(on, { USERPROFILE: 'C:/home', OS: 'Windows_NT' })
  const clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'self' }))
  // The engine hands paths in the platform's own spelling.
  const slash = (path: string) => path.split('\\').join('/')
  on('fs.list', ($, e) => ({
    value: slash(e.path).endsWith('dismissed')
      ? []
      : ENTRIES.map(x => ({ name: `${x.id}.json`, kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })),
  }))
  on('fs.read', ($, e) => ({ value: JSON.stringify(ENTRIES.find(x => slash(e.path).endsWith(`/${x.id}.json`))) }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))

  await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'task-progress', surface, component: 'AbovePrompt', props: BAND })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('剪輯開場動畫')
    expect(drawn).toContain('75%')
    expect(drawn).toContain('100%')
    expect(drawn).not.toContain('00a0')
    expect(drawn).toContain(surface === 'desktop' ? '"Svg"' : '█')
    expect(await ui.find({ key: 'hide-a' })).toBeDefined()
    await ui.unmount()
  }
})
