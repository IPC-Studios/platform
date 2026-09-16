import { Link } from '@tanstack/react-router'
import { Receipt, Plus, ExternalLink } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useProjectExpenses } from '@/features/financials/api'
import { AddExpenseDialog } from '@/routes/company-expenses'

/** This project's own expenses — a real tab instead of a link away to the global page. */
export function ExpensesTab({ projectId }: { projectId: string }) {
  const { data, isLoading, isError, refetch } = useProjectExpenses(projectId)
  const total = (data ?? []).reduce((s, e) => s + e.amount, 0)

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Expenses on this project{data && data.length > 0 ? ` — ${formatINR(total)} total` : ''}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/company-expenses">
              <ExternalLink /> All expenses
            </Link>
          </Button>
          {/* This used to be an "Add expense" button that only navigated to the
              global list, so pressing it added nothing. */}
          <AddExpenseDialog
            presetProjectId={projectId}
            trigger={
              <Button size="sm">
                <Plus /> Add expense
              </Button>
            }
          />
        </div>
      </div>

      {isLoading ? (
        <SkeletonList rows={3} columns={3} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No expenses logged"
          description="Costs charged against this project will show up here."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/company-expenses">
                <Plus /> Add expense
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((e) => (
            <li key={e.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <Receipt className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{e.category ?? 'Uncategorised'}</span>
                    {e.description && (
                      <span className="block truncate text-xs text-muted-foreground">{e.description}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.expense_date}</span>
                  <span className="font-medium tabular-nums">{formatINR(e.amount)}</span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
