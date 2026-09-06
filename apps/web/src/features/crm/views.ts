import type { SavedViewQuery } from '@ipc/contracts'
import type { LeadQuery, QuickFilter } from './leads'
import { EMPTY_QUERY, QUICK_FILTERS } from './leads'

/**
 * Saved views — a filter set someone reaches for every morning, kept under a
 * name. They are stored on the API per person (crm_saved_views), so the same
 * views are there on every device.
 *
 * Views saved before that existed lived in this browser only; `takeLocalViews`
 * hands them over once so they can be pushed up, then forgets them.
 */
const LEGACY_KEY = 'ipc.crm.views'

const QUICK = new Set<string>(QUICK_FILTERS.map((f) => f.value))
const isQuickFilter = (v: unknown): v is QuickFilter => typeof v === 'string' && QUICK.has(v)

/** A query as stored on the API, narrowed to what the inbox understands. */
export function toLeadQuery(q: SavedViewQuery): LeadQuery {
  const status = q.status as LeadQuery['status']
  return {
    ...EMPTY_QUERY,
    search: q.search,
    filters: q.filters.filter(isQuickFilter),
    status: status === 'all' || ['new', 'contacted', 'qualified', 'proposal_sent', 'converted', 'lost'].includes(status) ? status : 'all',
    assignee: q.assignee || 'all',
  }
}

export function toSavedQuery(q: LeadQuery): SavedViewQuery {
  return { search: q.search, filters: [...q.filters], status: q.status, assignee: q.assignee }
}

/** Read and clear the pre-API browser store. Empty when there is nothing to migrate. */
export function takeLocalViews(): Array<{ name: string; query: SavedViewQuery }> {
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_KEY)
    if (!raw) return []
    globalThis.localStorage?.removeItem(LEGACY_KEY)
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((v) => {
      if (!v || typeof v !== 'object') return []
      const { name, query } = v as { name?: unknown; query?: unknown }
      if (typeof name !== 'string' || !query || typeof query !== 'object') return []
      const q = query as Partial<LeadQuery>
      return [
        {
          name,
          query: {
            search: typeof q.search === 'string' ? q.search : '',
            filters: Array.isArray(q.filters) ? q.filters.filter((f): f is string => typeof f === 'string') : [],
            status: typeof q.status === 'string' ? q.status : 'all',
            assignee: typeof q.assignee === 'string' ? q.assignee : 'all',
          },
        },
      ]
    })
  } catch {
    return []
  }
}

/** Whether a query is worth offering to save — an unfiltered list is not a view. */
export const isSaveable = (q: LeadQuery): boolean =>
  q.filters.length > 0 || q.status !== 'all' || q.assignee !== 'all' || q.search.trim() !== ''
