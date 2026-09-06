import { useMemo, useState } from 'react'
import { Trash2, Zap } from 'lucide-react'
import { describeRule, TRIGGER_LABEL, ACTION_LABEL } from '@ipc/domain'
import {
  createAutomationRequest,
  type AutomationAction,
  type AutomationTrigger,
  type CreateAutomationRequest,
  type LeadSource,
  type LeadStatus,
} from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { useMembers } from '@/features/allocation/api'
import { useAutomations, useCadences, useCreateAutomation, useDeleteAutomation, useUpdateAutomation } from '../api'
import { STAGES } from '../leads'

const SOURCES: LeadSource[] = ['facebook', 'webform', 'referral', 'manual', 'enquiry']
const TRIGGERS = Object.keys(TRIGGER_LABEL) as AutomationTrigger[]
const ACTIONS = Object.keys(ACTION_LABEL) as AutomationAction[]

/**
 * Rules the CRM runs on its own: when X happens to a lead that matches Y, do
 * Z. Evaluated in the database (on arrival and stage change) and by the
 * hourly sweep (overdue follow-ups), so they run whether or not anyone has
 * the page open.
 */
export function AutomationsSection() {
  const { data, isLoading, isError, error, refetch } = useAutomations()
  const members = useMembers()
  const update = useUpdateAutomation()
  const del = useDeleteAutomation()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')

  const cadences = useCadences()
  const userName = useMemo(() => {
    const map = new Map((members.data ?? []).map((m) => [m.user_id, m.name]))
    return (id: string) => map.get(id)
  }, [members.data])
  const cadenceName = useMemo(() => {
    const map = new Map((cadences.data ?? []).map((c) => [c.id, c.name]))
    return (id: string) => map.get(id)
  }, [cadences.data])

  async function onDelete(id: string, name: string) {
    if (await confirm({ title: `Delete the rule "${name}"?`, confirmLabel: 'Delete', destructive: true })) del.mutate(id)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-semibold tracking-tight">Automations</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Rules that act on leads by themselves — when one arrives, changes stage, or a follow-up slips.
        </p>
      </div>

      {canEdit && <RuleForm userName={userName} cadenceName={cadenceName} />}

      {isLoading ? (
        <SkeletonCards count={2} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No rules yet" description="Try: when a lead arrives from Facebook, mark it hot and notify the owner." />
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 ${r.is_active ? '' : 'opacity-60'}`}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Zap className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="text-sm text-muted-foreground">{describeRule(r, userName, cadenceName)}</p>
              </div>
              <StatusBadge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'On' : 'Off'}</StatusBadge>
              {canEdit && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: r.id, patch: { is_active: !r.is_active } })}>
                    {r.is_active ? 'Turn off' : 'Turn on'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void onDelete(r.id, r.name)}>
                    <Trash2 />
                    <span className="sr-only">Delete {r.name}</span>
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RuleForm({
  userName,
  cadenceName,
}: {
  userName: (id: string) => string | undefined
  cadenceName: (id: string) => string | undefined
}) {
  const create = useCreateAutomation()
  const members = useMembers()
  const cadences = useCadences()
  const [cadenceId, setCadenceId] = useState('')
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<AutomationTrigger>('lead_created')
  const [source, setSource] = useState('')
  const [toStatus, setToStatus] = useState('')
  const [action, setAction] = useState<AutomationAction>('mark_hot')
  const [userId, setUserId] = useState('')
  const [days, setDays] = useState('1')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const draft: CreateAutomationRequest = {
    name: name.trim(),
    trigger,
    condition: {
      ...(source ? { source: source as LeadSource } : {}),
      ...(trigger === 'stage_changed' && toStatus ? { to_status: toStatus as LeadStatus } : {}),
    },
    action,
    action_value: {
      ...(action === 'assign_to' && userId ? { user_id: userId } : {}),
      ...(action === 'set_follow_up_days' ? { days: Number(days) || 0 } : {}),
      ...(action === 'add_note' && note.trim() ? { note: note.trim() } : {}),
      ...(action === 'start_cadence' && cadenceId ? { cadence_id: cadenceId } : {}),
    },
    is_active: true,
  }

  function onSave() {
    setError(null)
    const parsed = createAutomationRequest.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the rule.')
      return
    }
    create.mutate(parsed.data, {
      onSuccess: () => {
        setName('')
        setSource('')
        setToStatus('')
        setNote('')
        setUserId('')
        setCadenceId('')
      },
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
        <p className="font-medium">New rule</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1 lg:col-span-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hot Facebook leads" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-trigger">When</Label>
            <Select id="rule-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}>
              {TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-source">From source</Label>
            <Select id="rule-source" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">any source</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          {trigger === 'stage_changed' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-to">Into stage</Label>
              <Select id="rule-to" value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
                <option value="">any stage</option>
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="rule-action">Then</Label>
            <Select id="rule-action" value={action} onChange={(e) => setAction(e.target.value as AutomationAction)}>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </Select>
          </div>
          {action === 'assign_to' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-user">Team member</Label>
              <Select id="rule-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Pick someone…</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {action === 'set_follow_up_days' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-days">Days from now</Label>
              <Input id="rule-days" type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          )}
          {action === 'start_cadence' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="rule-cadence">Cadence</Label>
              <Select id="rule-cadence" value={cadenceId} onChange={(e) => setCadenceId(e.target.value)}>
                <option value="">Pick a cadence…</option>
                {(cadences.data ?? [])
                  .filter((c) => c.is_active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          {action === 'add_note' && (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="rule-note">Note to add</Label>
              <Input id="rule-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Came in via the wedding campaign" />
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{describeRule(draft, userName, cadenceName)}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button onClick={onSave} disabled={create.isPending || name.trim().length < 2}>
            {create.isPending ? 'Saving…' : 'Save rule'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
