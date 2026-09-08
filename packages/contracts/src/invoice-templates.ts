import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

const layoutJsonDefaults = {
  show_header: true,
  show_footer: true,
  show_gst: true,
  show_bank_details: false,
  header_text: null as string | null,
  footer_text: null as string | null,
  bank_details: null as string | null,
  terms_and_conditions: null as string | null,
}

export const invoiceTemplate = z.object({
  id: uuid,
  company_id: uuid,
  name: z.string(),
  layout_json: z.object({
    show_header: z.boolean().default(true),
    show_footer: z.boolean().default(true),
    show_gst: z.boolean().default(true),
    show_bank_details: z.boolean().default(false),
    header_text: z.string().nullable().default(null),
    footer_text: z.string().nullable().default(null),
    bank_details: z.string().nullable().default(null),
    terms_and_conditions: z.string().nullable().default(null),
  }).default(layoutJsonDefaults),
  is_default: z.boolean().default(false),
  created_at: isoDateTime,
})
export type InvoiceTemplate = z.infer<typeof invoiceTemplate>

export const invoiceTemplateList = z.object({
  items: z.array(invoiceTemplate),
})
export type InvoiceTemplateList = z.infer<typeof invoiceTemplateList>

export const createInvoiceTemplateRequest = z.object({
  name: z.string().trim().min(2).max(160),
  layout_json: z.object({
    show_header: z.boolean().default(true),
    show_footer: z.boolean().default(true),
    show_gst: z.boolean().default(true),
    show_bank_details: z.boolean().default(false),
    header_text: z.string().trim().max(500).nullish(),
    footer_text: z.string().trim().max(500).nullish(),
    bank_details: z.string().trim().max(500).nullish(),
    terms_and_conditions: z.string().trim().max(1000).nullish(),
  }).default(layoutJsonDefaults),
  is_default: z.boolean().default(false),
})
export type CreateInvoiceTemplateRequest = z.infer<typeof createInvoiceTemplateRequest>
