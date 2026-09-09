import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import {
  gstState,
  invoiceDetail,
  invoiceListItem,
  invoiceTemplateList,
  invoiceNoteTemplateList,
  type CreateInvoiceNoteTemplateRequest,
  type CreateInvoiceRequest,
  type RecordPaymentRequest,
  type UpdateInvoiceRequest,
} from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const invoices = invoiceListItem.array()
const states = gstState.array()
const anySchema = z.any()

export function useInvoices() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['invoices'],
    queryFn: () => callApi('/billing/invoices', { responseSchema: invoices }),
    enabled: !!session && access.hasModule('billing'),
    staleTime: 15_000,
  })
}

export function useStates() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['billing', 'states'],
    queryFn: () => callApi('/billing/states', { responseSchema: states }),
    enabled: !!session,
    staleTime: 300_000,
  })
}

export function useInvoiceTemplates() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['billing', 'templates'],
    queryFn: () => callApi('/billing/templates', { responseSchema: invoiceTemplateList }),
    enabled: !!session && access.hasModule('billing'),
    staleTime: 60_000,
  })
}

export function useInvoiceNoteTemplates() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['billing', 'note-templates'],
    queryFn: () => callApi('/billing/note-templates', { responseSchema: invoiceNoteTemplateList }),
    enabled: !!session && access.hasModule('billing'),
    staleTime: 60_000,
  })
}

export function useCreateInvoiceNoteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateInvoiceNoteTemplateRequest) =>
      callApi('/billing/note-templates', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
    onSuccess: () => {
      toast.success('Note template saved')
      void qc.invalidateQueries({ queryKey: ['billing', 'note-templates'] })
    },
  })
}

export function useInvoice(id: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['invoices', id],
    queryFn: () => callApi(`/billing/invoices/${id}`, { responseSchema: invoiceDetail }),
    enabled: !!session && !!id && access.hasModule('billing'),
  })
}

export function useCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateInvoiceRequest) =>
      callApi('/billing/invoices', {
        method: 'POST',
        body: input,
        responseSchema: z.object({ id: z.string(), invoice_number: z.string() }),
      }),
    onSuccess: () => {
      toast.success('Invoice created')
      void qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

export function useUpdateInvoice(invoiceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateInvoiceRequest) =>
      callApi(`/billing/invoices/${invoiceId}`, { method: 'PATCH', body: input, responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Invoice updated')
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['invoices', invoiceId] })
    },
  })
}

export function useDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/billing/invoices/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Invoice deleted')
      void qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

export function useRecordPayment(invoiceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RecordPaymentRequest) =>
      callApi(`/billing/invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: input,
        responseSchema: anySchema,
      }),
    onSuccess: () => {
      toast.success('Payment recorded')
      void qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}
