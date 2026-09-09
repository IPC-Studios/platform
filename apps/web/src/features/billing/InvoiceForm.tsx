import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import type { CreateInvoiceRequest, GstState, InvoiceLineInput } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useActiveLookups, useCreateCustomLookup } from '@/features/settings/api'
import { useClients } from '@/features/clients/api'
import { useProjects, useProject } from '@/features/projects/api'
import { useConfirm } from '@/shared/ui/confirm'
import { useInvoiceTemplates } from './api'

export const GST_SLABS: GstSlab[] = [0, 5, 12, 18, 28]

export const todayISO = () => new Date().toISOString().slice(0, 10)

export interface InvoiceFormValues {
  client_id: string
  project_id: string
  place_of_supply: string
  intra_state: boolean
  invoice_date: string
  due_date: string
  discount: number
  discount_type: 'flat' | 'percent'
  notes: string
  template_id: string
  lines: InvoiceLineInput[]
}

export function emptyInvoiceForm(): InvoiceFormValues {
  return {
    client_id: '',
    project_id: '',
    place_of_supply: '27',
    intra_state: true,
    invoice_date: todayISO(),
    due_date: '',
    discount: 0,
    discount_type: 'flat',
    notes: '',
    template_id: '',
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
        { intraState: values.intra_state, discount: values.discount, discountType: values.discount_type },
      ),
    [values.lines, values.intra_state, values.discount, values.discount_type],
  )

  function toRequest(): CreateInvoiceRequest {
    return {
      client_id: values.client_id || null,
      project_id: values.project_id || null,
      place_of_supply: values.place_of_supply,
      intra_state: values.intra_state,
      invoice_date: values.invoice_date || undefined,
      due_date: values.due_date || undefined,
      discount: values.discount,
      discount_type: values.discount_type,
      notes: values.notes.trim() || undefined,
      template_id: values.template_id || null,
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

/** Every field the create form sets, shared verbatim by the edit dialog. */
export function InvoiceFormFields({
  form,
  states,
}: {
  form: ReturnType<typeof useInvoiceForm>
  states: GstState[] | undefined
}) {
  const { values, set, patchLine, totals } = form
  const { data: clients } = useClients()
  const { data: projects } = useProjects()
  const { data: templateData } = useInvoiceTemplates()
  const templates = templateData?.items
  const clientProjects = (projects ?? []).filter((p) => !values.client_id || p.client_id === values.client_id)
  const linkedProject = useProject(values.project_id)
  const confirm = useConfirm()

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
    if (kind === 'package') {
      if (p.package_cost <= 0) return
      set('lines', [...values.lines, { description: `${p.name} — Package`, quantity: 1, rate: p.package_cost, gst_rate: 18 }])
    } else if (kind === 'deliverables') {
      const extra = p.deliverables.filter((d) => d.is_additional_charge && d.additional_charge_amount > 0)
      if (extra.length === 0) return
      set('lines', [
        ...values.lines,
        ...extra.map((d) => ({ description: d.title, quantity: 1, rate: d.additional_charge_amount, gst_rate: 18 as GstSlab })),
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
        : [...values.lines, { description, quantity: 1, rate: 0, gst_rate: 18 }],
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>
            Client <span className="text-destructive">*</span>
          </Label>
          <Select
            value={values.client_id}
            onChange={(e) => {
              set('client_id', e.target.value)
              set('project_id', '')
            }}
            aria-invalid={!values.client_id}
          >
            <option value="">Select a client…</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
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
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Place of supply</Label>
          <Select value={values.place_of_supply} onChange={(e) => set('place_of_supply', e.target.value)}>
            {(states ?? []).map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={values.intra_state} onChange={(e) => set('intra_state', e.target.checked)} />
          Same state as studio (CGST + SGST)
        </label>
      </div>

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
        </div>
      )}

      <div className="rounded-md border border-border">
        {values.lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 border-b border-border p-2 last:border-0">
            <Input
              placeholder="Description"
              value={l.description}
              onChange={(e) => patchLine(i, { description: e.target.value })}
              className="min-w-40 flex-1"
            />
            <Input type="number" min={0} value={l.quantity} onChange={(e) => patchLine(i, { quantity: Number(e.target.value) })} className="w-16" />
            <Input type="number" min={0} value={l.rate} onChange={(e) => patchLine(i, { rate: Number(e.target.value) })} className="w-28" placeholder="Rate" />
            <Select value={l.gst_rate} onChange={(e) => patchLine(i, { gst_rate: Number(e.target.value) as GstSlab })} className="w-20">
              {GST_SLABS.map((g) => (
                <option key={g} value={g}>
                  {g}%
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => set('lines', values.lines.filter((_, idx) => idx !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 p-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set('lines', [...values.lines, { description: '', quantity: 1, rate: 0, gst_rate: 18 }])}
          >
            <Plus /> Add line
          </Button>
          <QuickAddLine onAdd={quickAdd} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label>Discount</Label>
          <Input
            type="number"
            min={0}
            max={values.discount_type === 'percent' ? 100 : undefined}
            value={values.discount}
            onChange={(e) => set('discount', Number(e.target.value))}
            className="w-28"
          />
          <Select
            value={values.discount_type}
            onChange={(e) => set('discount_type', e.target.value as InvoiceFormValues['discount_type'])}
            className="w-20"
          >
            <option value="flat">₹</option>
            <option value="percent">%</option>
          </Select>
        </div>
        <div className="text-right text-sm">
          <p className="text-muted-foreground">
            Subtotal {formatINR(totals.subtotal)} · Tax {formatINR(totals.tax)}
          </p>
          <p className="text-lg font-semibold">{formatINR(totals.total)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Notes (optional)</Label>
        <textarea
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={2}
          placeholder="Shown on the invoice, below the line items."
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
        />
      </div>
    </>
  )
}
