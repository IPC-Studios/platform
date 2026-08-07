import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money, gstRate } from './shared/primitives'

export const invoiceStatus = z.enum(['draft', 'sent', 'partial', 'paid', 'cancelled'])
export type InvoiceStatus = z.infer<typeof invoiceStatus>

export const invoiceListItem = z.object({
  id: uuid,
  invoice_number: z.string(),
  client_name: z.string().nullable(),
  invoice_date: isoDate,
  total: money,
  balance_due: money,
  status: invoiceStatus,
})
export type InvoiceListItem = z.infer<typeof invoiceListItem>

export const invoiceLineInput = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().positive(),
  rate: money,
  gst_rate: gstRate,
})
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>

export const createInvoiceRequest = z.object({
  client_id: uuid.nullable().default(null),
  project_id: uuid.nullable().default(null),
  place_of_supply: z.string(),
  /** True when the studio and place of supply are the same state (CGST+SGST). */
  intra_state: z.boolean().default(true),
  invoice_date: isoDate.optional(),
  due_date: isoDate.optional(),
  discount: money.default(0),
  notes: z.string().max(1000).optional(),
  lines: z.array(invoiceLineInput).min(1),
})
export type CreateInvoiceRequest = z.infer<typeof createInvoiceRequest>

export const recordPaymentRequest = z.object({
  amount: money.refine((v) => v > 0, 'amount must be positive'),
  paid_on: isoDate.optional(),
  mode: z.string().max(40).optional(),
  reference: z.string().max(120).optional(),
})
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequest>

export const gstState = z.object({ code: z.string(), name: z.string() })
export type GstState = z.infer<typeof gstState>

export const invoiceDetail = z.object({
  id: uuid,
  invoice_number: z.string(),
  invoice_date: isoDate,
  status: invoiceStatus,
  place_of_supply: z.string().nullable(),
  subtotal: money,
  discount: money,
  taxable: money,
  tax: money,
  total: money,
  amount_paid: money,
  balance_due: money,
  created_at: isoDateTime,
  items: z.array(
    z.object({
      id: uuid,
      description: z.string(),
      quantity: z.number(),
      rate: money,
      amount: money,
      gst_rate: z.number(),
      cgst: money,
      sgst: money,
      igst: money,
    }),
  ),
  payments: z.array(
    z.object({ id: uuid, amount: money, paid_on: isoDate, mode: z.string().nullable() }),
  ),
})
export type InvoiceDetail = z.infer<typeof invoiceDetail>
