import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { UsageSnap } from '../types'
import { fmtPct, fmtReset, fmtTokens, pickLimits, toSnap } from './usage'
import type { CachedLimits } from './usage'

const snapAtom = atom({ plugin: 'usage-band', key: 'snap' } as const, null as UsageSnap | null)
const pinnedAtom = atom({ plugin: 'usage-band', key: 'isPinned' } as const, true)

const TICK_MS = 30_000
const BLUE = '#4a8fe7'
const AMBER = '#f5b82e'
const RED = '#e5534b'
// A space the desktop keeps: a plain one alone on its row is collapsed away.
const NBSP = '\u00a0'
const PIN_KEY = 'isPinned'
const LIMITS_KEY = 'lastRateLimits'

async function refresh($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  const now = await $.clock.now()
  // Rate limits arrive only with an API response: a session just opened has none
  // yet, so it shows what the last response in any session reported.
  if (usage.rateLimits.length > 0) {
    const kept: CachedLimits = { rateLimits: [...usage.rateLimits], at: now }
    await $.store.set(LIMITS_KEY, kept)
  }
  const cached = (await $.store.get(LIMITS_KEY)) as CachedLimits | undefined
  const snap = toSnap(usage.context, pickLimits(usage.rateLimits, cached), now)
  await update($, snapAtom, () => snap)
}

async function setPinned($: EngineInterface, isPinned: boolean): Promise<void> {
  await update($, pinnedAtom, () => isPinned)
  await $.store.set(PIN_KEY, isPinned)
}

async function togglePinned($: EngineInterface): Promise<void> {
  await setPinned($, !(await read($, pinnedAtom)))
}

/** Another plugin's band below this one, or nothing when only the engine's is left. */
function below(tree: RenderElement): RenderElement | null {
  return tree.type === 'engine' ? null : tree
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(PIN_KEY)
    await update($, pinnedAtom, () => stored !== false)
    await $.command.register({
      name: 'usage-pin',
      description: '顯示／隱藏輸入框上方的用量列',
    })
    $.clock.every(TICK_MS, () => refresh($))
    await refresh($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($).catch(() => undefined)
    return result
  })

  on('command.run', { command: 'usage-pin' }, async $ => {
    await togglePinned($)
    return { text: (await read($, pinnedAtom)) ? '用量列：已顯示（常駐）' : '用量列：已隱藏，輸入 /usage-pin 可再顯示' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const tree = await next(e)
    const rest = below(tree)
    const snap = await read($, snapAtom)
    if (e.props.hasSurvey || snap === null) return tree

    // Unpinned, the line is gone entirely; /usage-pin brings it back.
    if (!(await read($, pinnedAtom))) return tree

    const { Box, Text, Button } = $.ui.resolve(e)
    const tone = (pct: number, base: string) => (pct >= 90 ? RED : base)

    const pinButton = (
      <Button key="pin" plain dimColor role="dismiss" label="×" onPress={() => togglePinned($)} />
    )

    const five = snap.fiveHour
    const week = snap.weekly

    // One line: 背景資訊視窗: 283.2k/1M (28%)   5hr: 3小時6分後重置 29%   每週・所有模型: 82%          ×
    const mine = (
      <Box key="usage" flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" flexWrap="wrap" columnGap={4} flexGrow={1} flexShrink={1}>
          <Text>
            <Text dimColor>背景資訊視窗: </Text>
            {`${fmtTokens(snap.tokens)}/${fmtTokens(snap.window)} `}
            <Text color={tone(snap.contextPct, BLUE)}>({fmtPct(snap.contextPct)})</Text>
          </Text>
          <Text>
            <Text dimColor>5hr: </Text>
            {five === null ? '—' : `${fmtReset(five.resetsAt, snap.at)} `}
            {five !== null && <Text color={tone(five.pct, BLUE)}>{fmtPct(five.pct)}</Text>}
          </Text>
          <Text>
            <Text dimColor>每週・所有模型: </Text>
            {week === null ? '—' : <Text color={tone(week.pct, AMBER)}>{fmtPct(week.pct)}</Text>}
          </Text>
        </Box>
        {/* At the far end, as the engine's own notices put their close mark. */}
        {pinButton}
      </Box>
    )


    return rest === null ? (
      mine
    ) : (
      <Box flexDirection="column">
        {mine}
        {/* A blank row between this band and the one below: a line drawn there did not
            show on the desktop, a row holding a non-breaking space does on every surface. */}
        <Text>{NBSP}</Text>
        {rest}
      </Box>
    )
  })
}
