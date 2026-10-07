import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-07T04:00:00Z')

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

test('the pin hides the line and /usage-pin brings it back', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: {
    startedAt: NOW,
    context: { tokens: 283_200, window: 1_000_000, percent: 28 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 29, resetsAt: '2026-10-07T07:06:00Z' },
      { kind: 'seven_day', percentUsed: 82 },
    ],
  } }))
  on('command.register', () => ({ value: { command: 'usage-pin' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: BAND })
    const before = JSON.stringify(await ui.drawn())
    expect(before).toContain('283.2k/1M')
    // Unpinned, nothing of the line is left; /usage-pin brings it back.
    await ui.press({ key: 'pin' })
    expect(JSON.stringify(await ui.drawn())).not.toContain('283.2k/1M')
    await $.command.run({
      command: 'usage-pin',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })
    expect(JSON.stringify(await ui.drawn())).toContain('283.2k/1M')
    await ui.unmount()
  }
})

test('a session just opened shows the limits the last response reported', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, {
    lastRateLimits: {
      at: NOW - 60_000,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 38, resetsAt: '2026-10-07T06:46:00Z' },
        { kind: 'seven_day', percentUsed: 84, resetsAt: '2026-10-07T08:16:00Z' },
      ],
    },
  })
  // No response yet in this session: no rate limits of its own.
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 373_200, window: 1_000_000, percent: 37 }, rateLimits: [] } }))
  on('command.register', () => ({ value: { command: 'usage-pin' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('2小時46分後重置')
  expect(drawn).toContain('38%')
  expect(drawn).toContain('84%')
  await ui.unmount()
})

test('a blank row parts this band from the one below', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 1, window: 10 }, rateLimits: [] } }))
  on('command.register', () => ({ value: { command: 'usage-pin' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // Another plugin's band beneath this one.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['other band'] }))
  await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('other band')
  expect(drawn).toContain('"children":["\u00a0"]')
  expect(drawn).not.toContain('00a0')
  expect(drawn).not.toContain('"Svg"')
  await ui.unmount()
})
