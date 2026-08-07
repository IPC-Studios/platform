import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check } from 'lucide-react'
import { notification, z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'

const list = notification.array()

function useNotifications() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => callApi('/notifications', { responseSchema: list }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/notifications/${id}/read`, { method: 'POST', responseSchema: z.any() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function NotificationsPage() {
  return (
    <AuthedPage module="crm">
      <Notifications />
    </AuthedPage>
  )
}

function Notifications() {
  const { data, isLoading, isError, refetch } = useNotifications()
  const markRead = useMarkRead()
  const unread = (data ?? []).filter((n) => !n.read_at).length

  return (
    <>
      <PageHeader title="Alerts" description={unread > 0 ? `${unread} unread` : 'All caught up.'} />
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No alerts" description="Reminders and updates will appear here." />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((n) => (
            <Card key={n.id} className={n.read_at ? 'opacity-60' : ''}>
              <CardContent className="flex items-start justify-between gap-4 p-4">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 rounded-md p-1.5 ${n.read_at ? 'bg-muted' : 'bg-primary/10 text-primary'}`}>
                    <Bell className="size-4" />
                  </span>
                  <div>
                    <p className="font-medium">{n.title}</p>
                    {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
                  </div>
                </div>
                {!n.read_at && (
                  <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                    <Check /> Mark read
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
