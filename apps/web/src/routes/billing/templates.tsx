import { useState } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { callApi } from '@/shared/api/client'
import { invoiceTemplateList, createInvoiceTemplateRequest, type CreateInvoiceTemplateRequest } from '@ipc/contracts'
import { toast } from 'sonner'
import { Plus, Trash2, FileText, Star } from 'lucide-react'

function useTemplates() {
  return useQuery({
    queryKey: ['billing', 'templates'],
    queryFn: () => callApi('/billing/templates', { responseSchema: invoiceTemplateList }),
  })
}

export function InvoiceTemplatesPage() {
  return (
    <AuthedPage module="billing">
      <TemplatesContent />
    </AuthedPage>
  )
}

function TemplatesContent() {
  const qc = useQueryClient()
  const { data, isLoading } = useTemplates()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<CreateInvoiceTemplateRequest>({ name: '', layout_json: {}, is_default: false })

  const create = useMutation({
    mutationFn: (body: CreateInvoiceTemplateRequest) =>
      callApi('/billing/templates', { method: 'POST', body, responseSchema: invoiceTemplateList.shape.items.element }),
    onSuccess: () => { toast.success('Template created'); void qc.invalidateQueries({ queryKey: ['billing', 'templates'] }); setDialogOpen(false) },
    onError: (e: Error) => toast.error(e.message),
  })

  const del = useMutation({
    mutationFn: (id: string) => callApi(`/billing/templates/${id}`, { method: 'DELETE', responseSchema: { parse: (x: unknown) => x } as never }),
    onSuccess: () => { toast.success('Template deleted'); void qc.invalidateQueries({ queryKey: ['billing', 'templates'] }) },
  })

  const items = data?.items ?? []

  return (
    <div className="space-y-6">
      <PageHeader title="Invoice Templates" description="Manage reusable invoice layouts" actions={<Button size="sm" onClick={() => { setForm({ name: '', layout_json: {}, is_default: false }); setDialogOpen(true) }}><Plus className="mr-1 h-4 w-4" /> New Template</Button>} />
      {isLoading ? <div className="py-12 text-center text-muted-foreground">Loading…</div> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <Card key={t.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />{t.name}</CardTitle>
                <div className="flex items-center gap-1">
                  {t.is_default && <Badge variant="success"><Star className="h-3 w-3" />Default</Badge>}
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => del.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardHeader>
              <CardContent><p className="text-xs text-muted-foreground">Header: {t.layout_json.show_header ? 'Yes' : 'No'} · GST: {t.layout_json.show_gst ? 'Yes' : 'No'}</p></CardContent>
            </Card>
          ))}
          {items.length === 0 && <div className="col-span-full py-12 text-center text-muted-foreground">No templates yet.</div>}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title="New Template">
          <div className="space-y-4">
            <div><label className="text-sm font-medium">Name</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Standard GST Invoice" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} /> Set as default</label>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => { const parsed = createInvoiceTemplateRequest.safeParse(form); if (!parsed.success) toast.error(parsed.error.issues[0].message); else create.mutate(parsed.data) }} disabled={!form.name.trim() || create.isPending}>{create.isPending ? 'Saving…' : 'Create'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
