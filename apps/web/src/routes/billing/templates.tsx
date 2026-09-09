import { useState } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { callApi } from '@/shared/api/client'
import {
  invoiceTemplateList,
  createInvoiceTemplateRequest,
  z,
  type CreateInvoiceTemplateRequest,
  type InvoiceTemplate,
} from '@ipc/contracts'
import { useInvoiceTemplates } from '@/features/billing/api'
import { toast } from 'sonner'
import { Plus, Trash2, Pencil, FileText, Star } from 'lucide-react'

const emptyForm = (): CreateInvoiceTemplateRequest => ({
  name: '',
  layout_json: {
    show_header: true,
    show_footer: true,
    show_gst: true,
    show_bank_details: false,
    header_text: null,
    footer_text: null,
    bank_details: null,
    terms_and_conditions: null,
  },
  is_default: false,
})

export function InvoiceTemplatesPage() {
  return (
    <AuthedPage module="billing">
      <TemplatesContent />
    </AuthedPage>
  )
}

function TemplatesContent() {
  const qc = useQueryClient()
  const { data, isLoading } = useInvoiceTemplates()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateInvoiceTemplateRequest>(emptyForm())

  const create = useMutation({
    mutationFn: (body: CreateInvoiceTemplateRequest) =>
      callApi('/billing/templates', { method: 'POST', body, responseSchema: invoiceTemplateList.shape.items.element }),
    onSuccess: () => {
      toast.success('Template created')
      void qc.invalidateQueries({ queryKey: ['billing', 'templates'] })
      setDialogOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateInvoiceTemplateRequest }) =>
      callApi(`/billing/templates/${id}`, { method: 'PATCH', body, responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Template updated')
      void qc.invalidateQueries({ queryKey: ['billing', 'templates'] })
      setDialogOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const del = useMutation({
    mutationFn: (id: string) => callApi(`/billing/templates/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Template deleted')
      void qc.invalidateQueries({ queryKey: ['billing', 'templates'] })
    },
  })

  const items = data?.items ?? []

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function openEdit(t: InvoiceTemplate) {
    setEditingId(t.id)
    setForm({ name: t.name, layout_json: t.layout_json, is_default: t.is_default })
    setDialogOpen(true)
  }

  function handleSubmit() {
    const parsed = createInvoiceTemplateRequest.safeParse(form)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please check the form.')
      return
    }
    if (editingId) update.mutate({ id: editingId, body: parsed.data })
    else create.mutate(parsed.data)
  }

  const busy = create.isPending || update.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoice Templates"
        description="Saved print layouts — pick one per invoice, or set a company default."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> New Template
          </Button>
        }
      />
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <Card key={t.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {t.name}
                </CardTitle>
                <div className="flex items-center gap-1">
                  {t.is_default && (
                    <Badge variant="success">
                      <Star className="h-3 w-3" />
                      Default
                    </Badge>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => {
                      if (confirm(`Delete "${t.name}"? Invoices already printed with it are unaffected.`)) del.mutate(t.id)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Header: {t.layout_json.show_header ? 'Yes' : 'No'} · GST: {t.layout_json.show_gst ? 'Yes' : 'No'} · Bank details:{' '}
                  {t.layout_json.show_bank_details ? 'Yes' : 'No'}
                </p>
              </CardContent>
            </Card>
          ))}
          {items.length === 0 && <div className="col-span-full py-12 text-center text-muted-foreground">No templates yet.</div>}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title={editingId ? 'Edit Template' : 'New Template'} className="max-h-[85vh] max-w-lg overflow-y-auto">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Standard GST Invoice" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
              Set as company default
            </label>

            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">What shows on the printed invoice</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.layout_json.show_header}
                  onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, show_header: e.target.checked } })}
                />
                Studio name, address and GSTIN in the header
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.layout_json.show_gst}
                  onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, show_gst: e.target.checked } })}
                />
                GST breakdown (rate, CGST/SGST/IGST columns)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.layout_json.show_footer}
                  onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, show_footer: e.target.checked } })}
                />
                Footer block (bank details, terms, footer note)
              </label>
            </div>

            <div>
              <label className="text-sm font-medium">Header note (optional)</label>
              <Input
                value={form.layout_json.header_text ?? ''}
                onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, header_text: e.target.value || null } })}
                placeholder="Shown under the studio name"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.layout_json.show_bank_details}
                onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, show_bank_details: e.target.checked } })}
              />
              Show bank details
            </label>
            {form.layout_json.show_bank_details && (
              <div>
                <label className="text-sm font-medium">Bank details</label>
                <textarea
                  value={form.layout_json.bank_details ?? ''}
                  onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, bank_details: e.target.value || null } })}
                  rows={2}
                  placeholder={'Account name, number, IFSC…'}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                />
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Terms &amp; conditions (optional)</label>
              <textarea
                value={form.layout_json.terms_and_conditions ?? ''}
                onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, terms_and_conditions: e.target.value || null } })}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Footer note (optional)</label>
              <Input
                value={form.layout_json.footer_text ?? ''}
                onChange={(e) => setForm({ ...form, layout_json: { ...form.layout_json, footer_text: e.target.value || null } })}
                placeholder="Shown centered at the very bottom"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!form.name.trim() || busy}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
