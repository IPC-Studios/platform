import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ChevronDown, Copy, Facebook, Globe, Plus, Trash2 } from 'lucide-react'
import {
  createLeadSourceRequest,
  leadSourceRow,
  z,
  type CreateLeadSourceRequest,
  type LeadSourceKind,
  type LeadSourceRow,
  type UpdateLeadSourceRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { config } from '@/shared/config'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'

const list = leadSourceRow.array()
const noContent = z.any()

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The public URL a form or Meta posts to. Built from the same base the app
 * talks to, so what is shown is what will work — in dev that is a relative
 * path, which is honest about it only working from this machine.
 */
const endpointFor = (key: string): string => {
  const base = config.apiBaseUrl.startsWith('http')
    ? config.apiBaseUrl
    : `${window.location.origin}${config.apiBaseUrl}`
  return `${base}/webhooks/lead/${key}`
}

export function LeadSourcesPage() {
  return (
    <AuthedPage module="lead_sources">
      <LeadSources />
    </AuthedPage>
  )
}

function useSources() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['crm', 'sources'],
    queryFn: () => callApi('/crm/sources', { responseSchema: list }),
    enabled: !!session && access.hasModule('lead_sources'),
    staleTime: 30_000,
  })
}

function LeadSources() {
  const { data, isLoading, isError, refetch } = useSources()

  return (
    <>
      <PageHeader
        title="Lead sources"
        description="The forms and ad campaigns that drop leads straight into your CRM."
        actions={<NewSourceDialog />}
      />

      <HowToUse
        title="Connect a source once, then forget it"
        description="Each source has its own URL. Point a web form or a Meta lead-ads webhook at it and the leads arrive assigned, deduped, and ready to follow up."
        steps={[
          'Create a source and copy its URL.',
          'Point your form or ad account at it.',
          'Watch the lead count climb here.',
        ]}
      />

      <div className="mt-6">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : !data || data.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                title="No lead sources yet"
                description="Until a source exists, leads have to be typed in by hand. Create one and your website form can post straight into the CRM."
                action={<NewSourceDialog />}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {data.map((s) => (
              <SourceCard key={s.id} source={s} />
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        A source URL is a credential: anyone holding it can post leads into this studio. Pause or
        delete a source to stop it working.
      </p>
    </>
  )
}

function useSourceMutation<TInput>(fn: (input: TInput) => Promise<unknown>, success: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(success)
      void qc.invalidateQueries({ queryKey: ['crm', 'sources'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

function SourceCard({ source }: { source: LeadSourceRow }) {
  const [showSetup, setShowSetup] = useState(false)
  const [copied, setCopied] = useState(false)
  const confirm = useConfirm()

  const update = useSourceMutation(
    (patch: UpdateLeadSourceRequest) =>
      callApi(`/crm/sources/${source.id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
    'Lead source updated',
  )
  const remove = useSourceMutation(
    () => callApi(`/crm/sources/${source.id}`, { method: 'DELETE', responseSchema: noContent }),
    'Lead source deleted',
  )

  const url = endpointFor(source.source_key)
  const Icon = source.kind === 'meta' ? Facebook : Globe

  async function onDelete() {
    const yes = await confirm({
      title: `Delete ${source.label ?? 'this source'}?`,
      description:
        'The URL stops working immediately, so anything still posting to it will start failing. Leads it already brought in stay in your CRM.',
      confirmLabel: 'Delete source',
      destructive: true,
    })
    if (yes) remove.mutate(undefined as never)
  }

  return (
    <Card className={cn(!source.is_active && 'opacity-75')}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{source.label ?? source.source_key}</p>
            <p className="text-xs text-muted-foreground">
              {source.kind === 'meta' ? 'Meta lead ads' : 'Web form'} · added{' '}
              {dayFormat.format(new Date(source.created_at))}
            </p>
          </div>

          <StatusBadge tone={source.is_active ? 'success' : 'neutral'}>
            {source.is_active ? 'Active' : 'Paused'}
          </StatusBadge>
          <StatusBadge tone={source.lead_count > 0 ? 'info' : 'neutral'}>
            {source.lead_count} {source.lead_count === 1 ? 'lead' : 'leads'}
          </StatusBadge>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => update.mutate({ is_active: !source.is_active })}
            >
              {source.is_active ? 'Pause' : 'Resume'}
            </Button>
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => void onDelete()}>
              <Trash2 />
              <span className="sr-only">Delete {source.label ?? source.source_key}</span>
            </Button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(url)
              setCopied(true)
              toast.success('URL copied')
            }}
          >
            {copied ? <Check /> : <Copy />} Copy
          </Button>
        </div>

        {source.last_lead_at && (
          <p className="mt-2 text-xs text-muted-foreground">
            Last lead {dayFormat.format(new Date(source.last_lead_at))}
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowSetup((v) => !v)}
          className="mt-3 flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronDown className={cn('size-4 transition-transform', showSetup && 'rotate-180')} />
          How to connect this
        </button>

        {showSetup && <SetupHelp kind={source.kind} url={url} />}
      </CardContent>
    </Card>
  )
}

/** What to actually do with the URL, per kind. */
function SetupHelp({ kind, url }: { kind: LeadSourceKind; url: string }) {
  if (kind === 'meta') {
    return (
      <Help>
        <p>
          In Meta Business Suite, open your lead-ads webhook settings and add this as the callback
          URL. Meta verifies it with a challenge first — that handshake is already handled.
        </p>
        <Snippet>{url}</Snippet>
        <p>
          Each submitted lead form then posts here. Name, phone and email are read; everything else
          is kept on the lead as source data.
        </p>
      </Help>
    )
  }

  return (
    <Help>
      <p>Post a JSON body with at least a phone number. From your website:</p>
      <Snippet>{`fetch('${url}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: form.name.value,
    phone: form.phone.value,
    email: form.email.value,
  }),
})`}</Snippet>
      <p>Or to test it right now, from a terminal:</p>
      <Snippet>{`curl -X POST ${url} \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Test lead","phone":"9876543210"}'`}</Snippet>
      <p className="text-muted-foreground">
        A number that already exists returns the lead it matched instead of creating a second one,
        so a double-submitted form cannot split one enquiry in two.
      </p>
    </Help>
  )
}

function Help({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-4 text-sm">
      {children}
    </div>
  )
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
      {children}
    </pre>
  )
}

function NewSourceDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<LeadSourceKind>('webform')
  const [created, setCreated] = useState<LeadSourceRow | null>(null)
  const [copied, setCopied] = useState(false)

  const create = useMutation({
    mutationFn: (input: CreateLeadSourceRequest) =>
      callApi('/crm/sources', {
        method: 'POST',
        body: createLeadSourceRequest.parse(input),
        responseSchema: leadSourceRow,
      }),
    onSuccess: (row) => {
      setCreated(row)
      void qc.invalidateQueries({ queryKey: ['crm', 'sources'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function reset() {
    setLabel('')
    setKind('webform')
    setCreated(null)
    setCopied(false)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate({ label: label.trim(), kind })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New source
        </Button>
      </DialogTrigger>
      <DialogContent
        title={created ? 'Source ready' : 'New lead source'}
        description={
          created
            ? 'Point your form or ad account at this URL.'
            : 'Name it after where the leads come from — you will be reading this list in six months.'
        }
      >
        {created ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">
                {endpointFor(created.source_key)}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(endpointFor(created.source_key))
                  setCopied(true)
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Treat it like a password: anyone holding it can post leads into your CRM. You can
              always pause or delete the source.
            </p>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Website contact form"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Kind</Label>
              <Select value={kind} onChange={(e) => setKind(e.target.value as LeadSourceKind)}>
                <option value="webform">Web form — your site posts JSON</option>
                <option value="meta">Meta lead ads — Facebook or Instagram</option>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={create.isPending || label.trim().length < 2}>
                {create.isPending ? 'Creating…' : 'Create source'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
