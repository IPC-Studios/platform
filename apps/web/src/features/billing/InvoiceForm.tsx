import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, Plus, Search, Trash2 } from 'lucide-react'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import {
  GSTIN_REGEX,
  companyProfile,
  formatBankSnapshot,
  type Client,
  type CreateInvoiceRequest,
  type GstState,
  type InvoiceLineInput,
} from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useActiveLookups, useCreateCustomLookup } from '@/features/settings/api'
import { useClients } from '@/features/clients/api'
import { useProjects, useProject } from '@/features/projects/api'
import { useConfirm } from '@/shared/ui/confirm'
import {
  useInvoiceBankAccounts,
  useInvoiceTemplates,
  useInvoiceNoteTemplates,
  useCreateInvoiceNoteTemplate,
} from './api'

export const GST_SLABS: GstSlab[] = [0, 5, 12, 18, 28]

export const todayISO = () => new Date().toISOString().slice(0, 10)

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso || todayISO())
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export interface InvoiceFormValues {
  client_id: string
  project_id: string
  place_of_supply: string
  intra_state: boolean
  /** "No GST" mode — all lines forced to 0% and the GST UI hides. */
  no_gst: boolean
  /** Per-invoice GSTIN snapshot (Lovable parity) — validated when GST applies. */
  gst_number: string
  /** Draft stays editable; sent is client-facing. */
  status: 'draft' | 'sent'
  invoice_date: string
  due_date: string
  discount: number
  discount_type: 'flat' | 'percent' | 'none'
  notes: string
  /** Per-invoice snapshot; blank falls back to the print layout. */
  bank_details: string
  terms: string
  template_id: string
  /** Create only -- blank means auto-numbered. Never sent on an edit. */
  invoice_number: string
  lines: InvoiceLineInput[]
}

export function emptyInvoiceForm(): InvoiceFormValues {
  return {
    client_id: '',
    project_id: '',
    place_of_supply: '27',
    intra_state: true,
    no_gst: false,
    gst_number: '',
    status: 'draft',
    invoice_date: todayISO(),
    due_date: '',
    discount: 0,
    discount_type: 'none',
    notes: '',
    bank_details: '',
    terms: '',
    template_id: '',
    invoice_number: '',
    lines: [{ description: '', quantity: 1, rate: 0, gst_rate: 18 }],
  }
}

/** The create form's field set as a hook, reused by the edit dialog so both stay in lockstep. */
export function useInvoiceForm(initial: InvoiceFormValues) {
  const [values, setValues] = useState(initial)

  function set<K extends keyof InvoiceFormValues>(key: K, value: InvoiceFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function patchLine(i: number, p: Partial<InvoiceLineInput>) {
    setValues((v) => ({ ...v, lines: v.lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)) }))
  }

  const totals = useMemo(
    () =>
      computeInvoice(
        values.lines.filter((l) => l.description.trim()).map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
        {
          intraState: values.intra_state,
          discount: values.discount_type === 'none' ? 0 : values.discount,
          discountType: values.discount_type === 'none' ? 'flat' : values.discount_type,
        },
      ),
    [values.lines, values.intra_state, values.discount, values.discount_type],
  )

  function toRequest(): CreateInvoiceRequest {
    const discountNone = values.discount_type === 'none'
    return {
      client_id: values.client_id || null,
      project_id: values.project_id || null,
      place_of_supply: values.place_of_supply,
      intra_state: values.intra_state,
      invoice_date: values.invoice_date || undefined,
      due_date: values.due_date || undefined,
      discount: discountNone ? 0 : values.discount,
      discount_type: values.discount_type,
      status: values.status,
      gst_number: values.gst_number.trim() ? values.gst_number.trim().toUpperCase() : undefined,
      notes: values.notes.trim() || undefined,
      bank_details: values.bank_details.trim() || undefined,
      terms: values.terms.trim() || undefined,
      template_id: values.template_id || null,
      invoice_number: values.invoice_number.trim() || undefined,
      lines: values.lines.filter((l) => l.description.trim()),
    }
  }

  function reset() {
    setValues(emptyInvoiceForm())
  }

  return { values, set, patchLine, totals, toRequest, reset }
}

/** A studio-defined shortcut that appends one line item with that name, without leaving the form. */
function QuickAddLine({ onAdd }: { onAdd: (description: string) => void }) {
  const { session } = useAuth()
  const { data: presets } = useActiveLookups('invoice_line_preset')
  const createLookup = useCreateCustomLookup()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  async function onSaveNew() {
    if (!name.trim()) return
    await createLookup.mutateAsync({ category: 'invoice_line_preset', value: name.trim() })
    onAdd(name.trim())
    setAdding(false)
    setName('')
  }

  if (adding) {
    return (
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Second Photographer" autoFocus className="w-56" />
        <Button type="button" size="sm" onClick={() => void onSaveNew()} disabled={!name.trim() || createLookup.isPending}>
          Add
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Select
      value=""
      onChange={(e) => {
        if (e.target.value === '__add__') setAdding(true)
        else if (e.target.value) onAdd(e.target.value)
      }}
      className="w-56"
    >
      <option value="">Quick add…</option>
      {(presets ?? []).map((p) => (
        <option key={p.id} value={p.value}>
          {p.value}
        </option>
      ))}
      {session?.is_owner && <option value="__add__">+ Add new preset…</option>}
    </Select>
  )
}

/** A searchable dropdown over the client list -- matches by name, phone or email. */
function ClientCombobox({
  clients,
  value,
  onChange,
}: {
  clients: Client[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const selected = clients.find((c) => c.id === value)

  useEffect(() => {
    if (open) search.current?.focus()
    else setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const q = query.trim().toLowerCase()
  const matches = q
    ? clients.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || (c.email ?? '').toLowerCase().includes(q))
    : clients

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-sm',
          !value && 'text-muted-foreground',
        )}
      >
        <span className="truncate">{selected ? selected.name : 'Select a client…'}</span>
        <Search className="size-4 shrink-0 opacity-50" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          className="ipc-menu absolute left-0 top-full z-40 mt-1 w-full min-w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="border-b border-border p-2">
            <Input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone or email…" />
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {matches.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No client matches "{query}".</p>
            ) : (
              matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={c.id === value}
                  onClick={() => {
                    onChange(c.id)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    {(c.phone || c.email) && (
                      <p className="truncate text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  {c.id === value && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** A "Templates ▾" picker that fills Notes from a saved snippet, plus a "+ Save" to add the current text as one. */
function NoteTemplatePicker({ notes, onFill }: { notes: string; onFill: (content: string) => void }) {
  const { data } = useInvoiceNoteTemplates()
  const createTemplate = useCreateInvoiceNoteTemplate()
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const templates = (data?.items ?? []).filter((t) => (t.template_type ?? 'note') === 'note')

  async function onSave() {
    if (!title.trim() || !notes.trim()) return
    await createTemplate.mutateAsync({ title: title.trim(), content: notes.trim(), template_type: 'note', is_default: false })
    setSaving(false)
    setTitle('')
  }

  if (saving) {
    return (
      <div className="flex items-center gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Template name" autoFocus className="h-7 w-40 text-xs" />
        <Button type="button" size="sm" className="h-7" onClick={() => void onSave()} disabled={!title.trim() || createTemplate.isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setSaving(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {templates.length > 0 && (
        <Select
          value=""
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value)
            if (t) onFill(t.content)
          }}
          className="h-7 w-40 text-xs"
        >
          <option value="">Templates…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
      )}
      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSaving(true)} disabled={!notes.trim()}>
        + Save as template
      </Button>
    </div>
  )
}

/** Same picker for the Terms field (template_type = 'terms'). */
function TermsTemplatePicker({ terms, onFill }: { terms: string; onFill: (content: string) => void }) {
  const { data } = useInvoiceNoteTemplates()
  const createTemplate = useCreateInvoiceNoteTemplate()
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const templates = (data?.items ?? []).filter((t) => (t.template_type ?? 'note') === 'terms')

  async function onSave() {
    if (!title.trim() || !terms.trim()) return
    await createTemplate.mutateAsync({ title: title.trim(), content: terms.trim(), template_type: 'terms', is_default: false })
    setSaving(false)
    setTitle('')
  }

  if (saving) {
    return (
      <div className="flex items-center gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Template name" autoFocus className="h-7 w-40 text-xs" />
        <Button type="button" size="sm" className="h-7" onClick={() => void onSave()} disabled={!title.trim() || createTemplate.isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setSaving(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {templates.length > 0 && (
        <Select
          value=""
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value)
            if (t) onFill(t.content)
          }}
          className="h-7 w-40 text-xs"
        >
          <option value="">Templates…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
      )}
      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSaving(true)} disabled={!terms.trim()}>
        + Save as template
      </Button>
    </div>
  )
}

/** Bank account picker — fills the per-invoice bank_details snapshot. */
function BankAccountPicker({ onFill }: { onFill: (snapshot: string) => void }) {
  const { data } = useInvoiceBankAccounts()
  const items = data?.items ?? []
  if (items.length === 0) return null
  return (
    <Select
      value=""
      onChange={(e) => {
        const b = items.find((x) => x.id === e.target.value)
        if (b) onFill(formatBankSnapshot(b))
      }}
      className="h-7 w-44 text-xs"
    >
      <option value="">Bank / UPI…</option>
      {items.map((b) => (
        <option key={b.id} value={b.id}>
          {b.label}
          {b.is_default ? ' ★' : ''}
        </option>
      ))}
    </Select>
  )
}

/** Every field the create form sets, shared verbatim by the edit dialog. */
export function InvoiceFormFields({
  form,
  states,
  isEdit = false,
}: {
  form: ReturnType<typeof useInvoiceForm>
  states: GstState[] | undefined
  /** A number only ever applies once, at creation -- hides the override field on an edit. */
  isEdit?: boolean
}) {
  const { values, set, patchLine, totals } = form
  const { data: clientsData } = useClients()
  const clients = Array.isArray(clientsData) ? clientsData : (clientsData?.items ?? [])
  const { data: projects } = useProjects()
  const { data: templateData } = useInvoiceTemplates()
  const { data: noteData } = useInvoiceNoteTemplates()
  const { data: bankData } = useInvoiceBankAccounts()
  const { data: company } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
    staleTime: 60_000,
  })
  const templates = templateData?.items
  const selectedClient = clients.find((c) => c.id === values.client_id)
  const clientGstin = (selectedClient?.gstin ?? '').trim().toUpperCase()
  const clientGstinValid = !clientGstin || GSTIN_REGEX.test(clientGstin)
  const clientProjects = (projects ?? []).filter((p) => !values.client_id || p.client_id === values.client_id)
  const linkedProject = useProject(values.project_id)
  const confirm = useConfirm()

  // Branding prefill (new invoices only): company defaults fill blank
  // notes/terms/bank_details once, without stomping what was typed.
  useEffect(() => {
    if (isEdit || !company) return
    const defNote = (noteData?.items ?? []).find((t) => (t.template_type ?? 'note') === 'note' && t.is_default)
    const defTerms = (noteData?.items ?? []).find((t) => (t.template_type ?? 'note') === 'terms' && t.is_default)
    const defBank = (bankData?.items ?? []).find((b) => b.is_default)
    if (!values.notes && (defNote?.content || company.invoice_default_notes)) {
      set('notes', defNote?.content ?? company.invoice_default_notes ?? '')
    }
    if (!values.terms && (defTerms?.content || company.invoice_default_terms)) {
      set('terms', defTerms?.content ?? company.invoice_default_terms ?? '')
    }
    if (!values.bank_details && (defBank ? formatBankSnapshot(defBank) : company.invoice_bank_details)) {
      set('bank_details', defBank ? formatBankSnapshot(defBank) : (company.invoice_bank_details ?? ''))
    }
  }, [company?.invoice_default_notes, company?.invoice_default_terms, company?.invoice_bank_details, noteData, bankData, isEdit])

  // Smart autofill when a project is picked: due +7d and `Invoice for X`
  // fill blanks only, so an explicit choice is never overwritten.
  useEffect(() => {
    const p = linkedProject.data
    if (!p || isEdit) return
    if (!values.due_date && values.invoice_date) {
      set('due_date', addDaysISO(values.invoice_date, 7))
    }
    if (!values.notes.trim()) {
      set('notes', `Invoice for ${p.name}`)
    }
  }, [linkedProject.data?.id])

  function setNoGst(on: boolean) {
    set('no_gst', on)
    if (on) {
      set(
        'lines',
        values.lines.map((l) => ({ ...l, gst_rate: 0 })),
      )
    }
  }

  // Appends rather than replaces, so importing twice (package, then balance) builds
  // one invoice out of both — but a second import onto lines someone already typed
  // by hand is worth a check first.
  async function importFromProject(kind: 'package' | 'deliverables' | 'balance') {
    const p = linkedProject.data
    if (!p) return
    if (values.lines.some((l) => l.description.trim())) {
      const yes = await confirm({
        title: 'Add to the existing line items?',
        description: 'This adds new lines alongside what is already here, rather than replacing them.',
        confirmLabel: 'Add',
      })
      if (!yes) return
    }
    const zeroGst = values.no_gst ? 0 : 18
    if (kind === 'package') {
      if (p.package_cost <= 0) return
      set('lines', [...values.lines, { description: `${p.name} — Package`, quantity: 1, rate: p.package_cost, gst_rate: zeroGst }])
    } else if (kind === 'deliverables') {
      const extra = p.deliverables.filter((d) => d.is_additional_charge && d.additional_charge_amount > 0)
      if (extra.length === 0) return
      set('lines', [
        ...values.lines,
        ...extra.map((d) => ({ description: d.title, quantity: 1, rate: d.additional_charge_amount, gst_rate: zeroGst as GstSlab })),
      ])
    } else {
      const received = p.payments.reduce((s, pay) => s + pay.amount, 0)
      const balance = Math.max(0, p.total_cost - received)
      if (balance <= 0) return
      set('lines', [...values.lines, { description: `${p.name} — Balance due`, quantity: 1, rate: balance, gst_rate: 0 }])
    }
  }

  // Fills the first blank row rather than always appending, so picking a preset
  // right after opening the form (still just the one empty starter line) does
  // the obvious thing instead of leaving an empty row above the new one.
  function quickAdd(description: string) {
    const blank = values.lines.findIndex((l) => !l.description.trim())
    set(
      'lines',
      blank !== -1
        ? values.lines.map((l, i) => (i === blank ? { ...l, description } : l))
        : [...values.lines, { description, quantity: 1, rate: 0, gst_rate: values.no_gst ? 0 : 18 }],
    )
  }

  const overDiscount =
    values.discount_type === 'none'
      ? false
      : values.discount_type === 'percent'
        ? values.discount > 100
        : values.discount > totals.subtotal && totals.subtotal > 0

  // Lovable parity gates: GSTIN format, place-of-supply when tax applies,
  // and at least one taxed line on a GST invoice.
  const gstNumberTrimmed = values.gst_number.trim().toUpperCase()
  const gstNumberError = !values.no_gst && gstNumberTrimmed
    ? (GSTIN_REGEX.test(gstNumberTrimmed) ? null : 'GSTIN format looks invalid. Expected 15-char GSTIN like 27ABCDE1234F1Z5.')
    : null
  const hasTaxRate = values.lines.some((l) => Number(l.gst_rate) > 0)

  return (
    <>
      {!isEdit && company && (company.invoice_default_notes || company.invoice_default_terms || company.invoice_bank_details) && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Prefilled from Invoice Settings — edit freely, this invoice keeps its own copy.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>
            Client <span className="text-destructive">*</span>
          </Label>
          <ClientCombobox
            clients={clients}
            value={values.client_id}
            onChange={(id) => {
              set('client_id', id)
              set('project_id', '')
            }}
          />
          {selectedClient && (
            <p className={cn('text-xs', clientGstin && !clientGstinValid ? 'text-destructive' : 'text-muted-foreground')}>
              {clientGstin ? `GSTIN: ${clientGstin}` : 'No GSTIN on file for this client.'}{' '}
              {clientGstin && !clientGstinValid && '— 15-char format like 27ABCDE1234F1Z5.'}
              {!clientGstin && 'Format: 2-digit state + 10-char PAN + entity + Z + checksum (15 chars).'}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Project (optional)</Label>
          <Select value={values.project_id} onChange={(e) => set('project_id', e.target.value)} disabled={!values.client_id}>
            <option value="">Not linked to a project</option>
            {clientProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {values.project_id && linkedProject.data && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Import from project</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void importFromProject('package')}>
            Package
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void importFromProject('deliverables')}>
            Billable deliverables
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void importFromProject('balance')}>
            Balance due
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Invoice date</Label>
          <Input type="date" value={values.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Due date (optional)</Label>
          <Input
            type="date"
            value={values.due_date}
            onChange={(e) => set('due_date', e.target.value)}
            min={values.invoice_date || undefined}
          />
          {!isEdit && !values.due_date && (
            <button
              type="button"
              className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => values.invoice_date && set('due_date', addDaysISO(values.invoice_date, 7))}
            >
              Set due +7 days
            </button>
          )}
        </div>
      </div>

      {!isEdit && (
        <div className="flex flex-col gap-1.5">
          <Label>Invoice number (optional)</Label>
          <Input
            value={values.invoice_number}
            onChange={(e) => set('invoice_number', e.target.value)}
            placeholder="Leave blank to auto-number"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>
            Status
          </Label>
          <Select value={values.status} onChange={(e) => set('status', e.target.value as InvoiceFormValues['status'])}>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>GSTIN (per invoice, optional)</Label>
          <Input
            value={values.gst_number}
            onChange={(e) => set('gst_number', e.target.value.toUpperCase())}
            placeholder="27ABCDE1234F1Z5"
            disabled={values.no_gst}
            aria-invalid={!!gstNumberError}
          />
          {gstNumberError ? (
            <p className="text-xs text-destructive">{gstNumberError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">15-char format like 27ABCDE1234F1Z5.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>
            Place of supply {!values.no_gst && <span className="text-destructive">*</span>}
          </Label>
          <Select value={values.place_of_supply} onChange={(e) => set('place_of_supply', e.target.value)} disabled={values.no_gst}>
            {(states ?? []).map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
          {!values.no_gst && !values.place_of_supply.trim() && (
            <p className="text-xs text-destructive">Place of Supply is required for GST invoices.</p>
          )}
          {!values.no_gst && !hasTaxRate && (
            <p className="text-xs text-destructive">At least one item must have a tax rate for GST invoices.</p>
          )}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
          {!values.no_gst && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={values.intra_state} onChange={(e) => set('intra_state', e.target.checked)} />
              Same state as studio (CGST + SGST)
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={values.no_gst} onChange={(e) => setNoGst(e.target.checked)} />
            No GST
          </label>
        </div>
      </div>
      {values.no_gst && (
        <p className="text-xs text-muted-foreground">No-GST invoice — all lines are 0% and the GST breakdown hides on the print.</p>
      )}

      {templates && templates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label>Print layout</Label>
          <Select value={values.template_id} onChange={(e) => set('template_id', e.target.value)}>
            <option value="">
              {templates.some((t) => t.is_default) ? "Company default" : 'Plain layout'}
            </option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_default ? ' (default)' : ''}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Bank details and terms & conditions come from the layout — set them once in{' '}
            <Link to="/billing/templates" className="underline underline-offset-2 hover:text-foreground">
              Invoice Templates
            </Link>{' '}
            instead of retyping them on every invoice. Per-invoice text below overrides the layout for this invoice only.
          </p>
        </div>
      )}

      <div className="rounded-md border border-border">
        {values.lines.map((l, i) => (
          <div key={i} className="flex flex-col gap-2 border-b border-border p-2 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Description"
                value={l.description}
                onChange={(e) => patchLine(i, { description: e.target.value })}
                className="min-w-40 flex-1"
              />
              <Input inputMode="decimal" value={l.quantity} onChange={(e) => patchLine(i, { quantity: Number(e.target.value) || 0 })} className="w-16" />
              <Input inputMode="decimal" value={l.rate} onChange={(e) => patchLine(i, { rate: Number(e.target.value) || 0 })} className="w-28" placeholder="Rate" />
              {!values.no_gst && (
                <Select value={l.gst_rate} onChange={(e) => patchLine(i, { gst_rate: Number(e.target.value) as GstSlab })} className="w-20">
                  {GST_SLABS.map((g) => (
                    <option key={g} value={g}>
                      {g}%
                    </option>
                  ))}
                </Select>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => set('lines', values.lines.filter((_, idx) => idx !== i))}
              >
                <Trash2 />
              </Button>
            </div>
            <Input
              placeholder="Details shown under the description (optional)"
              value={l.subtext ?? ''}
              onChange={(e) => patchLine(i, { subtext: e.target.value || undefined })}
              className="ml-0"
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 p-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set('lines', [...values.lines, { description: '', quantity: 1, rate: 0, gst_rate: values.no_gst ? 0 : 18 }])}
          >
            <Plus /> Add line
          </Button>
          <QuickAddLine onAdd={quickAdd} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Label>Discount</Label>
            <Input
              inputMode="decimal"
              value={values.discount_type === 'none' ? 0 : values.discount}
              onChange={(e) => set('discount', Number(e.target.value) || 0)}
              className="w-28"
              disabled={values.discount_type === 'none'}
            />
            <Select
              value={values.discount_type}
              onChange={(e) => {
                const next = e.target.value as InvoiceFormValues['discount_type']
                set('discount_type', next)
                if (next === 'none') set('discount', 0)
              }}
              className="w-24"
            >
              <option value="none">None</option>
              <option value="flat">₹</option>
              <option value="percent">%</option>
            </Select>
          </div>
          {overDiscount && (
            <p className="text-xs text-destructive">
              {values.discount_type === 'percent' ? 'Percent cannot exceed 100%.' : 'Discount cannot exceed the subtotal.'}
            </p>
          )}
        </div>
        <div className="text-right text-sm">
          <p className="text-muted-foreground">
            Subtotal {formatINR(totals.subtotal)}{!values.no_gst && <> · Tax {formatINR(totals.tax)}</>}
          </p>
          <p className="text-lg font-semibold">{formatINR(totals.total)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Notes (optional)</Label>
          <NoteTemplatePicker notes={values.notes} onFill={(content) => set('notes', content)} />
        </div>
        <textarea
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={2}
          placeholder="Shown on the invoice, below the line items."
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>Bank details (optional)</Label>
            <BankAccountPicker onFill={(s) => set('bank_details', s)} />
          </div>
          <textarea
            value={values.bank_details}
            onChange={(e) => set('bank_details', e.target.value)}
            rows={3}
            placeholder="Blank = layout default. Saved per invoice."
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>Terms (optional)</Label>
            <TermsTemplatePicker terms={values.terms} onFill={(content) => set('terms', content)} />
          </div>
          <textarea
            value={values.terms}
            onChange={(e) => set('terms', e.target.value)}
            rows={3}
            placeholder="Blank = layout default. Saved per invoice."
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
          />
        </div>
      </div>
    </>
  )
}
