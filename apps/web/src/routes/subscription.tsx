import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Sparkles } from 'lucide-react'
import { plan, createOrderResponse, activateResponse } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { LoadingState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'

const plans = plan.array()

export function SubscriptionPage() {
  return (
    <AuthedPage module="settings_subscription" allowExpired>
      <Subscription />
    </AuthedPage>
  )
}

function Subscription() {
  const { session, refresh } = useAuth()
  const [msg, setMsg] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: () => callApi('/subscription/plans', { responseSchema: plans }),
    enabled: !!session,
  })

  const subscribe = useMutation({
    mutationFn: async (planId: string) => {
      // Real checkout opens Razorpay here; the demo flows straight through.
      const order = await callApi('/subscription/order', {
        method: 'POST',
        body: { plan_id: planId },
        responseSchema: createOrderResponse,
      })
      return callApi('/subscription/activate', {
        method: 'POST',
        body: { order_id: order.order_id, payment_id: 'pay_demo' },
        responseSchema: activateResponse,
      })
    },
    onSuccess: async (r) => {
      setMsg(`Plan active until ${new Date(r.expires_at).toLocaleDateString('en-IN')}.`)
      await refresh()
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'Could not activate.'),
  })

  const gateTone = { active: 'success', grace: 'warning', grandfathered: 'info', expired: 'danger' } as const

  return (
    <>
      <PageHeader
        title="Subscription"
        description="Manage your studio's plan."
        actions={
          session && <StatusBadge tone={gateTone[session.plan_gate]}>{humanize(session.plan_gate)}</StatusBadge>
        }
      />
      {msg && <p className="mb-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}

      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {(data ?? []).map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" />
                  {p.name}
                </CardTitle>
                <p className="text-2xl font-semibold">
                  {formatINR(p.price)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {' '}
                    / {p.billing_interval === 'yearly' ? 'year' : 'month'}
                  </span>
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-success" /> All studio features
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-success" /> GST invoicing
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 text-success" /> +18% GST at checkout
                  </li>
                </ul>
                <Button onClick={() => subscribe.mutate(p.id)} disabled={subscribe.isPending}>
                  {subscribe.isPending ? 'Processing…' : 'Subscribe'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
