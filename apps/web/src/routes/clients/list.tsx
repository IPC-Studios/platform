import { Users, Trash2 } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { useConfirm } from '@/shared/ui/confirm'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useClients, useDeleteClient } from '@/features/clients/api'
import { ClientFormDialog } from '@/features/clients/ClientFormDialog'

export function ClientsListPage() {
  return (
    <AuthedPage module="clients">
      <ClientsList />
    </AuthedPage>
  )
}

function ClientsList() {
  const { data, isLoading, isError, refetch } = useClients()
  const del = useDeleteClient()
  const confirm = useConfirm()
  const isMobile = useIsMobile()

  async function onDelete(id: string, name: string) {
    const yes = await confirm({
      title: `Delete ${name}?`,
      description: 'Clients with linked projects cannot be deleted.',
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (!yes) return
    del.mutate(id)
  }

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone your studio works with."
        actions={<ClientFormDialog />}
      />

      {isLoading ? (
        <SkeletonList rows={5} columns={5} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No clients yet"
          description="Add your first client to start creating projects."
          action={<ClientFormDialog />}
        />
      ) : isMobile ? (
        <div className="flex flex-col gap-3">
          {data.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[c.phone, c.city, c.relation].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <ClientFormDialog client={c} />
                  <Button variant="outline" size="icon" aria-label={`Delete ${c.name}`} onClick={() => void onDelete(c.id, c.name)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">City</th>
                <th className="px-4 py-2 font-medium">Relation</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      <Users className="size-4 text-muted-foreground" />
                      {c.name}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{c.phone ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.city ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.relation ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.email ?? '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <ClientFormDialog client={c} />
                      <Button variant="outline" size="icon" aria-label={`Delete ${c.name}`} onClick={() => void onDelete(c.id, c.name)}>
                        <Trash2 />
                      </Button>
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
