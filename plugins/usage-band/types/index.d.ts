/** One reading of the usage figures, taken after a response or on the timer. */
export type UsageSnap = {
  /** Input tokens of the last response; 0 before the first one. */
  tokens: number
  window: number
  contextPct: number
  /** The 5-hour window; null when the API reported none (an API key, no response yet). */
  fiveHour: { pct: number; resetsAt?: string } | null
  weekly: { pct: number } | null
  /** When it was read, so the reset countdown is drawn against it. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      snap: UsageSnap | null
      isPinned: boolean
    }
  }
}
