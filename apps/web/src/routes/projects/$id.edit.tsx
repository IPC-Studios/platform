import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Camera, Pencil } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { formatINR } from '@/shared/ui/format'
import type { ProjectStatus, UpdateProjectRequest } from '@ipc/contracts'
import { useProject, useUpdateProject } from '@/features/projects/api'
import { ShootsTab } from '@/features/projects/tabs/ShootsTab'

export function ProjectEditPage() {
  return (
    <AuthedPage module="projects">
      <ProjectEdit />
    </AuthedPage>
  )
}

/**
 * Full-page project editor (Lovable parity with _app.projects.$id.edit).
 *
 * The header dialog covers quick renames; this page is for the longer session:
 * project fields up top, live shoot planning underneath, and a close-confirm
 * so a stray Back press never eats unsaved work.
 */
function ProjectEdit() {
  const { id } = useParams({ from: '/authed/projects/$id/edit' })
  const navigate = useNavigate()
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const { data, isLoading, isError, refetch } = useProject(id)
  const update = useUpdateProject(id)
  const confirm = useConfirm()

  const [form, setForm] = useState<UpdateProjectRequest>({})
  const [packageCostText, setPackageCostText] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (data && !loaded) {
      setForm({
        name: data.name,
        status: data.status,
        package_cost: data.package_cost,
        show_quotation: data.show_quotation,
      })
      setPackageCostText(String(data.package_cost))
      setLoaded(true)
    }
  }, [data, loaded])

  if (isLoading) return <SkeletonCards count={3} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />
  if (!canEdit) {
    return <ErrorState message="No permission to edit projects. Ask an admin for projects:edit access, then try again." />
  }

  const received = data.payments.reduce((s, p) => s + p.amount, 0)
  const dirty =
    (form.name ?? '') !== data.name ||
    form.status !== data.status ||
    Number(form.package_cost ?? 0) !== data.package_cost ||
    (form.show_quotation ?? false) !== data.show_quotation
  const belowReceived = Number(form.package_cost ?? 0) < received

  // Warn on tab close / reload with unsaved work.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty && !update.isPending) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, update.isPending])

  async function onBack() {
    if (dirty && !update.isPending) {
      const leave = await confirm({
        title: 'Discard unsaved changes?',
        description: 'Your edits to this project have not been saved.',
        confirmLabel: 'Discard',
      })
      if (!leave) return
    }
    void navigate({ to: '/projects/$id', params: { id } })
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (belowReceived) {
      const yes = await confirm({
        title: `New total is below ${formatINR(received)} already received?`,
        description: 'The package no longer covers the money recorded. Continue anyway?',
        confirmLabel: 'Save anyway',
      })
      if (!yes) return
    }
    await update.mutateAsync(form)
    void navigate({ to: '/projects/$id', params: { id } })
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Projects', to: '/projects' },
          { label: data.name, to: `/projects/${id}` },
          { label: 'Edit' },
        ]}
      />
      <PageHeader
        title={`Edit ${data.name}`}
        description="Project fields up top, live shoot planning below. Nothing saves until you press Save."
        actions={
          <Button variant="outline" size="sm" onClick={() => void onBack()}>
            <ArrowLeft /> Back to project
          </Button>
        }
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Pencil className="size-4" aria-hidden /> Project details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input
                  value={form.name ?? ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Status</Label>
                  <Select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
                  >
                    <option value="active">Active</option>
                    <option value="on_hold">On hold</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Package (₹)</Label>
                  <Input
                    inputMode="decimal"
                    value={packageCostText}
                    onChange={(e) => {
                      setPackageCostText(e.target.value)
                      setForm({ ...form, package_cost: e.target.value.trim() ? Number(e.target.value) : 0 })
                    }}
                  />
                </div>
              </div>
              {belowReceived && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                  Received {formatINR(received)} already exceeds this package. Review the Billing tab after saving.
                </p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.show_quotation ?? false}
                  onChange={(e) => setForm({ ...form, show_quotation: e.target.checked })}
                />
                Show quotation to client
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => void onBack()}>
                  Cancel
                </Button>
                <Button type="submit" disabled={update.isPending || !dirty}>
                  {update.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
              {!dirty && (
                <p className="text-right text-xs text-muted-foreground">No unsaved changes.</p>
              )}
            </form>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Camera className="size-4" aria-hidden /> Shoots — live
            </CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Add, edit and schedule shoots here; every change saves immediately.
            </p>
          </CardHeader>
          <CardContent>
            <ShootsTab projectId={id} />
          </CardContent>
        </Card>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Prefer the client paperwork?{' '}
        <Link to="/projects/$id/quotation" params={{ id }} className="font-medium text-primary hover:underline">
          Open the staff quotation
        </Link>
        .
      </p>
    </>
  )
}
