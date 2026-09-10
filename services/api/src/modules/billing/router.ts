import { Hono } from 'hono'
import {
  createInvoiceRequest,
  updateInvoiceRequest,
  gstState,
  invoiceDetail,
  invoiceListItem,
  recordPaymentRequest,
  createInvoiceTemplateRequest,
  invoiceTemplateList,
  createInvoiceNoteTemplateRequest,
  invoiceNoteTemplateList,
} from '@ipc/contracts'
import { computeInvoice, type GstSlab } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = invoiceListItem.array()

export const billingRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('billing')) // finance gate: owner or a finance profile

  .get('/states', async (c) => {
    const rows = await attempt(c, 'billing.states', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select code, name from state_master order by name`),
    )
    if (!rows) fail(400, 'We could not load states.')
    return c.json(gstState.array().parse(rows))
  })

  .get('/invoices', async (c) => {
    const rows = await attempt(c, 'billing.invoices', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select i.id, i.invoice_number, i.invoice_date, i.total, i.balance_due, i.status,
                 cl.name as client_name
          from invoices i
          left join clients cl on cl.id = i.client_id
          order by i.invoice_date desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load invoices.')
    return c.json(list.parse(rows))
  })

  .post('/invoices', requireAction('billing', 'create'), async (c) => {
    const parsed = createInvoiceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invoice details.')
    const req = parsed.data

    // The one source of GST truth — same tested engine everywhere.
    const totals = computeInvoice(
      req.lines.map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
      { intraState: req.intra_state, discount: req.discount, discountType: req.discount_type },
    )
    const items = totals.lines.map((l) => ({
      subtext: l.subtext ?? null,
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

    const row = await attempt(
      c,
      'billing.invoice_create',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
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
            p_notes => ${req.notes ?? null},
            p_template_id => ${req.template_id ?? null},
            p_invoice_number => ${req.invoice_number ?? null}
          )`
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (row === 'taken') fail(409, 'An invoice with this number already exists.')
    if (!row) fail(400, 'We could not create the invoice.')
    await audit(c, {
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: row.id,
      after: { invoice_number: row.invoice_number, total: totals.total, client_id: req.client_id },
    })
    return c.json({ id: row.id, invoice_number: row.invoice_number }, 201)
  })

  .get('/invoices/:id', async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'billing.invoice', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          select i.id, i.invoice_number, i.invoice_date, i.due_date, i.status, i.place_of_supply,
                 i.intra_state, i.client_id, i.project_id, i.template_id,
                 i.subtotal, i.discount, i.taxable, i.tax, i.total, i.amount_paid, i.balance_due, i.notes, i.created_at,
                 cl.name as client_name, cl.gstin as client_gstin, cl.address as client_address,
                 coalesce(
                   (select it.layout_json from invoice_templates it where it.id = i.template_id),
                   (select it.layout_json from invoice_templates it where it.company_id = i.company_id and it.is_default = true limit 1)
                 ) as template_layout,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', it.id, 'description', it.description, 'subtext', it.subtext, 'quantity', it.quantity,
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
          where i.id = ${id}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That invoice was not found.')
    return c.json(invoiceDetail.parse(row))
  })

  // Full resend, same as creation: once a payment is recorded the totals are
  // a ledger fact, not a draft, so update_invoice() itself refuses those.
  .patch('/invoices/:id', requireAction('billing', 'edit'), async (c) => {
    const parsed = updateInvoiceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invoice details.')
    const req = parsed.data
    const id = uuidParam(c)

    const totals = computeInvoice(
      req.lines.map((l) => ({ ...l, gst_rate: l.gst_rate as GstSlab })),
      { intraState: req.intra_state, discount: req.discount, discountType: req.discount_type },
    )
    const items = totals.lines.map((l) => ({
      subtext: l.subtext ?? null,
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

    const ok = await attempt(
      c,
      'billing.invoice_update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select update_invoice(
            p_invoice_id => ${id},
            p_client_id => ${req.client_id},
            p_project_id => ${req.project_id},
            p_place_of_supply => ${req.place_of_supply},
            p_intra_state => ${req.intra_state},
            p_invoice_date => ${req.invoice_date ?? null},
            p_due_date => ${req.due_date ?? null},
            p_subtotal => ${totals.subtotal},
            p_discount => ${totals.discount},
            p_taxable => ${totals.taxable},
            p_tax => ${totals.tax},
            p_total => ${totals.total},
            p_items => ${sql.json(items)},
            p_notes => ${req.notes ?? null},
            p_template_id => ${req.template_id ?? null}
          )`
          return true
        }),
      { onCode: (code) => (code === '23514' ? 'has_payment' : undefined) },
    )
    if (ok === 'has_payment') fail(409, 'A payment has already been recorded against this invoice — it can no longer be edited.')
    if (!ok) fail(400, 'We could not update this invoice.')
    await audit(c, { action: 'invoice.update', entityType: 'invoice', entityId: id, after: { total: totals.total, client_id: req.client_id } })
    return c.json({ ok: true })
  })

  .delete('/invoices/:id', requireAction('billing', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(
      c,
      'billing.invoice_delete',
      () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
          delete from invoices where id = ${id} and amount_paid = 0 returning id`),
    )
    if (!rows) fail(400, 'We could not delete this invoice.')
    if (!rows.length) fail(404, 'That invoice was not found, or already has a payment recorded.')
    await audit(c, { action: 'invoice.delete', entityType: 'invoice', entityId: id })
    return c.body(null, 204)
  })

  .post('/invoices/:id/payments', requireAction('billing', 'edit'), async (c) => {
    const parsed = recordPaymentRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const d = parsed.data
    const id = uuidParam(c)
    const ok = await attempt(c, 'billing.payment', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select record_invoice_payment(
          p_invoice_id => ${id},
          p_amount => ${d.amount},
          p_paid_on => ${d.paid_on ?? null},
          p_mode => ${d.mode ?? null},
          p_reference => ${d.reference ?? null})`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not record the payment.')
    await audit(c, { action: 'invoice.payment', entityType: 'invoice', entityId: id, after: d })
    return c.body(null, 204)
  })

  // ── Invoice Templates ──────────────────────────────────────
  .get('/templates', async (c) => {
    const rows = await attempt(c, 'billing.templates_list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, company_id, name, layout_json, is_default, created_at
          from invoice_templates
         where company_id = ${c.get('auth').companyId}
         order by is_default desc, created_at desc`),
    )
    if (!rows) fail(400, 'We could not load templates.')
    const parsedList = invoiceTemplateList.safeParse({ items: rows })
    if (!parsedList.success) {
      fail(422, JSON.stringify({ issues: parsedList.error.issues, sample: rows[0] }))
    }
    return c.json(parsedList.data)
  })

  .post('/templates', requireAction('billing', 'edit'), async (c) => {
    const parsed = createInvoiceTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.template_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // If setting as default, unset other defaults
        if (d.is_default) {
          await sql`update invoice_templates set is_default = false where company_id = ${auth.companyId} and is_default = true`
        }
        const made = await sql<{ id: string }[]>`
          insert into invoice_templates (company_id, name, layout_json, is_default)
          values (${auth.companyId}, ${d.name}, ${JSON.stringify(d.layout_json)}::jsonb, ${d.is_default})
          returning id`
        return made
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not create this template.')
    await audit(c, { action: 'invoice_template.create', entityType: 'invoice_template', entityId: rows[0].id, after: { name: d.name } })
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/templates/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createInvoiceTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.template_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_templates set is_default = false where company_id = ${auth.companyId} and is_default = true and id != ${id}`
        }
        return sql<{ id: string }[]>`
          update invoice_templates
             set name = ${d.name}, layout_json = ${JSON.stringify(d.layout_json)}::jsonb, is_default = ${d.is_default}
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this template.')
    if (!rows.length) fail(404, 'We could not find that template.')
    await audit(c, { action: 'invoice_template.update', entityType: 'invoice_template', entityId: id, after: d })
    return c.json({ ok: true })
  })

  .delete('/templates/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'billing.template_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from invoice_templates where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this template.')
    if (!rows.length) fail(404, 'We could not find that template.')
    await audit(c, { action: 'invoice_template.delete', entityType: 'invoice_template', entityId: id })
    return c.json({ ok: true })
  })

  // ── Notes snippet library (billing module) ──────────────────
  // Independent of the print-layout templates above -- a reusable Notes
  // string, not a layout.
  .get('/note-templates', async (c) => {
    const rows = await attempt(c, 'billing.note_templates_list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, company_id, title, content, is_default, created_at
          from invoice_note_templates
         where company_id = ${c.get('auth').companyId} and is_active = true
         order by is_default desc, created_at desc`),
    )
    if (!rows) fail(400, 'We could not load note templates.')
    return c.json(invoiceNoteTemplateList.parse({ items: rows }))
  })

  .post('/note-templates', requireAction('billing', 'edit'), async (c) => {
    const parsed = createInvoiceNoteTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the note template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.note_template_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_note_templates set is_default = false where company_id = ${auth.companyId} and is_default = true`
        }
        return sql<{ id: string }[]>`
          insert into invoice_note_templates (company_id, title, content, is_default)
          values (${auth.companyId}, ${d.title}, ${d.content}, ${d.is_default})
          returning id`
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not save this note template.')
    await audit(c, { action: 'invoice_note_template.create', entityType: 'invoice_note_template', entityId: rows[0].id, after: { title: d.title } })
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/note-templates/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createInvoiceNoteTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the note template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'billing.note_template_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (d.is_default) {
          await sql`update invoice_note_templates set is_default = false where company_id = ${auth.companyId} and is_default = true and id != ${id}`
        }
        return sql<{ id: string }[]>`
          update invoice_note_templates
             set title = ${d.title}, content = ${d.content}, is_default = ${d.is_default}
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this note template.')
    if (!rows.length) fail(404, 'We could not find that note template.')
    await audit(c, { action: 'invoice_note_template.update', entityType: 'invoice_note_template', entityId: id, after: d })
    return c.json({ ok: true })
  })

  .delete('/note-templates/:id', requireAction('billing', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'billing.note_template_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update invoice_note_templates set is_active = false
           where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this note template.')
    if (!rows.length) fail(404, 'We could not find that note template.')
    await audit(c, { action: 'invoice_note_template.delete', entityType: 'invoice_note_template', entityId: id })
    return c.json({ ok: true })
  })
