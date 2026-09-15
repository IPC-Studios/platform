import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useMembers, useSlots } from '@/features/allocation/api'

/**
 * One member's bookings (Lovable parity with
 * _app.team-allocation.member.$firebase_uid): every slot on the books,
 * newest first, with cost state.
 */
export function AllocationMemberPage() {
  return (
    <AuthedPage module="projects">
      <MemberSlots />
    </AuthedPage>
  )
}

function MemberSlots() {
  const { uid } = useParams({ from: '/authed/team-allocation/member/$uid' })
  const navigate = useNavigate()
  const slots = useSlots()
  const members = useMembers()

  const member = (members.data ?? []).find((m) => m.user_id === uid)
  const mine = (slots.data ?? [])
    .filter((s) => s.user_id === uid)
    .sort((a, b) => b.start_at.localeCompare(a.start_at))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/team-allocation' })}>
          <ArrowLeft className="mr-1 size-4" /> Team Booking
        </Button>
        <h2 className="text-lg font-semibold">{member?.name ?? 'Team member'}</h2>
        <StatusBadge>{mine.length} slot{mine.length === 1 ? '' : 's'}</StatusBadge>
      </div>

      {slots.isLoading ? (
        <SkeletonList rows={5} columns={4} />
      ) : mine.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title="No bookings" description="This member has no slots on the books." />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {mine.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="font-medium">{s.service_name ?? 'Crew'}</span>
                <span className="text-muted-foreground">
                  {new Date(s.start_at).toLocaleString()} – {new Date(s.end_at).toLocaleString()}
                </span>
                {(s.estimated_cost ?? s.final_cost) != null && (
                  <span className="text-muted-foreground">
                    {formatINR(s.final_cost ?? s.estimated_cost ?? 0)}
                  </span>
                )}
                <StatusBadge
                  className="ml-auto"
                  tone={s.status === 'booked' ? 'info' : s.status === 'released' ? 'neutral' : 'danger'}
                >
                  {s.status}
                </StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
