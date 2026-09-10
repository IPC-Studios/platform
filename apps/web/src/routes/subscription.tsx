import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Sparkles } from 'lucide-react'
import {
  plan,
  createOrderResponse,
  activateResponse,
  type ActivateRequest,
  type Plan,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { formatINR, humanize } from '@/shared/ui/format'
import { openCheckout } from '@/features/billing/razorpay-checkout'

const plans = plan.array()

export function SubscriptionPage() {
  return (
    <AuthedPage module="settings_subscription">
      <Subscription />
    </AuthedPage>
  )
}

type Outcome = { tone: 'success' | 'error' | 'info'; text: string }

function Subscription() {
  const { session, refresh } = useAuth()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: () => callApi('/subscription/plans', { responseSchema: plans }),
    enabled: !!session,
  })

  const subscribe = useMutation({
    mutationFn: async (p: Plan) => {
      const order = await callApi('/subscription/order', {
        method: 'POST',
        body: { plan_id: p.id },
        responseSchema: createOrderResponse,
      })

      let proof: ActivateRequest
      if (order.razorpay_order_id && order.key_id) {
        // Real checkout: the signature Razorpay hands back is the proof the
        // API verifies before touching the plan.
        const paid = await openCheckout({
          keyId: order.key_id,
          razorpayOrderId: order.razorpay_order_id,
          amountRupees: order.amount,
          currency: order.currency,
          studioName: 'IPC Studios',
          description: `${p.name} plan`,
          prefill: { name: session?.display_name ?? '', email: session?.email ?? '' },
        })
        if (!paid) return null
        proof = {
          order_id: order.order_id,
          payment_id: paid.razorpay_payment_id,
          signature: paid.razorpay_signature,
        }
      } else {
        // No provider configured: the API allows this only on a dev bench and
        // refuses it anywhere else.
        proof = { order_id: order.order_id, payment_id: 'pay_demo' }
      }
      return callApi('/subscription/activate', {
        method: 'POST',
        body: proof,
        responseSchema: activateResponse,
      })
    },
    onSuccess: async (r) => {
      if (!r) {
        setOutcome({ tone: 'info', text: 'Checkout was closed before paying. Nothing was charged.' })
        return
      }
      setOutcome({
        tone: 'success',
        text: `Plan active until ${new Date(r.expires_at).toLocaleDateString('en-IN')}.`,
      })
      await refresh()
    },
    onError: (e) =>
      setOutcome({ tone: 'error', text: e instanceof Error ? e.message : 'Could not activate.' }),
  })

  const gateTone = { active: 'success', grace: 'warning', grandfathered: 'info', expired: 'danger' } as const
  const outcomeClass = {
    success: 'bg-success/10 text-success',
    error: 'bg-destructive/10 text-destructive',
    info: 'bg-muted text-muted-foreground',
  }

  return (
    <>
      <PageHeader
        title="Subscription"
        description="Manage your studio's plan."
        actions={
          session && (
            <StatusBadge tone={gateTone[session.plan_gate]}>{humanize(session.plan_gate)}</StatusBadge>
          )
        }
      />
      <SettingsTabs />
      {session?.plan_expiry && (
        <p className="mb-4 text-sm text-muted-foreground">
          Current plan runs until {new Date(session.plan_expiry).toLocaleDateString('en-IN')}. Paying
          again extends from that date, so nothing is lost by renewing early.
        </p>
      )}
      {outcome && (
        <p role="status" className={`mb-4 rounded-md px-3 py-2 text-sm ${outcomeClass[outcome.tone]}`}>
          {outcome.text}
        </p>
      )}

      {isLoading ? (
        <SkeletonCards count={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No plans are on offer yet"
          description="Plans are published by the platform. Until one is, your studio keeps its current access."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {data.map((p) => (
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
                <Button
                  onClick={() => subscribe.mutate(p)}
                  disabled={subscribe.isPending || !session?.is_owner}
                  title={session?.is_owner ? undefined : 'Only the studio owner can change the plan.'}
                >
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
