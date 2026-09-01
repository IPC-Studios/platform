import { Link } from '@tanstack/react-router'
import { TrendingUp, Wallet, IndianRupee } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { StatCard } from '@/shared/ui/stat-card'
import { LoadingState, ErrorState, EmptyState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useProjectFinancials } from '@/features/financials/api'

export function FinancialsPage() {
  return (
    <AuthedPage module="financials">
      <Financials />
    </AuthedPage>
  )
}

function Financials() {
  const { data, isLoading, isError, refetch } = useProjectFinancials()

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (!data || data.length === 0)
    return (
      <>
        <PageHeader title="Financials" />
        <EmptyState
          title="No financial data yet"
          description="Profit is computed from project revenue and the costs booked against it. Create a project to start."
          action={
            <Button variant="outline" asChild>
              <Link to="/projects">Go to projects</Link>
            </Button>
          }
        />
      </>
    )

  const totalRevenue = data.reduce((s, p) => s + p.revenue, 0)
  const totalGross = data.reduce((s, p) => s + p.gross_profit, 0)
  const totalPending = data.reduce((s, p) => s + p.balance_pending, 0)

  return (
    <>
      <PageHeader title="Financials" description="Profit per project (booked value)." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total revenue" value={formatINR(totalRevenue)} icon={IndianRupee} />
        <StatCard label="Gross profit" value={formatINR(totalGross)} icon={TrendingUp} />
        <StatCard label="Pending" value={formatINR(totalPending)} icon={Wallet} />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 text-right font-medium">Revenue</th>
              <th className="px-4 py-2 text-right font-medium">Team cost</th>
              <th className="px-4 py-2 text-right font-medium">Expenses</th>
              <th className="px-4 py-2 text-right font-medium">Gross profit</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.project_id} className="border-t border-border">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-right">{formatINR(p.revenue)}</td>
                <td className="px-4 py-2 text-right text-muted-foreground">{formatINR(p.direct_team_cost)}</td>
                <td className="px-4 py-2 text-right text-muted-foreground">{formatINR(p.project_expenses)}</td>
                <td className={`px-4 py-2 text-right font-semibold ${p.gross_profit < 0 ? 'text-destructive' : 'text-success'}`}>
                  {formatINR(p.gross_profit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
