import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HardDrive, Plus, Check, Pencil, Trash2 } from 'lucide-react'
import { shootListItem, type CreateDataRecordRequest, type DataRecord } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useDataRecords, useVerifyData, useCreateDataRecord, useUpdateDataRecord, useDeleteDataRecord } from '@/features/data/api'
import { useProjects } from '@/features/projects/api'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const DATA_TYPES = ['Photos (RAW)', 'Photos (JPEG)', 'Video', 'Audio', 'Mixed']
const shootsList = shootListItem.array()

const TONE = { pending: 'neutral', copied: 'warning', verified: 'success' } as const

export function DataManagementPage() {
  return (
    <AuthedPage module="projects">
      <DataBoard />
    </AuthedPage>
  )
}

function DataBoard() {
  const { data, isLoading, isError, refetch } = useDataRecords()
  const verify = useVerifyData()
  const del = useDeleteDataRecord()
  const confirm = useConfirm()

  async function onDelete(r: DataRecord) {
    const yes = await confirm({
      title: 'Delete this record?',
      description: `${r.data_label}. This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (yes) del.mutate(r.id)
  }

  return (
    <>
      <PageHeader
        title="Data management"
        description="Track every card from shoot to primary and backup copy."
        actions={<AddRecordDialog />}
      />
      {isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No data logged" description="Log memory cards as they come off a shoot." action={<AddRecordDialog />} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Card / drive</th>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">Primary</th>
                <th className="px-4 py-2 font-medium">Backup</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2 font-medium">
                      <HardDrive className="size-4 text-muted-foreground" />
                      {r.data_label}
                    </span>
                    {r.data_type && <span className="ml-6 text-xs text-muted-foreground">{r.data_type}</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.project_name ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.size_gb} GB · {r.card_count} card(s)
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge tone={TONE[r.primary_status]}>{r.primary_status}</StatusBadge>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge tone={TONE[r.backup_status]}>{r.backup_status}</StatusBadge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {r.primary_status !== 'verified' && (
                        <Button size="sm" variant="outline" onClick={() => verify.mutate({ id: r.id, track: 'primary' })}>
                          <Check /> Primary
                        </Button>
                      )}
                      {r.backup_status !== 'verified' && (
                        <Button size="sm" variant="outline" onClick={() => verify.mutate({ id: r.id, track: 'backup' })}>
                          <Check /> Backup
                        </Button>
                      )}
                      <AddRecordDialog
                        record={r}
                        trigger={
                          <Button size="sm" variant="ghost" title="Edit">
                            <Pencil />
                          </Button>
                        }
                      />
                      {r.primary_status === 'pending' && r.backup_status === 'pending' && (
                        <Button size="sm" variant="ghost" title="Delete" onClick={() => void onDelete(r)}>
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function AddRecordDialog({ record, trigger }: { record?: DataRecord; trigger?: React.ReactNode } = {}) {
  const isEdit = !!record
  const create = useCreateDataRecord()
  const update = useUpdateDataRecord()
  const { data: projects } = useProjects()
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(record?.data_label ?? '')
  const [dataType, setDataType] = useState(record?.data_type ?? '')
  const [cards, setCards] = useState(String(record?.card_count ?? 1))
  const [size, setSize] = useState(String(record?.size_gb ?? ''))
  const [projectId, setProjectId] = useState(record?.project_id ?? '')
  const [shootId, setShootId] = useState(record?.shoot_id ?? '')
  const [error, setError] = useState<string | null>(null)

  const shoots = useQuery({
    queryKey: ['shoots', 'by-project', projectId],
    queryFn: () => callApi(`/shoots?project_id=${projectId}`, { responseSchema: shootsList }),
    enabled: !!session && !!projectId,
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const shared = {
        shoot_id: shootId || null,
        project_id: projectId || null,
        data_label: label.trim(),
        card_count: cards.trim() ? Number(cards) : 0,
        size_gb: size.trim() ? Number(size) : 0,
      }
      if (isEdit) {
        // Resend data_type explicitly (null clears it) instead of a falsy
        // value silently dropping the key from the patch.
        await update.mutateAsync({ id: record.id, patch: { ...shared, data_type: dataType || null } })
      } else {
        const body: CreateDataRecordRequest = { ...shared, ...(dataType ? { data_type: dataType } : {}) }
        await create.mutateAsync(body)
      }
      setOpen(false)
      if (!isEdit) {
        setLabel('')
        setDataType('')
        setCards('1')
        setSize('')
        setProjectId('')
        setShootId('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${isEdit ? 'update' : 'log'} the card.`)
    }
  }

  const busy = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> Log card
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={isEdit ? 'Edit card' : 'Log a card'} description="Record footage as it comes off a shoot.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="CF Card A (Cam 1)" required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value)
                  setShootId('')
                }}
              >
                <option value="">Not linked</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Shoot</Label>
              <Select value={shootId} onChange={(e) => setShootId(e.target.value)} disabled={!projectId}>
                <option value="">{projectId ? 'Whole project' : 'Pick a project first'}</option>
                {(shoots.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Data type</Label>
            <Select value={dataType} onChange={(e) => setDataType(e.target.value)}>
              <option value="">Unspecified</option>
              {DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Cards</Label>
              <Input inputMode="numeric" value={cards} onChange={(e) => setCards(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Size (GB)</Label>
              <Input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
            </div>
          </div>
          {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Log card'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
