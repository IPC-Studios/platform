import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { useGopoSummary } from '@/features/gopo/api'
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Wallet,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'

function GopoContent() {
  const { data, isLoading } = useGopoSummary()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="GOPO Dashboard" description="Cash flow health analysis" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  const { score_card, expense_breakdown, project_performance, attention_items, recent_activity } = data

  const healthColors = {
    excellent: 'bg-green-100 text-green-800',
    good: 'bg-blue-100 text-blue-800',
    fair: 'bg-yellow-100 text-yellow-800',
    poor: 'bg-orange-100 text-orange-800',
    critical: 'bg-red-100 text-red-800',
  }

  const severityColors = {
    info: 'border-l-blue-500',
    warning: 'border-l-yellow-500',
    critical: 'border-l-red-500',
  }

  return (
    <div className="space-y-6">
      <PageHeader title="GOPO Dashboard" description="Cash flow health analysis" />

      {/* Health Score */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Studio Health</CardTitle>
            <Badge className={healthColors[score_card.health_label]}>
              {score_card.health_label.toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="relative h-24 w-24">
              <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeDasharray={`${score_card.health_score * 2.51} 251`}
                  className={
                    score_card.health_score >= 60
                      ? 'text-green-500'
                      : score_card.health_score >= 40
                        ? 'text-yellow-500'
                        : 'text-red-500'
                  }
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold">{score_card.health_score}</span>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Collection Rate</p>
                <p className="text-xl font-semibold">{score_card.collection_rate}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Profit Margin</p>
                <p className="text-xl font-semibold">{score_card.profit_margin}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Net Profit</p>
                <p className={`text-xl font-semibold ${score_card.net_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ₹{score_card.net_profit.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding</p>
                <p className="text-xl font-semibold">₹{score_card.outstanding_balance.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Revenue" value={`₹${score_card.total_revenue.toLocaleString()}`} icon={TrendingUp} />
        <StatCard label="Total Received" value={`₹${score_card.total_received.toLocaleString()}`} icon={Wallet} />
        <StatCard label="Total Expenses" value={`₹${score_card.total_expenses.toLocaleString()}`} icon={BarChart3} />
        <StatCard label="Team Cost" value={`₹${score_card.total_direct_team_cost.toLocaleString()}`} icon={DollarSign} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Expense Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {expense_breakdown.map((item) => (
                <div key={item.category} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{item.category.replace(/_/g, ' ')}</span>
                      <span className="text-sm text-muted-foreground">₹{item.amount.toLocaleString()} ({item.percentage}%)</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {expense_breakdown.length === 0 && (
                <p className="text-center text-muted-foreground">No expenses recorded.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Attention Items */}
        <Card>
          <CardHeader>
            <CardTitle>Needs Attention</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {attention_items.map((item, i) => (
                <div
                  key={i}
                  className={`border-l-4 bg-muted/50 p-3 rounded-r-lg ${severityColors[item.severity]}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium">{item.message}</p>
                      {item.amount !== null && (
                        <p className="text-xs text-muted-foreground">
                          ₹{item.amount.toLocaleString()}
                        </p>
                      )}
                    </div>
                    {item.severity === 'critical' ? (
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              ))}
              {attention_items.length === 0 && (
                <div className="flex items-center gap-2 py-4 text-center text-muted-foreground">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Everything looks good!</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Project Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Project Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                  <th className="pb-2 text-right font-medium">Received</th>
                  <th className="pb-2 text-right font-medium">Team Cost</th>
                  <th className="pb-2 text-right font-medium">Expenses</th>
                  <th className="pb-2 text-right font-medium">Profit</th>
                  <th className="pb-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {project_performance.map((p) => (
                  <tr key={p.project_id} className="border-b last:border-0">
                    <td className="py-2">
                      <span className="font-medium">{p.project_name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.status}</span>
                    </td>
                    <td className="py-2 text-right">₹{p.revenue.toLocaleString()}</td>
                    <td className="py-2 text-right">₹{p.received.toLocaleString()}</td>
                    <td className="py-2 text-right">₹{p.direct_team_cost.toLocaleString()}</td>
                    <td className="py-2 text-right">₹{p.project_expenses.toLocaleString()}</td>
                    <td className={`py-2 text-right font-medium ${p.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ₹{p.gross_profit.toLocaleString()}
                    </td>
                    <td className="py-2 text-right">
                      <span className={p.profit_margin >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {p.profit_margin}%
                      </span>
                    </td>
                  </tr>
                ))}
                {project_performance.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-muted-foreground">No projects found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recent_activity.map((item, i) => (
              <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0">
                <div>
                  <p className="text-sm font-medium">{item.description}</p>
                  <p className="text-xs text-muted-foreground">{item.date}</p>
                </div>
                <span className={`flex items-center gap-1 text-sm font-medium ${item.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                  {item.type === 'income' ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4" />
                  )}
                  ₹{item.amount.toLocaleString()}
                </span>
              </div>
            ))}
            {recent_activity.length === 0 && (
              <p className="py-4 text-center text-muted-foreground">No recent activity.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function GopoPage() {
  return (
    <AuthedPage module="financials">
      <GopoContent />
    </AuthedPage>
  )
}
