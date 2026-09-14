import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HardDrive, Plus, Check, Pencil, Trash2, Download, Settings2, AlertTriangle } from 'lucide-react'
import { shootListItem, type CreateDataRecordRequest, type DataRecord, type StorageLocationKind } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { StatCard } from '@/shared/ui/stat-card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { toCsv, downloadCsv } from '@/shared/ui/csv'
import {
  useDataRecords,
  useVerifyData,
  useCreateDataRecord,
  useUpdateDataRecord,
  useDeleteDataRecord,
  useStorageLocations,
  useCreateStorageLocation,
  useUpdateStorageLocation,
  useDeleteStorageLocation,
} from '@/features/data/api'
import { useProjects } from '@/features/projects/api'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const DATA_TYPES = ['Photos (RAW)', 'Photos (JPEG)', 'Video', 'Audio', 'Mixed']
const shootsList = shootListItem.array()

const TONE = { pending: 'neutral', copied: 'warning', verified: 'success' } as const

type StatusFilter = 'all' | 'missing' | 'primary_pending' | 'backup_pending' | 'ready' | 'at_risk'

/** Only one track verified while the other has no copy at all — a single point of failure. */
function isAtRisk(r: DataRecord): boolean {
  return (r.primary_status === 'verified' && r.backup_status === 'pending') ||
    (r.backup_status === 'verified' && r.primary_status === 'pending')
}

export function DataManagementPage() {
  return (
    <AuthedPage module="projects">
      <DataBoard />
    </AuthedPage>
  )
}

function DataBoard() {
  const { data, isLoading, isError, refetch } = useDataRecords()
  const { data: projects } = useProjects()
  const verify = useVerifyData()
  const del = useDeleteDataRecord()
  const confirm = useConfirm()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState('')
  const [dataType, setDataType] = useState('')

  const counts = useMemo(() => {
    const rows = data ?? []
    return {
      missing: rows.filter((r) => r.primary_status === 'pending' && r.backup_status === 'pending').length,
      primaryPending: rows.filter((r) => r.primary_status !== 'verified').length,
      backupPending: rows.filter((r) => r.backup_status !== 'verified').length,
      ready: rows.filter((r) => r.primary_status === 'verified' && r.backup_status === 'verified').length,
      atRisk: rows.filter(isAtRisk).length,
    }
  }, [data])

  const filtered = useMemo(() => {
    return (data ?? [])
      .filter((r) => {
        if (status === 'missing') return r.primary_status === 'pending' && r.backup_status === 'pending'
        if (status === 'primary_pending') return r.primary_status !== 'verified'
        if (status === 'backup_pending') return r.backup_status !== 'verified'
        if (status === 'ready') return r.primary_status === 'verified' && r.backup_status === 'verified'
        if (status === 'at_risk') return isAtRisk(r)
        return true
      })
      .filter((r) => !projectId || r.project_id === projectId)
      .filter((r) => !dataType || r.data_type === dataType)
      .filter((r) => {
        if (!search.trim()) return true
        const q = search.trim().toLowerCase()
        return r.data_label.toLowerCase().includes(q) || (r.project_name ?? '').toLowerCase().includes(q)
      })
  }, [data, status, projectId, dataType, search])

  function onExport() {
    downloadCsv(
      'data-records.csv',
      toCsv(
        ['Card / drive', 'Type', 'Project', 'Size (GB)', 'Cards', 'Primary status', 'Primary location', 'Backup status', 'Backup location', 'Verified at'],
        filtered.map((r) => [
          r.data_label,
          r.data_type ?? '',
          r.project_name ?? '',
          r.size_gb,
          r.card_count,
          r.primary_status,
          r.primary_location_name ?? '',
          r.backup_status,
          r.backup_location_name ?? '',
          r.verified_at ?? '',
        ]),
      ),
    )
  }

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
        actions={
          <div className="flex gap-2">
            <ManageLocationsDialog />
            <Button variant="outline" onClick={onExport} disabled={filtered.length === 0}>
              <Download /> Export CSV
            </Button>
            <AddRecordDialog />
          </div>
        }
      />
      {isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No data logged" description="Log memory cards as they come off a shoot." action={<AddRecordDialog />} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Missing" value={String(counts.missing)} icon={HardDrive} />
            <StatCard label="Primary pending" value={String(counts.primaryPending)} icon={HardDrive} />
            <StatCard label="Backup pending" value={String(counts.backupPending)} icon={HardDrive} />
            <StatCard label="Ready" value={String(counts.ready)} icon={Check} />
            <StatCard label="At risk" value={String(counts.atRisk)} icon={AlertTriangle} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs
              tabs={[
                { value: 'all', label: 'All' },
                { value: 'missing', label: 'Missing' },
                { value: 'primary_pending', label: 'Primary pending' },
                { value: 'backup_pending', label: 'Backup pending' },
                { value: 'ready', label: 'Ready' },
                { value: 'at_risk', label: 'At risk' },
              ]}
              value={status}
              onChange={setStatus}
            />
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-44" aria-label="Filter by project">
              <option value="">All projects</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select value={dataType} onChange={(e) => setDataType(e.target.value)} className="w-40" aria-label="Filter by type">
              <option value="">All types</option>
              {DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search card or project…"
              className="w-56"
              aria-label="Search data records"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="No records match" description="Try a different filter." />
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
                  {filtered.map((r) => (
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
                        {r.primary_location_name && (
                          <span className="ml-1.5 text-xs text-muted-foreground">{r.primary_location_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge tone={TONE[r.backup_status]}>{r.backup_status}</StatusBadge>
                        {r.backup_location_name && (
                          <span className="ml-1.5 text-xs text-muted-foreground">{r.backup_location_name}</span>
                        )}
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
        </div>
      )}
    </>
  )
}

const LOCATION_KINDS: { value: StorageLocationKind; label: string }[] = [
  { value: 'drive', label: 'Drive' },
  { value: 'nas', label: 'NAS' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'other', label: 'Other' },
]

/** The named drives/NAS/cloud destinations a card's primary or backup copy points to. */
function ManageLocationsDialog() {
  const { data: locations, isLoading } = useStorageLocations()
  const create = useCreateStorageLocation()
  const update = useUpdateStorageLocation()
  const del = useDeleteStorageLocation()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<StorageLocationKind>('drive')

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await create.mutateAsync({ name: name.trim(), kind })
    setName('')
    setKind('drive')
  }

  async function onDelete(id: string, label: string) {
    const yes = await confirm({
      title: 'Remove this location?',
      description: `${label}. Records pointing at it will show no location instead.`,
      destructive: true,
      confirmLabel: 'Remove',
    })
    if (yes) del.mutate(id)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 /> Locations
        </Button>
      </DialogTrigger>
      <DialogContent title="Storage locations" description="The drives, NAS shares and cloud destinations your copies live on.">
        <div className="flex flex-col gap-3">
          <form onSubmit={onAdd} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="NAS 2, Drive B, Google Drive…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Kind</Label>
              <Select value={kind} onChange={(e) => setKind(e.target.value as StorageLocationKind)} className="w-28">
                {LOCATION_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              <Plus /> Add
            </Button>
          </form>

          {isLoading ? (
            <SkeletonList rows={3} columns={2} />
          ) : !locations || locations.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No locations yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {locations.map((loc) => (
                <div key={loc.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <Input
                    defaultValue={loc.name}
                    className="flex-1"
                    onBlur={(e) => {
                      const value = e.target.value.trim()
                      if (value && value !== loc.name) update.mutate({ id: loc.id, patch: { name: value } })
                    }}
                  />
                  <Select
                    value={loc.kind}
                    onChange={(e) => update.mutate({ id: loc.id, patch: { kind: e.target.value as StorageLocationKind } })}
                    className="w-28"
                  >
                    {LOCATION_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="ghost" title="Remove" onClick={() => void onDelete(loc.id, loc.name)}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-2 flex justify-end">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
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
  const [primaryLocationId, setPrimaryLocationId] = useState(record?.primary_location_id ?? '')
  const [backupLocationId, setBackupLocationId] = useState(record?.backup_location_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const { data: locations } = useStorageLocations()

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
        primary_location_id: primaryLocationId || null,
        backup_location_id: backupLocationId || null,
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
        setPrimaryLocationId('')
        setBackupLocationId('')
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Primary location</Label>
              <Select value={primaryLocationId} onChange={(e) => setPrimaryLocationId(e.target.value)}>
                <option value="">Not set</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Backup location</Label>
              <Select value={backupLocationId} onChange={(e) => setBackupLocationId(e.target.value)}>
                <option value="">Not set</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
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
