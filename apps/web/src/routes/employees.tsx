import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Download, Plus, ShieldCheck, Users } from 'lucide-react'
import type { DirectoryMember } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { HowToUse } from '@/shared/ui/how-to-use'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { downloadCsv } from '@/shared/ui/csv'
import { Select } from '@/shared/ui/input'
import { useDeleteMember, useDirectoryPaged, useEmployeeRoles, useUpdateMember } from '@/features/team/api'
import { AddMemberWizard } from '@/features/team/AddMemberWizard'
import { DeleteEmployeeDialog } from '@/features/team/DeleteEmployeeDialog'
import { DirectoryFiltersBar, DirectoryTable } from '@/features/team/DirectoryTable'
import { InvitationsPanel } from '@/features/team/InvitationsPanel'
import { InviteDialog } from '@/features/team/InviteDialog'
import { ManageAccessDialog } from '@/features/team/ManageAccessDialog'
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
  const { data: roles } = useEmployeeRoles()
  const [tab, setTab] = useState<DirectoryTab>('all')
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteTargets, setDeleteTargets] = useState<DirectoryMember[] | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [accessTarget, setAccessTarget] = useState<DirectoryMember | null>(null)

  // Server-paginated source: search + status narrow on the server, the rest
  // (tab, role, engagement, salary, sort) refines the loaded page client-side.
  const paged = useDirectoryPaged({
    page,
    page_size: pageSize,
    search: filters.q || undefined,
    status: filters.status || undefined,
  })
  const updateMember = useUpdateMember()
  const deleteMember = useDeleteMember()

  const isOwner = !!session?.is_owner
  const showSalary = access.hasModule('team_salaries')
  const canEdit = isOwner || access.hasAction('team_directory', 'edit')
  const canDelete = isOwner || access.hasAction('team_directory', 'delete')
  const pageItems = useMemo(() => paged.data?.items ?? [], [paged.data])
  const total = paged.data?.total ?? 0
  const members = pageItems
  const rows = useMemo(() => filterDirectory(members, tab, filters), [members, tab, filters])

  function resetPage(next: DirectoryFilters) {
    setFilters(next)
    setPage(1)
  }

  const onToggle = (userId: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(userId)
      else next.delete(userId)
      return next
    })
  }
  const onToggleAll = (on: boolean) => {
    setSelected(on ? new Set(rows.map((m) => m.user_id)) : new Set())
  }

  const selectedRows = useMemo(() => rows.filter((m) => selected.has(m.user_id)), [rows, selected])

  const exportCsv = (onlySelected = false) => {
    const list = onlySelected ? selectedRows : rows
    if (list.length === 0) {
      toast.error('Nothing to export.')
      return
    }
    downloadCsv(
      `team-directory-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(list),
    )
  }

  async function bulkStatus(status: 'active' | 'inactive') {
    if (selectedRows.length === 0) return
    try {
      await Promise.all(
        selectedRows.map((m) => updateMember.mutateAsync({ userId: m.user_id, patch: { status } })),
      )
      toast.success(
        `${selectedRows.length} member${selectedRows.length === 1 ? '' : 's'} ${status === 'active' ? 'activated' : 'deactivated'}.`,
      )
      setSelected(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk action failed.')
    }
  }

  async function confirmDelete(reason: string | null) {
    const targets = (deleteTargets ?? []).filter((m) => m.user_id !== session?.user_id)
    if (targets.length === 0) {
      setDeleteTargets(null)
      return
    }
    setDeletePending(true)
    try {
      await Promise.all(
        targets.map((m) => deleteMember.mutateAsync({ userId: m.user_id, reason })),
      )
      toast.success(`${targets.length} member${targets.length === 1 ? '' : 's'} deleted.`)
      setSelected(new Set())
      setDeleteTargets(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeletePending(false)
    }
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
          <Button variant="outline" onClick={() => exportCsv(false)} disabled={rows.length === 0}>
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
          { value: 'all', label: 'All', count: total },
          { value: 'freelance', label: 'Freelance / Non-salaried', count: total },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v)
          setPage(1)
        }}
      />

      <div className="mt-4">
        <DirectoryFiltersBar filters={filters} onChange={resetPage} roles={roles ?? []} />
      </div>

      {(canEdit || canDelete) && selected.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
          <span className="text-sm">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => void bulkStatus('active')}>
                Activate
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => void bulkStatus('inactive')}>
                Deactivate
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => exportCsv(true)}>
              Export selected
            </Button>
            {canDelete && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeleteTargets(selectedRows.filter((m) => m.user_id !== session?.user_id))}
              >
                Delete selected
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="mt-4">
        {paged.isLoading ? (
          <SkeletonList rows={5} columns={6} />
        ) : paged.isError ? (
          <ErrorState onRetry={() => void paged.refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              {total === 0 ? (
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
                      <Button variant="outline" onClick={() => resetPage(EMPTY_FILTERS)}>
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
            <DirectoryTable
              rows={rows}
              canManage={isOwner}
              showSalary={showSalary}
              selected={selected}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
              onDelete={(m) => setDeleteTargets([m])}
              onManageAccess={isOwner ? setAccessTarget : undefined}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" />
                Showing {rows.length} of {total}
                {paged.isFetching && ' · refreshing…'}
              </p>
              <div className="ml-auto flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                  aria-label="Page size"
                  className="h-8 w-24"
                >
                  <option value="10">10 / page</option>
                  <option value="25">25 / page</option>
                  <option value="50">50 / page</option>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">Page {page}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * pageSize >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <DeleteEmployeeDialog
        open={!!deleteTargets && deleteTargets.length > 0}
        onOpenChange={(v) => {
          if (!v) setDeleteTargets(null)
        }}
        count={deleteTargets?.length ?? 0}
        pending={deletePending}
        onConfirm={confirmDelete}
      />

      <ManageAccessDialog
        member={accessTarget}
        open={!!accessTarget}
        onOpenChange={(v) => {
          if (!v) setAccessTarget(null)
        }}
      />

      {isOwner && <InvitationsPanel />}
    </>
  )
}
