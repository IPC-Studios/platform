import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { IndianRupee, Lock } from 'lucide-react'
import type { DirectoryMember } from '@ipc/contracts'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR, humanize } from '@/shared/ui/format'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { useDirectory, useUpdateMember } from './api'

/**
 * Salaries — the same people, seen through what they cost.
 *
 * Owner-only by default (module `team_salaries`): the API blanks the figure for
 * anyone else, so this tab would be a grid of dashes rather than a leak, but
 * showing it at all would still imply access that isn't there.
 */
export function SalariesTab() {
  const access = useAccess()
  const { data, isLoading, isError, refetch } = useDirectory()

  if (!access.hasModule('team_salaries')) {
    return (
      <Card className="mt-6">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Lock className="size-8 text-muted-foreground" />
          <p className="font-medium">Salaries are owner-only</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Ask the studio owner to grant you the Team salaries module if you need this.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  const rows = (data ?? []).filter((m) => m.role !== 'super_admin')
  const inHouse = rows.filter((m) => m.engagement_type !== 'freelancer')
  const monthly = inHouse.reduce((sum, m) => sum + (m.salary ?? 0), 0)
  const unset = rows.filter((m) => m.salary === null).length

  if (rows.length === 0) {
    return (
      <Card className="mt-6">
        <CardContent className="py-4">
          <EmptyState
            title="Nobody on payroll yet"
            description="Salaries are set per person, so this fills in as you add your team."
            action={
              <Button variant="outline" asChild>
                <Link to="/employees">Go to team directory</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Monthly payroll" value={formatINR(monthly)} icon />
        <Stat label="On payroll" value={`${inHouse.length}`} />
        <Stat label="Rate not set" value={`${unset}`} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Access</th>
              <th className="px-4 py-2 font-medium">Engagement</th>
              <th className="px-4 py-2 font-medium">Job roles</th>
              <th className="px-4 py-2 font-medium">Monthly salary / rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.user_id} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-2 font-medium">{m.name}</td>
                <td className="px-4 py-2">
                  <StatusBadge>{humanize(m.role)}</StatusBadge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {m.engagement_type === 'freelancer' ? 'Freelancer' : 'In-house'}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {m.role_names.length ? m.role_names.join(', ') : '—'}
                </td>
                <td className="px-4 py-2">
                  <SalaryCell member={m} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        {icon && (
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <IndianRupee className="size-4" />
          </span>
        )}
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Edit in place: setting pay is a column of numbers, and a dialog per person
 * turns a five-minute pass over the team into twenty clicks. Saves only when
 * the value actually changed.
 */
function SalaryCell({ member }: { member: DirectoryMember }) {
  const { session } = useAuth()
  const update = useUpdateMember()
  const [value, setValue] = useState(member.salary === null ? '' : String(member.salary))
  const original = member.salary === null ? '' : String(member.salary)
  const dirty = value.trim() !== original

  if (!session?.is_owner) {
    return <span className="tabular-nums">{member.salary === null ? '—' : formatINR(member.salary)}</span>
  }

  return (
    <span className="flex items-center gap-2">
      <Input
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Not set"
        aria-label={`Salary for ${member.name}`}
        className="h-8 w-36 tabular-nums"
      />
      {dirty && (
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({
              userId: member.user_id,
              patch: { salary: value.trim() === '' ? null : Number(value) },
            })
          }
        >
          Save
        </Button>
      )}
    </span>
  )
}
