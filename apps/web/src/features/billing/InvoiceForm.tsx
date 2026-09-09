import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import type { CreateInvoiceRequest, GstState, InvoiceLineInput } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { useClients } from '@/features/clients/api'
import { useProjects } from '@/features/projects/api'

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
  notes: string
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
    notes: '',
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
        { intraState: values.intra_state, discount: values.discount },
      ),
    [values.lines, values.intra_state, values.discount],
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
      notes: values.notes.trim() || undefined,
      lines: values.lines.filter((l) => l.description.trim()),
    }
  }

  function reset() {
    setValues(emptyInvoiceForm())
  }

  return { values, set, patchLine, totals, toRequest, reset }
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
  const clientProjects = (projects ?? []).filter((p) => !values.client_id || p.client_id === values.client_id)

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
        <div className="p-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set('lines', [...values.lines, { description: '', quantity: 1, rate: 0, gst_rate: 18 }])}
          >
            <Plus /> Add line
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label>Discount ₹</Label>
          <Input type="number" min={0} value={values.discount} onChange={(e) => set('discount', Number(e.target.value))} className="w-32" />
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
