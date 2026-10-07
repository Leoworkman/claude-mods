import type { UsageSnap } from '../types'

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }
type ContextUsage = { tokens?: number; window: number; percent?: number }

/** Rate limits as last seen by any session, kept for a session that has had no response yet. */
export type CachedLimits = { rateLimits: RateLimit[]; at: number }

/** This session's own reading when it has one, otherwise the last one kept. */
export const pickLimits = (
  live: readonly RateLimit[],
  cached: CachedLimits | undefined,
): readonly RateLimit[] => (live.length > 0 ? live : cached?.rateLimits ?? [])

/** A window whose reset has passed since it was read starts over at 0%. */
const current = (r: RateLimit, at: number): { pct: number; resetsAt?: string } => {
  const resets = r.resetsAt === undefined ? NaN : Date.parse(r.resetsAt)
  return !Number.isNaN(resets) && resets <= at
    ? { pct: 0 }
    : { pct: r.percentUsed, resetsAt: r.resetsAt }
}

export const toSnap = (
  context: ContextUsage,
  rateLimits: readonly RateLimit[],
  at: number,
): UsageSnap => {
  const tokens = context.tokens ?? 0
  const five = rateLimits.find(r => r.kind === 'five_hour')
  const week = rateLimits.find(r => r.kind === 'seven_day')
  return {
    tokens,
    window: context.window,
    contextPct:
      context.percent ?? (context.window > 0 ? Math.round((tokens / context.window) * 100) : 0),
    fiveHour: five === undefined ? null : current(five, at),
    weekly: week === undefined ? null : { pct: current(week, at).pct },
    at,
  }
}

const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '')

/** 342200 → "342.2k", 1000000 → "1M". */
export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${trim(n / 1_000_000)}M` : n >= 1_000 ? `${trim(n / 1_000)}k` : String(n)

/** "3小時12分後重置"; empty when there is no reset time to count to. */
export const fmtReset = (resetsAt: string | undefined, now: number): string => {
  if (resetsAt === undefined) return ''
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''
  const mins = Math.max(0, Math.ceil((at - now) / 60_000))
  if (mins === 0) return '即將重置'
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rest = mins % 60
  if (days > 0) return `${days}天${hours}小時後重置`
  if (hours > 0) return `${hours}小時${rest}分後重置`
  return `${rest}分後重置`
}

export const fmtPct = (pct: number): string => `${Math.round(pct)}%`

/** How many of `width` cells a bar at `pct` fills. */
export const filled = (pct: number, width: number): number =>
  Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
