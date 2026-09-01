import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Download, Plus, ShieldCheck, Users } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { HowToUse } from '@/shared/ui/how-to-use'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { useDirectory, useEmployeeRoles } from '@/features/team/api'
import { AddMemberWizard } from '@/features/team/AddMemberWizard'
import { DirectoryFiltersBar, DirectoryTable } from '@/features/team/DirectoryTable'
import { InvitationsPanel } from '@/features/team/InvitationsPanel'
import { InviteDialog } from '@/features/team/InviteDialog'
import { SalariesTab } from '@/features/team/SalariesTab'
import {
  EMPTY_FILTERS,
  filterDirectory,
  hasActiveFilters,
  toCsv,
  type DirectoryFilters,
  type DirectoryTab,
} from '@/features/team/filters'

export function EmployeesPage() {
  return (
    <AuthedPage module="team_directory">
      <TeamPage />
    </AuthedPage>
  )
}

type Section = 'directory' | 'salaries'

function TeamPage() {
  const [section, setSection] = useState<Section>('directory')
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage employees, managers, salaries, and role assignments."
      />

      <SectionTabs<Section>
        tabs={[
          { value: 'directory', label: 'Directory' },
          { value: 'salaries', label: 'Salaries' },
        ]}
        value={section}
        onChange={(v) => {
          setSection(v)
          setAdding(false)
        }}
      />

      {adding ? (
        <div className="mt-6">
          <AddMemberWizard onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
        </div>
      ) : section === 'salaries' ? (
        <SalariesTab />
      ) : (
        <Directory onAdd={() => setAdding(true)} />
      )}
    </>
  )
}

function Directory({ onAdd }: { onAdd: () => void }) {
  const { session } = useAuth()
  const access = useAccess()
  const { data, isLoading, isError, refetch } = useDirectory()
  const { data: roles } = useEmployeeRoles()
  const [tab, setTab] = useState<DirectoryTab>('all')
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_FILTERS)

  const isOwner = !!session?.is_owner
  const showSalary = access.hasModule('team_salaries')
  const members = useMemo(() => data ?? [], [data])
  const rows = useMemo(() => filterDirectory(members, tab, filters), [members, tab, filters])

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `team-directory-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <HowToUse
        className="mt-6"
        title="Manage your team"
        description="Add photographers, editors, managers, and other team members here."
        steps={[
          'Create team roles first.',
          'Add team members with login access.',
          'Assign them to shoots and tasks.',
        ]}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Team Directory</h2>
        <div className="flex flex-wrap items-center gap-2">
          {access.hasModule('team_roles') && (
            <Button variant="outline" asChild>
              <Link to="/settings/roles">
                <ShieldCheck /> Roles &amp; Access
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download /> Export CSV
          </Button>
          {isOwner && <InviteDialog />}
          {isOwner && (
            <Button onClick={onAdd}>
              <Plus /> Add Team Member
            </Button>
          )}
        </div>
      </div>

      <FilterTabs<DirectoryTab>
        className="mt-4"
        tabs={[
          { value: 'all', label: 'All', count: members.length },
          {
            value: 'freelance',
            label: 'Freelance / Non-salaried',
            count: members.filter((m) => m.engagement_type === 'freelancer').length,
          },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        <DirectoryFiltersBar filters={filters} onChange={setFilters} roles={roles ?? []} />
      </div>

      <div className="mt-4">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              {members.length === 0 ? (
                <EmptyState
                  title="No employees found yet."
                  description="Add your first employee to start building your team."
                  action={isOwner ? <Button onClick={onAdd}>Add Employee</Button> : undefined}
                />
              ) : (
                <EmptyState
                  title="Nobody matches these filters."
                  description="Try a different search, or clear the filters to see everyone."
                  action={
                    hasActiveFilters(filters) ? (
                      <Button variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <DirectoryTable rows={rows} canManage={isOwner} showSalary={showSalary} />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5" />
              Showing {rows.length} of {members.length}
            </p>
          </>
        )}
      </div>

      {isOwner && <InvitationsPanel />}
    </>
  )
}
