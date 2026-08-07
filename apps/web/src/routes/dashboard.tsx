import { useAuth } from '@/shared/auth/AuthProvider'

export function DashboardPage() {
  const { session, loading } = useAuth()
  if (loading) return <p style={{ fontFamily: 'system-ui', padding: 24 }}>Loading…</p>
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Dashboard</h1>
      <p>{session ? `Signed in as ${session.display_name}` : 'Not signed in.'}</p>
      {/* Phase 3 replaces this with the AppShell + role-filtered nav. */}
    </main>
  )
}
