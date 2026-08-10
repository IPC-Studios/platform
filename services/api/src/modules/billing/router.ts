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
import { withUser } from '../../lib/db'

const list = invoiceListItem.array()

export const billingRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('billing')) // finance gate: owner or a finance profile

  .get('/states', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`select code, name from state_master order by name`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load states.')
    return c.json(gstState.array().parse(rows))
  })

  .get('/invoices', async (c) => {
    const rows = await withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql`
        select i.id, i.invoice_number, i.invoice_date, i.total, i.balance_due, i.status,
               cl.name as client_name
        from invoices i
        left join clients cl on cl.id = i.client_id
        order by i.invoice_date desc`,
    ).catch(() => null)
    if (!rows) fail(400, 'We could not load invoices.')
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

    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql<{ id: string; invoice_number: string }[]>`
        select * from create_invoice(
          p_client_id => ${req.client_id},
          p_project_id => ${req.project_id},
          p_place_of_supply => ${req.place_of_supply},
          p_invoice_date => ${req.invoice_date ?? null},
          p_due_date => ${req.due_date ?? null},
          p_subtotal => ${totals.subtotal},
          p_discount => ${totals.discount},
          p_taxable => ${totals.taxable},
          p_tax => ${totals.tax},
          p_total => ${totals.total},
          p_items => ${sql.json(items)},
          p_notes => ${req.notes ?? null}
        )`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(400, 'We could not create the invoice.')
    return c.json({ id: row.id, invoice_number: row.invoice_number }, 201)
  })

  .get('/invoices/:id', async (c) => {
    const row = await withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql`
        select i.id, i.invoice_number, i.invoice_date, i.status, i.place_of_supply,
               i.subtotal, i.discount, i.taxable, i.tax, i.total, i.amount_paid, i.balance_due, i.created_at,
               cl.name as client_name,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', it.id, 'description', it.description, 'quantity', it.quantity,
                   'rate', it.rate, 'amount', it.amount, 'gst_rate', it.gst_rate,
                   'cgst', it.cgst, 'sgst', it.sgst, 'igst', it.igst) order by it.id)
                 from invoice_items it where it.invoice_id = i.id
               ), '[]'::jsonb) as items,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'id', pmt.id, 'amount', pmt.amount, 'paid_on', pmt.paid_on, 'mode', pmt.mode)
                   order by pmt.paid_on)
                 from invoice_payments pmt where pmt.invoice_id = i.id
               ), '[]'::jsonb) as payments
        from invoices i
        left join clients cl on cl.id = i.client_id
        where i.id = ${c.req.param('id')!}`
      return rows[0]
    }).catch(() => null)
    if (!row) fail(404, 'That invoice was not found.')
    return c.json(invoiceDetail.parse(row))
  })

  .post('/invoices/:id/payments', async (c) => {
    const parsed = recordPaymentRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const d = parsed.data
    const ok = await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`select record_invoice_payment(
        p_invoice_id => ${c.req.param('id')!},
        p_amount => ${d.amount},
        p_paid_on => ${d.paid_on ?? null},
        p_mode => ${d.mode ?? null},
        p_reference => ${d.reference ?? null})`
      return true
    }).catch(() => false)
    if (!ok) fail(400, 'We could not record the payment.')
    return c.body(null, 204)
  })
