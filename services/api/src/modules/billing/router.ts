import { Hono } from 'hono'
import {
  createInvoiceRequest,
  gstState,
  invoiceDetail,
  invoiceListItem,
  recordPaymentRequest,
} from '@ipc/contracts'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { requestClient } from '../../lib/supabase'

const list = invoiceListItem.array()

export const billingRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('billing')) // finance gate: owner or a finance profile

  .get('/states', async (c) => {
    const { data, error } = await requestClient(c).from('state_master').select('code,name').order('name')
    if (error) fail(400, 'We could not load states.')
    return c.json(gstState.array().parse(data ?? []))
  })

  .get('/invoices', async (c) => {
    const { data, error } = await requestClient(c)
      .from('invoices')
      .select('id,invoice_number,invoice_date,total,balance_due,status,clients(name)')
      .order('invoice_date', { ascending: false })
    if (error) fail(400, 'We could not load invoices.')
    const rows = (data ?? []).map((r) => {
      const { clients, ...rest } = r as typeof r & { clients: { name: string } | null }
      return { ...rest, client_name: clients?.name ?? null }
    })
    return c.json(list.parse(rows))
  })

  .post('/invoices', async (c) => {
    const parsed = createInvoiceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invoice details.')
    const req = parsed.data

    // The one source of GST truth — same tested engine everywhere.
    const totals = computeInvoice(
      req.lines.map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
      { intraState: req.intra_state, discount: req.discount },
    )
    const items = totals.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
      gst_rate: l.gst_rate,
      taxable: l.taxable,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
    }))

    const { data, error } = await requestClient(c)
      .rpc('create_invoice', {
        p_client_id: req.client_id,
        p_project_id: req.project_id,
        p_place_of_supply: req.place_of_supply,
        p_invoice_date: req.invoice_date ?? null,
        p_due_date: req.due_date ?? null,
        p_subtotal: totals.subtotal,
        p_discount: totals.discount,
        p_taxable: totals.taxable,
        p_tax: totals.tax,
        p_total: totals.total,
        p_items: items,
        p_notes: req.notes ?? null,
      })
      .single()
    if (error || !data) fail(400, 'We could not create the invoice.')
    const row = data as { id: string; invoice_number: string }
    return c.json({ id: row.id, invoice_number: row.invoice_number }, 201)
  })

  .get('/invoices/:id', async (c) => {
    const { data, error } = await requestClient(c)
      .from('invoices')
      .select(
        'id,invoice_number,invoice_date,status,place_of_supply,subtotal,discount,taxable,tax,total,amount_paid,balance_due,created_at,' +
          'clients(name),' +
          'invoice_items(id,description,quantity,rate,amount,gst_rate,cgst,sgst,igst),' +
          'invoice_payments(id,amount,paid_on,mode)',
      )
      .eq('id', c.req.param('id'))
      .single()
    if (error || !data) fail(404, 'That invoice was not found.')
    const row = data as unknown as Record<string, unknown> & {
      clients: { name: string } | null
      invoice_items: unknown
      invoice_payments: unknown
    }
    return c.json(
      invoiceDetail.parse({
        ...row,
        client_name: row.clients?.name ?? null,
        items: row.invoice_items,
        payments: row.invoice_payments,
      }),
    )
  })

  .post('/invoices/:id/payments', async (c) => {
    const parsed = recordPaymentRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const { error } = await requestClient(c).rpc('record_invoice_payment', {
      p_invoice_id: c.req.param('id'),
      p_amount: parsed.data.amount,
      p_paid_on: parsed.data.paid_on ?? null,
      p_mode: parsed.data.mode ?? null,
      p_reference: parsed.data.reference ?? null,
    })
    if (error) fail(400, 'We could not record the payment.')
    return c.body(null, 204)
  })
