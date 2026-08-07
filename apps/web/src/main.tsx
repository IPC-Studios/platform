import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { AuthProvider } from '@/shared/auth/AuthProvider'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'
import { ConfirmProvider } from '@/shared/ui/confirm'
import { router } from '@/app/router'

const queryClient = new QueryClient()

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

createRoot(el).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
