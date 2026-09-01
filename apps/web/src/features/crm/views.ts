import type { LeadQuery, QuickFilter } from './leads'
import { EMPTY_QUERY } from './leads'

/**
 * Saved views — a filter set someone reaches for every morning, kept under a
 * name.
 *
 * They live in this browser, like the project draft: a view is a personal
 * working habit ("my overdue quotes"), not studio configuration, and syncing
 * one person's habit onto everyone else's screen would be wrong.
 */
export interface SavedView {
  name: string
  query: LeadQuery
}

const KEY = 'ipc.crm.views'

function isQuickFilter(v: unknown): v is QuickFilter {
  return typeof v === 'string'
}

/** Read stored views, discarding anything that no longer parses. */
export function loadViews(): SavedView[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((v): SavedView[] => {
      if (!v || typeof v !== 'object') return []
      const { name, query } = v as { name?: unknown; query?: unknown }
      if (typeof name !== 'string' || !query || typeof query !== 'object') return []
      const q = query as Partial<LeadQuery>
      return [
        {
          name,
          // Merge over the defaults so a view saved before a field existed
          // still opens instead of throwing.
          query: {
            ...EMPTY_QUERY,
            ...q,
            filters: Array.isArray(q.filters) ? q.filters.filter(isQuickFilter) : [],
          },
        },
      ]
    })
  } catch {
    return []
  }
}

function write(views: readonly SavedView[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(views))
  } catch {
    // A blocked localStorage costs the shortcut, not the page.
  }
}

/** Save under a name, replacing a view of the same name rather than doubling it. */
export function saveView(name: string, query: LeadQuery): SavedView[] {
  const trimmed = name.trim()
  if (!trimmed) return loadViews()
  const next = [...loadViews().filter((v) => v.name !== trimmed), { name: trimmed, query }]
  write(next)
  return next
}

export function deleteView(name: string): SavedView[] {
  const next = loadViews().filter((v) => v.name !== name)
  write(next)
  return next
}

/** Whether a query is worth offering to save — an unfiltered list is not a view. */
export const isSaveable = (q: LeadQuery): boolean =>
  q.filters.length > 0 || q.status !== 'all' || q.assignee !== 'all' || q.search.trim() !== ''
