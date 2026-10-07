/** One session's progress as every session reads it from the shared folder. */
export type ProgressEntry = {
  id: string
  title: string
  link?: string
  turnId: string
  status: 'running' | 'done'
  startedAt: number
  updatedAt: number
  endedAt?: number
  /** Steps Claude reported (TodoWrite / TaskCreate); total 0 when none. */
  done: number
  active: number
  total: number
  isClosed?: boolean
}

/** One row of the band, computed from an entry at poll time. */
export type ProgressRow = {
  id: string
  title: string
  link?: string
  turnId: string
  isSelf: boolean
  isDone: boolean
  pct: number
  etaMin: number | null
}

/** This session's running turn. */
export type CurrentTurn = {
  turnId: string
  startedAt: number
  title: string
  link?: string
  done: number
  active: number
  total: number
  isPublished: boolean
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

declare module 'claude-code' {
  interface PluginState {
    'task-progress': {
      rows: ProgressRow[]
      current: CurrentTurn | null
      tasks: Record<string, TaskStatus>
    }
  }
}
