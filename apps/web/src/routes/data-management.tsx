import { useState, type FormEvent } from 'react'
import { HardDrive, Plus, Check } from 'lucide-react'
import type { CreateDataRecordRequest } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useDataRecords, useVerifyData, useCreateDataRecord } from '@/features/data/api'

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
                  </td>
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
                    {(r.primary_status !== 'verified' || r.backup_status !== 'verified') && (
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
                      </div>
                    )}
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

function AddRecordDialog() {
  const create = useCreateDataRecord()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [cards, setCards] = useState(1)
  const [size, setSize] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const body: CreateDataRecordRequest = {
        shoot_id: null,
        project_id: null,
        data_label: label.trim(),
        card_count: cards,
        size_gb: size,
      }
      await create.mutateAsync(body)
      setOpen(false)
      setLabel('')
      setCards(1)
      setSize(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log the card.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Log card
        </Button>
      </DialogTrigger>
      <DialogContent title="Log a card" description="Record footage as it comes off a shoot.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="CF Card A (Cam 1)" required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Cards</Label>
              <Input type="number" min={0} value={cards} onChange={(e) => setCards(Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Size (GB)</Label>
              <Input type="number" min={0} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Log card'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
