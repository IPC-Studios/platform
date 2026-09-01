import { Users } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useClients } from '@/features/clients/api'
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
  const isMobile = useIsMobile()

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
              <p className="font-medium">{c.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {[c.phone, c.city].filter(Boolean).join(' · ') || '—'}
              </p>
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
                <th className="px-4 py-2 font-medium">Email</th>
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
                  <td className="px-4 py-2 text-muted-foreground">{c.email ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
