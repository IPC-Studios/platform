import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const termsDocument = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  has_active_link: z.boolean(),
  link_expires_at: z.string().nullable(),
  created_at: z.string(),
})
export type TermsDocument = z.infer<typeof termsDocument>
const list = termsDocument.array()

const issued = z.object({ document_id: z.string().uuid(), token: z.string() })

/** Every project's paperwork, newest document first per project. */
export function useTermsDocuments() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['terms', 'documents'],
    queryFn: () => callApi('/terms/documents', { responseSchema: list }),
    enabled: !!session && access.hasModule('projects'),
    staleTime: 15_000,
  })
}

/** Issuing again replaces the active link for that project — the old one still shows in history. */
export function useIssueTerms() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { project_id: string | null; rendered_body: string }) =>
      callApi('/terms/issue', { method: 'POST', body: input, responseSchema: issued }),
    onSuccess: () => {
      toast.success('Terms link issued')
      void qc.invalidateQueries({ queryKey: ['terms', 'documents'] })
    },
  })
}
