import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Toaster, toast } from 'sonner'
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2 } from 'lucide-react'
import { AuthProvider } from '@/shared/auth/AuthProvider'
import { MOCK_ENABLED } from '@/shared/dev/mock'
import { installClientErrorReporting } from '@/shared/error/report'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'
import { ConfirmProvider } from '@/shared/ui/confirm'
import { router } from '@/app/router'

const queryClient = new QueryClient({
  // Every failed mutation toasts its (UI-copy) error message — one place, all forms.
  mutationCache: new MutationCache({
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Something went wrong.'),
  }),
  defaultOptions: {
    // Surface errors immediately in dev instead of masking them as long loads.
    queries: { retry: import.meta.env.DEV ? false : 2, refetchOnWindowFocus: false },
  },
})

// The mock preview has no backend to receive reports.
if (!MOCK_ENABLED) installClientErrorReporting()

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

createRoot(el).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
            <Toaster
              position="top-right"
              closeButton
              icons={{
                success: <CheckCircle2 className="size-5 text-success" />,
                error: <XCircle className="size-5 text-destructive" />,
                warning: <AlertTriangle className="size-5 text-warning" />,
                info: <Info className="size-5 text-primary" />,
                loading: <Loader2 className="size-5 animate-spin text-muted-foreground" />,
              }}
              toastOptions={{
                unstyled: false,
                // Every side of the border is set with its own directional utility
                // (never the `border`/`border-color` shorthand) so the left-side
                // accent color below can never lose a same-property cascade tie to it.
                classNames: {
                  toast:
                    'rounded-xl border-t border-r border-b border-l-4 border-t-border border-r-border border-b-border bg-card text-foreground shadow-lg p-4 gap-3 items-start',
                  title: 'font-semibold text-sm leading-snug',
                  description: 'text-sm text-muted-foreground mt-0.5',
                  icon: 'mt-0.5',
                  closeButton: 'border-border bg-card text-muted-foreground hover:text-foreground',
                  actionButton: 'bg-primary text-primary-foreground',
                  cancelButton: 'bg-secondary text-secondary-foreground',
                  success: 'border-l-success',
                  error: 'border-l-destructive',
                  warning: 'border-l-warning',
                  info: 'border-l-primary',
                },
              }}
            />
          </ConfirmProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
