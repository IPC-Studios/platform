import { useAuth } from '@/shared/auth/AuthProvider'
import { RequireAuth } from '@/shared/auth/guards'

export function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardInner />
    </RequireAuth>
  )
}

function DashboardInner() {
  const { session, signOut } = useAuth()
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Dashboard</h1>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <p>Signed in as {session?.display_name}.</p>
      <p style={{ color: '#666' }}>
        Plan: {session?.plan_gate} · Role: {session?.role}
      </p>
      {/* Phase 3 replaces this with the AppShell + role-filtered nav. */}
    </main>
  )
}
