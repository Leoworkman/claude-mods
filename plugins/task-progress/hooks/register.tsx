import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CurrentTurn, ProgressEntry, ProgressRow, TaskStatus } from '../types'
import {
  barSvg,
  fit,
  isWorthShowing,
  stepsFromTasks,
  stepsFromTodos,
  textWidth,
  toRows,
} from './progress'
import type { Steps } from './progress'

const rowsAtom = atom({ plugin: 'task-progress', key: 'rows' } as const, [] as ProgressRow[])
const currentAtom = atom({ plugin: 'task-progress', key: 'current' } as const, null as CurrentTurn | null)
const tasksAtom = atom({ plugin: 'task-progress', key: 'tasks' } as const, {} as Record<string, TaskStatus>)

const TICK_MS = 3_000
const DAY_MS = 24 * 60 * 60_000
const ORANGE = '#d97757'
// A space the desktop keeps: a plain one alone on its row is collapsed away.
const NBSP = '\u00a0'
const GREEN = '#7f9a5a'
const TRACK = '#3a3a3a'
const BAR_HEIGHT_PX = 8
// About one terminal cell in the desktop's monospace text.
const CELL_PX = 8

let dir = ''
let selfId = ''
let infoTurn = ''
// Title and link of the last turn, so the next one starts with them.
let last: { title: string; link?: string } | undefined
// Timer ticks and turn ends write the same file: one at a time, in order.
let chain: Promise<void> = Promise.resolve()

function serial(work: () => Promise<void>): Promise<void> {
  const run = chain.then(work, work)
  chain = run.catch(() => undefined)
  return run
}

async function sharedDir($: EngineInterface): Promise<string> {
  if (dir === '') {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
    dir = `${home.replace(/\\/g, '/')}/.claude/task-progress`
  }
  return dir
}

// The desktop app's own record of this session: its sidebar title and a claude:// link.
async function sessionInfo($: EngineInterface): Promise<{ title?: string; link?: string }> {
  try {
    const res = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' })
    const block = res.content.find(b => b.type === 'text') as { text?: string } | undefined
    if (res.isError || block?.text === undefined) return {}
    const info = JSON.parse(block.text) as { title?: string; link?: string }
    return { title: info.title || undefined, link: info.link || undefined }
  } catch {
    return {}
  }
}

async function readJson<T>($: EngineInterface, path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return undefined
  }
}

async function publish($: EngineInterface, cur: CurrentTurn, status: 'running' | 'done'): Promise<void> {
  if (selfId === '') return
  const now = await $.clock.now()
  const entry: ProgressEntry = {
    id: selfId,
    title: cur.title,
    link: cur.link,
    turnId: cur.turnId,
    status,
    startedAt: cur.startedAt,
    updatedAt: now,
    endedAt: status === 'done' ? now : undefined,
    done: cur.done,
    active: cur.active,
    total: cur.total,
  }
  await $.fs.write(`${await sharedDir($)}/${selfId}.json`, JSON.stringify(entry))
}

async function poll($: EngineInterface): Promise<void> {
  const base = await sharedDir($)
  const now = await $.clock.now()
  const listing = await $.fs.list(base).catch(() => [])
  const entries: ProgressEntry[] = []
  for (const f of listing) {
    if (f.kind !== 'file' || !f.name.endsWith('.json') || now - f.mtimeMs > DAY_MS) continue
    const entry = await readJson<ProgressEntry>($, `${base}/${f.name}`)
    if (entry?.id !== undefined) entries.push(entry)
  }
  const dismissed: Record<string, string> = {}
  for (const f of await $.fs.list(`${base}/dismissed`).catch(() => [])) {
    const mark = await readJson<{ id: string; turnId: string }>($, `${base}/dismissed/${f.name}`)
    if (mark !== undefined) dismissed[mark.id] = mark.turnId
  }
  const rows = toRows(entries, dismissed, selfId, now)
  const was = await read($, rowsAtom)
  if (JSON.stringify(was) !== JSON.stringify(rows)) await update($, rowsAtom, () => rows)
}

function tick($: EngineInterface): Promise<void> {
  return serial(async () => {
    const cur = await read($, currentAtom)
    if (cur !== null && isWorthShowing(cur.startedAt, cur.total, await $.clock.now())) {
      let info: { title?: string; link?: string } = {}
      if (infoTurn !== cur.turnId) {
        infoTurn = cur.turnId
        info = await sessionInfo($)
      }
      await update($, currentAtom, c =>
        c?.turnId === cur.turnId
          ? { ...c, title: info.title ?? c.title, link: info.link ?? c.link, isPublished: true }
          : c,
      )
      const latest = await read($, currentAtom)
      if (latest?.turnId === cur.turnId) await publish($, latest, 'running')
    }
    await poll($)
  })
}

function finishTurn($: EngineInterface): Promise<void> {
  return serial(async () => {
    const cur = await read($, currentAtom)
    if (cur === null) return
    await update($, currentAtom, () => null)
    last = { title: cur.title, link: cur.link }
    if (cur.isPublished) await publish($, cur, 'done')
    await poll($)
  })
}

async function setSteps($: EngineInterface, steps: Steps): Promise<void> {
  await update($, currentAtom, c => (c === null ? c : { ...c, ...steps }))
}

async function dismiss($: EngineInterface, row: ProgressRow): Promise<void> {
  await $.fs.write(
    `${await sharedDir($)}/dismissed/${row.id}.json`,
    JSON.stringify({ id: row.id, turnId: row.turnId }),
  )
  await update($, rowsAtom, rows => rows.filter(r => r.id !== row.id))
}

async function openLink($: EngineInterface, link: string): Promise<void> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows ? ['rundll32', 'url.dll,FileProtocolHandler', link] : ['open', link]
  try {
    await $.process.run(argv, { timeoutMs: 10_000 })
  } catch {
    if (!isWindows) await $.process.run(['xdg-open', link], { timeoutMs: 10_000 }).catch(() => undefined)
  }
}

async function pressName($: EngineInterface, row: ProgressRow): Promise<void> {
  if (!row.isSelf && row.link !== undefined) await openLink($, row.link)
  if (row.isDone) await dismiss($, row)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    selfId = await $.session.id().catch(() => '')
    $.clock.every(TICK_MS, () => tick($))
    await tick($).catch(() => undefined)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    const steps = stepsFromTasks(await read($, tasksAtom))
    // A task list from an earlier turn that is all done starts over.
    const isStale = steps.done === steps.total
    if (isStale && steps.total > 0) await update($, tasksAtom, () => ({}))
    const firstLine = e.text.split('\n')[0]?.trim() ?? ''
    await update($, currentAtom, () => ({
      turnId: e.turnId,
      startedAt: now,
      title: last?.title ?? (firstLine.slice(0, 40) || 'Claude'),
      link: last?.link,
      isPublished: false,
      ...(isStale ? { done: 0, active: 0, total: 0 } : steps),
    }))
    return next(e)
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      await setSteps($, stepsFromTodos(e.todos))
    }
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const id = ran.result?.task?.id
      if (id !== undefined) {
        await update($, tasksAtom, t => ({ ...t, [id]: 'pending' as TaskStatus }))
        await setSteps($, stepsFromTasks(await read($, tasksAtom)))
      }
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const status = e.status
    if (e.agentId === undefined && status !== undefined && ran.deny === undefined && ran.isError !== true) {
      await update($, tasksAtom, t => ({ ...t, [e.taskId]: status }))
      await setSteps($, stepsFromTasks(await read($, tasksAtom)))
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await finishTurn($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const path = `${await sharedDir($)}/${selfId}.json`
    const entry = await readJson<ProgressEntry>($, path)
    if (entry !== undefined) {
      await $.fs.write(path, JSON.stringify({ ...entry, isClosed: true })).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const tree = await next(e)
    const rows = await read($, rowsAtom)
    if (e.props.hasSurvey || rows.length === 0) return tree

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const cols = e.props.bodyColumns
    const nameW = Math.max(10, Math.min(26, Math.floor(cols * 0.3)))
    const barW = Math.max(6, Math.min(60, cols - nameW - 2 - 5 - 6 - 3 - 4))
    const shown = rows.slice(0, Math.max(1, e.props.maxRows))

    // A rounded, thick bar where the surface draws SVG (desktop); solid blocks in a terminal.
    const bar = (row: ProgressRow, color: string) => {
      // The terminal's table names an Svg that draws nothing: ask the surface, not the table.
      if (e.surface !== 'terminal' && 'Svg' in ui) {
        const { Svg } = ui
        const width = barW * CELL_PX
        return (
          <Svg
            key={`bar-${row.id}`}
            source={barSvg(row.pct, width, BAR_HEIGHT_PX, color, TRACK)}
            alt={`${row.title} ${row.pct}%`}
            width={width}
            height={BAR_HEIGHT_PX}
          />
        )
      }
      const filled = Math.round((row.pct / 100) * barW)
      return (
        <Text key={`bar-${row.id}`}>
          <Text color={color}>{'█'.repeat(filled)}</Text>
          <Text color={TRACK}>{'█'.repeat(barW - filled)}</Text>
        </Text>
      )
    }

    const mine = (
      <Box key="task-progress" flexDirection="column">
        {shown.map(row => {
          const color = row.isDone ? GREEN : ORANGE
          const name = fit(row.title, nameW - 1)
          return (
            <Box key={`row-${row.id}`} flexDirection="row" alignItems="center" justifyContent="space-between">
              <Box flexDirection="row" alignItems="center" gap={1} flexGrow={1} flexShrink={1}>
                <Text color={color}>{row.isDone ? '✓' : '●'}</Text>
                <Box width={nameW}>
                  <Button
                    key={`open-${row.id}`}
                    plain
                    dimColor={row.isDone}
                    label={name + ' '.repeat(Math.max(0, nameW - 1 - textWidth(name)))}
                    onPress={() => pressName($, row)}
                  />
                </Box>
                {bar(row, color)}
                {/* Columns by box width, not padding: the desktop collapses runs of spaces. */}
                <Box width={4} justifyContent="flex-end">
                  <Text bold>{`${row.pct}%`}</Text>
                </Box>
                <Box width={5}>
                  <Text dimColor>{row.etaMin === null ? NBSP : `~${row.etaMin}m`}</Text>
                </Box>
              </Box>
              {/* At the far end, level with the usage line's own ×. */}
              <Button key={`hide-${row.id}`} plain label="×" onPress={() => dismiss($, row)} />
            </Box>
          )
        })}
      </Box>
    )


    // Another plugin's band drawn below this one stays; the engine's own is empty here.
    return tree.type === 'engine' ? (
      mine
    ) : (
      <Box flexDirection="column">
        {mine}
        {/* A blank row between this band and the one below: a line drawn there did not
            show on the desktop, a row holding a non-breaking space does on every surface. */}
        <Text>{NBSP}</Text>
        {tree}
      </Box>
    )
  })
}
