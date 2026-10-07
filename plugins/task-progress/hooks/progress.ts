import type { ProgressEntry, ProgressRow, TaskStatus } from '../types'

const MINUTE = 60_000

/** A turn shorter than this with no reported steps is a quick Q&A: never shown. */
export const MIN_VISIBLE_MS = 20_000
/** Finished tasks stay on the band this long. */
export const DONE_VISIBLE_MS = 30 * MINUTE
/** A running entry not refreshed for this long belongs to a dead process. */
export const STALE_MS = 90_000
/** With no reported steps, time alone drives the bar toward (never to) the end. */
const TIME_CONSTANT_MS = 10 * MINUTE

export type Steps = { done: number; active: number; total: number }

export const stepsFromTodos = (
  todos: readonly { status: string }[],
): Steps => ({
  done: todos.filter(t => t.status === 'completed').length,
  active: todos.filter(t => t.status === 'in_progress').length,
  total: todos.length,
})

export const stepsFromTasks = (tasks: Record<string, TaskStatus>): Steps => {
  const live = Object.values(tasks).filter(s => s !== 'deleted')
  return {
    done: live.filter(s => s === 'completed').length,
    active: live.filter(s => s === 'in_progress').length,
    total: live.length,
  }
}

/** Fraction 0..1: by steps when Claude reported any, otherwise by elapsed time. */
export const fraction = (entry: ProgressEntry, now: number): number => {
  if (entry.status === 'done') return 1
  if (entry.total > 0) {
    const f = (entry.done + 0.5 * entry.active) / entry.total
    return Math.min(0.99, Math.max(0, f))
  }
  const elapsed = Math.max(0, now - entry.startedAt)
  return 0.9 * (1 - Math.exp(-elapsed / TIME_CONSTANT_MS))
}

/** Minutes left, from the pace so far; null when there are no steps to pace by. */
export const etaMinutes = (entry: ProgressEntry, now: number): number | null => {
  if (entry.status === 'done' || entry.total === 0) return null
  const f = fraction(entry, now)
  if (f < 0.05) return null
  const elapsed = Math.max(0, now - entry.startedAt)
  return Math.max(1, Math.round((elapsed * (1 - f)) / f / MINUTE))
}

export const isVisible = (
  entry: ProgressEntry,
  now: number,
  dismissedTurn: string | undefined,
): boolean => {
  if (entry.isClosed || dismissedTurn === entry.turnId) return false
  if (entry.status === 'done') {
    return entry.endedAt !== undefined && now - entry.endedAt <= DONE_VISIBLE_MS
  }
  return now - entry.updatedAt <= STALE_MS
}

/** Whether this session's running turn has earned a row yet. */
export const isWorthShowing = (
  startedAt: number,
  total: number,
  now: number,
): boolean => total > 0 || now - startedAt >= MIN_VISIBLE_MS

export const toRows = (
  entries: readonly ProgressEntry[],
  dismissed: Record<string, string>,
  selfId: string,
  now: number,
): ProgressRow[] =>
  entries
    .filter(entry => isVisible(entry, now, dismissed[entry.id]))
    .sort((a, b) =>
      a.status === b.status
        ? a.startedAt - b.startedAt
        : a.status === 'running'
          ? -1
          : 1,
    )
    .map(entry => ({
      id: entry.id,
      title: entry.title,
      link: entry.link,
      turnId: entry.turnId,
      isSelf: entry.id === selfId,
      isDone: entry.status === 'done',
      pct: Math.round(fraction(entry, now) * 100),
      etaMin: etaMinutes(entry, now),
    }))

/** A rounded progress bar: a dark track with the filled part over it. */
export const barSvg = (
  pct: number,
  width: number,
  height: number,
  fill: string,
  track: string,
): string => {
  const r = height / 2
  const p = Math.max(0, Math.min(100, pct))
  // A sliver shorter than the bar is tall would draw as a squashed dot.
  const fw = p === 0 ? 0 : Math.max(height, Math.round((width * p) / 100))
  const filledRect = fw === 0 ? '' : `<rect width="${fw}" height="${height}" rx="${r}" fill="${fill}"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="${track}"/>${filledRect}</svg>`
  )
}

/** Cut to `width` display cells, CJK counted as two. */
export const fit = (text: string, width: number): string => {
  if (textWidth(text) <= width) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = cellWidth(ch)
    if (used + w > width - 1) break
    out += ch
    used += w
  }
  return `${out}…`
}

export const cellWidth = (ch: string): number => {
  const code = ch.codePointAt(0) ?? 0
  return (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
    ? 2
    : 1
}

export const textWidth = (text: string): number => {
  let w = 0
  for (const ch of text) w += cellWidth(ch)
  return w
}
