import { KeyRound, Search, Trash2, UserCheck, UserX } from 'lucide-react'
import { toast } from 'sonner'
import type { DirectoryMember, EmployeeRole } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR, humanize } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { Avatar } from '@/shared/ui/avatar'
import { useRemoveMember, useSendReset, useUpdateMember } from './api'
import type { DirectoryFilters, SortKey } from './filters'

const ROLE_TONE: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  super_admin: 'success',
  admin: 'info',
  manager: 'warning',
  employee: 'neutral',
}

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning'> = {
  active: 'success',
  inactive: 'neutral',
  pending: 'warning',
}

const engagementLabel = (v: string | null): string =>
  v === 'freelancer' ? 'Freelancer' : v === 'in_house' ? 'In-house' : '—'

/**
 * The filter bar. Every control narrows the same list client-side: the whole
 * directory is one request and a studio's team is tens of people, so filtering
 * on the server would only add latency to a keystroke.
 */
export function DirectoryFiltersBar({
  filters,
  onChange,
  roles,
}: {
  filters: DirectoryFilters
  onChange: (next: DirectoryFilters) => void
  roles: readonly EmployeeRole[]
}) {
  const set = <K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) =>
    onChange({ ...filters, [key]: value })

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="relative lg:col-span-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Search by name, email or phone…"
          aria-label="Search team"
          className="pl-9"
        />
      </div>

      <Select value={filters.type} onChange={(e) => set('type', e.target.value)} aria-label="Engagement">
        <option value="">All types</option>
        <option value="in_house">In-house staff</option>
        <option value="freelancer">Freelancer / Vendor</option>
      </Select>

      <Select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="pending">Pending</option>
      </Select>

      <Select value={filters.role} onChange={(e) => set('role', e.target.value)} aria-label="Role">
        <option value="">All roles</option>
        <optgroup label="Access level">
          <option value="app:admin">Admin</option>
          <option value="app:manager">Manager</option>
          <option value="app:employee">Employee</option>
        </optgroup>
        {roles.length > 0 && (
          <optgroup label="Job role">
            {roles.map((r) => (
              <option key={r.id} value={`job:${r.id}`}>
                {r.type_name}
              </option>
            ))}
          </optgroup>
        )}
      </Select>

      <Input
        inputMode="numeric"
        value={filters.minSalary}
        onChange={(e) => set('minSalary', e.target.value)}
        placeholder="Min salary"
        aria-label="Minimum salary"
      />
      <Input
        inputMode="numeric"
        value={filters.maxSalary}
        onChange={(e) => set('maxSalary', e.target.value)}
        placeholder="Max salary"
        aria-label="Maximum salary"
      />

      <Select
        value={filters.sort}
        onChange={(e) => set('sort', e.target.value as SortKey)}
        aria-label="Sort"
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="name">Name (A–Z)</option>
        <option value="salary_high">Salary (high to low)</option>
        <option value="salary_low">Salary (low to high)</option>
      </Select>
    </div>
  )
}

export function DirectoryTable({
  rows,
  canManage,
  showSalary,
}: {
  rows: readonly DirectoryMember[]
  canManage: boolean
  showSalary: boolean
}) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {rows.map((m) => (
          <div key={m.user_id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={m.name} size="sm" />
                <div className="min-w-0">
                <p className="truncate font-medium">{m.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {[m.email, m.phone].filter(Boolean).join(' · ') || '—'}
                </p>
                </div>
              </div>
              <StatusBadge tone={STATUS_TONE[m.status] ?? 'neutral'}>{humanize(m.status)}</StatusBadge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge tone={ROLE_TONE[m.role] ?? 'neutral'}>{humanize(m.role)}</StatusBadge>
              <StatusBadge>{engagementLabel(m.engagement_type)}</StatusBadge>
              {showSalary && m.salary !== null && <StatusBadge>{formatINR(m.salary)}</StatusBadge>}
            </div>
            {canManage && (
              <div className="mt-3">
                <RowActions member={m} />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="table-wrap rounded-lg border border-border">
      <table className="table-sticky w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="min-w-56 px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Contact</th>
            <th className="px-4 py-2 font-medium">Access</th>
            <th className="px-4 py-2 font-medium">Job roles</th>
            <th className="px-4 py-2 font-medium">Engagement</th>
            <th className="px-4 py-2 font-medium">Status</th>
            {showSalary && <th className="px-4 py-2 text-right font-medium">Salary</th>}
            {canManage && (
              <th className="px-4 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.user_id} className="border-t border-border hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">
                <span className="flex items-center gap-2">
                  <Avatar name={m.name} size="sm" />
                  <span>{m.name}</span>
                  {!m.login_enabled && (
                    <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">
                      (no login)
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                <span className="block truncate">{m.email ?? '—'}</span>
                <span className="block truncate text-xs">{m.phone ?? '—'}</span>
              </td>
              <td className="px-4 py-2">
                <StatusBadge tone={ROLE_TONE[m.role] ?? 'neutral'}>{humanize(m.role)}</StatusBadge>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {m.role_names.length ? m.role_names.join(', ') : '—'}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{engagementLabel(m.engagement_type)}</td>
              <td className="px-4 py-2">
                <StatusBadge tone={STATUS_TONE[m.status] ?? 'neutral'}>{humanize(m.status)}</StatusBadge>
              </td>
              {showSalary && (
                <td className="px-4 py-2 text-right tabular-nums">
                  {m.salary === null ? '—' : formatINR(m.salary)}
                </td>
              )}
              {canManage && (
                <td className="px-4 py-2">
                  <RowActions member={m} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Owner-only row actions. Removal is soft on the server — the person stays on
 * the shoots and payouts they were part of, which is why it reads as "Remove"
 * rather than "Delete".
 */
function RowActions({ member }: { member: DirectoryMember }) {
  const update = useUpdateMember()
  const remove = useRemoveMember()
  const reset = useSendReset()
  const confirm = useConfirm()
  const isOwnerRow = member.role === 'super_admin'
  const active = member.status === 'active'

  async function onRemove() {
    const yes = await confirm({
      title: `Remove ${member.name}?`,
      description:
        'They lose access immediately. Their past shoots, tasks and payouts stay on the record.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (yes) remove.mutate(member.user_id)
  }

  if (isOwnerRow) return <span className="text-xs text-muted-foreground">Owner</span>

  return (
    <div className="row-actions flex items-center justify-end gap-1">
      {member.login_enabled && member.email && (
        <Button
          size="sm"
          variant="ghost"
          disabled={reset.isPending}
          title="Email them a password reset link"
          onClick={() =>
            reset.mutate(member.user_id, {
              onSuccess: () => toast.success(`Reset link sent to ${member.name}.`),
            })
          }
        >
          <KeyRound />
          <span className="sr-only sm:not-sr-only">Reset</span>
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={update.isPending}
        title={active ? 'Deactivate' : 'Activate'}
        onClick={() =>
          update.mutate({ userId: member.user_id, patch: { status: active ? 'inactive' : 'active' } })
        }
      >
        {active ? <UserX /> : <UserCheck />}
        <span className="sr-only">{active ? 'Deactivate' : 'Activate'}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={remove.isPending}
        title="Remove from the team"
        onClick={() => void onRemove()}
      >
        <Trash2 />
        <span className="sr-only">Remove</span>
      </Button>
    </div>
  )
}
