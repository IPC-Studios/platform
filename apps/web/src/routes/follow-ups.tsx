import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import { crmLead, type LeadStatus } from '@ipc/contracts'
import { Megaphone } from 'lucide-react'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Select } from '@/shared/ui/input'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'

const list = crmLead.array()
const STAGES: { key: LeadStatus; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'converted', label: 'Converted' },
  { key: 'lost', label: 'Lost' },
]
const SOURCE_TONE = { facebook: 'info', webform: 'neutral', referral: 'success', manual: 'neutral', enquiry: 'warning' } as const

function useLeads() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['crm', 'leads'],
    queryFn: () => callApi('/crm/leads', { responseSchema: list }),
    enabled: !!session && access.hasModule('crm'),
    staleTime: 15_000,
  })
}

function useUpdateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      callApi(`/crm/leads/${id}`, { method: 'PATCH', body: { status }, responseSchema: z.any() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', 'leads'] }),
  })
}

export function FollowUpsPage() {
  return (
    <AuthedPage module="crm">
      <Pipeline />
    </AuthedPage>
  )
}

function Pipeline() {
  const { data, isLoading, isError, refetch } = useLeads()
  const update = useUpdateLead()

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  return (
    <>
      <PageHeader title="CRM pipeline" description="Leads from Facebook, web forms and referrals." />
      {!data || data.length === 0 ? (
        <EmptyState title="No leads yet" description="Leads captured from your sources appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {STAGES.map((stage) => {
            const stageLeads = data.filter((l) => l.status === stage.key)
            return (
              <div key={stage.key} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between px-1">
                  <span className="text-sm font-medium">{stage.label}</span>
                  <span className="text-xs text-muted-foreground">{stageLeads.length}</span>
                </div>
                {stageLeads.map((l) => (
                  <div key={l.id} className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Megaphone className="size-3.5 text-muted-foreground" />
                        {l.name ?? l.phone ?? 'Lead'}
                      </span>
                      <StatusBadge tone={SOURCE_TONE[l.source]}>{l.source}</StatusBadge>
                    </div>
                    {l.assignee_name && (
                      <p className="mt-1 text-xs text-muted-foreground">→ {l.assignee_name}</p>
                    )}
                    <Select
                      value={l.status}
                      onChange={(e) => update.mutate({ id: l.id, status: e.target.value as LeadStatus })}
                      className="mt-2 h-7 text-xs"
                    >
                      {STAGES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
