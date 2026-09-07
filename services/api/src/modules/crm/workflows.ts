import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  createScoringRuleRequest,
  createWorkflowRequest,
  enrollWorkflowRequest,
  enrollWorkflowResponse,
  recomputeScoresResponse,
  scoringRule,
  updateScoringRuleRequest,
  updateWorkflowRequest,
  workflow,
  outboxRow,
  workflowEnrollment,
  type WorkflowStepInput,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/**
 * Workflows: multi-step automations the database runs (0040), their
 * enrollments, and the scoring rules. Mounted under /crm with the leads
 * router's auth and module guard.
 */
const edit = requireAction('crm', 'edit')
const remove = requireAction('crm', 'delete')

const selectWorkflows = (sql: TransactionSql) => sql`
  select w.id, w.name, w.trigger, w.condition, w.is_active, w.allow_reenroll, w.exit_on_reply, w.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', s.id, 'step_no', s.step_no, 'kind', s.kind, 'config', s.config) order by s.step_no)
           from crm_workflow_steps s where s.workflow_id = w.id
         ), '[]'::jsonb) as steps,
         (select count(*) from crm_workflow_enrollments e where e.workflow_id = w.id and e.status = 'active')::int as active_count,
         (select count(*) from crm_workflow_enrollments e where e.workflow_id = w.id and e.status = 'completed')::int as completed_count,
         (select count(*) from crm_workflow_enrollments e where e.workflow_id = w.id and e.status = 'errored')::int as errored_count,
         (select max(e.enrolled_at) from crm_workflow_enrollments e where e.workflow_id = w.id) as last_enrolled_at
  from crm_workflows w`

const selectEnrollments = (sql: TransactionSql) => sql`
  select e.id, e.workflow_id, w.name as workflow_name, e.lead_id, l.name as lead_name, e.current_step, e.next_at,
         e.status, e.exit_reason, e.steps_run, e.log, e.enrolled_at
  from crm_workflow_enrollments e
  join crm_workflows w on w.id = e.workflow_id
  left join crm_leads l on l.id = e.lead_id`

async function writeSteps(sql: TransactionSql, workflowId: string, steps: WorkflowStepInput[]) {
  await sql`delete from crm_workflow_steps where workflow_id = ${workflowId}`
  for (const [i, step] of steps.entries()) {
    await sql`
      insert into crm_workflow_steps (workflow_id, company_id, step_no, kind, config)
      values (${workflowId}, get_current_company_id(), ${i + 1}, ${step.kind}, ${sql.json(step.config as Parameters<typeof sql.json>[0])})`
  }
}

export const crmWorkflowsRouter = new Hono<AppEnv>()
  // ── Workflows ───────────────────────────────────────────────
  .get('/workflows', async (c) => {
    const rows = await attempt(c, 'crm.workflows', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`${selectWorkflows(sql)} order by w.created_at`),
    )
    if (!rows) fail(400, 'We could not load workflows.')
    return c.json(workflow.array().parse(rows))
  })

  .post('/workflows', edit, async (c) => {
    const parsed = createWorkflowRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the workflow.')
    const v = parsed.data
    const row = await attempt(
      c,
      'crm.workflow_create',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [w] = await sql<{ id: string }[]>`
            insert into crm_workflows (company_id, name, trigger, condition, is_active, allow_reenroll, exit_on_reply)
            values (get_current_company_id(), ${v.name}, ${v.trigger}, ${sql.json(v.condition)}, ${v.is_active}, ${v.allow_reenroll}, ${v.exit_on_reply})
            returning id`
          if (!w) return null
          await writeSteps(sql, w.id, v.steps)
          const [full] = await sql`${selectWorkflows(sql)} where w.id = ${w.id}`
          return full ?? null
        }),
      { onCode: (code) => (code === '23505' ? ('taken' as const) : undefined) },
    )
    if (row === 'taken') fail(409, 'A workflow with that name already exists.')
    if (!row) fail(400, 'We could not save this workflow.')
    const created = workflow.parse(row)
    await audit(c, { action: 'workflow.create', entityType: 'crm_workflow', entityId: created.id, after: { name: v.name, trigger: v.trigger, steps: v.steps.length } })
    return c.json(created, 201)
  })

  .patch('/workflows/:id', edit, async (c) => {
    const parsed = updateWorkflowRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const { steps, condition, ...rest } = parsed.data
    const rows = await attempt(c, 'crm.workflow_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const patch: Record<string, unknown> = { ...rest }
        if (condition) patch.condition = sql.json(condition)
        const out = Object.keys(patch).length
          ? await sql<{ id: string }[]>`update crm_workflows set ${sql(patch)} where id = ${id} returning id`
          : await sql<{ id: string }[]>`select id from crm_workflows where id = ${id}`
        if (out.length && steps) await writeSteps(sql, id, steps)
        return out
      }),
    )
    if (!rows) fail(400, 'We could not update this workflow.')
    if (!rows.length) fail(404, 'That workflow was not found.')
    await audit(c, { action: 'workflow.update', entityType: 'crm_workflow', entityId: id, after: { ...rest, steps: steps?.length } })
    return c.body(null, 204)
  })

  .delete('/workflows/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.workflow_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`delete from crm_workflows where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this workflow.')
    if (!rows.length) fail(404, 'That workflow was not found.')
    await audit(c, { action: 'workflow.delete', entityType: 'crm_workflow', entityId: id })
    return c.body(null, 204)
  })

  // ── Enrollments ─────────────────────────────────────────────
  .post('/workflows/:id/enroll', edit, async (c) => {
    const parsed = enrollWorkflowRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick at least one deal.')
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.workflow_enroll', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ n: number }[]>`
        select crm_enroll_manual(${id}, ${sql.array(parsed.data.lead_ids)}::uuid[]) as n`),
    )
    if (!rows) fail(400, 'We could not enroll those deals.')
    const enrolled = rows[0]?.n ?? 0
    await audit(c, { action: 'workflow.enroll', entityType: 'crm_workflow', entityId: id, after: { leads: parsed.data.lead_ids.length, enrolled } })
    return c.json(enrollWorkflowResponse.parse({ enrolled }))
  })

  .get('/workflows/:id/enrollments', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.workflow_enrollments', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        ${selectEnrollments(sql)} where e.workflow_id = ${id} order by e.enrolled_at desc limit 200`),
    )
    if (!rows) fail(400, 'We could not load enrollments.')
    return c.json(workflowEnrollment.array().parse(rows))
  })

  .get('/leads/:id/enrollments', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.lead_enrollments', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        ${selectEnrollments(sql)} where e.lead_id = ${id} order by e.enrolled_at desc limit 50`),
    )
    if (!rows) fail(400, 'We could not load enrollments.')
    return c.json(workflowEnrollment.array().parse(rows))
  })

  .post('/enrollments/:id/exit', edit, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.enrollment_exit', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update crm_workflow_enrollments set status = 'exited', exit_reason = 'stopped by a person', next_at = null
        where id = ${id} and status = 'active' returning id`),
    )
    if (!rows) fail(400, 'We could not stop this enrollment.')
    if (!rows.length) fail(404, 'That enrollment is not active.')
    await audit(c, { action: 'workflow.exit', entityType: 'crm_workflow_enrollment', entityId: id })
    return c.body(null, 204)
  })

  /**
   * What the workflows queued and whether it went. A send_template step
   * lands in the outbox and the hourly tick drains it; a failure there used
   * to exist only in a server log, so a studio saw nothing at all.
   */
  .get('/outbox', async (c) => {
    const rows = await attempt(c, 'crm.outbox', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select o.id, o.lead_id, l.name as lead_name, t.name as template_name, o.channel, o.status, o.error,
               o.created_at, o.sent_at
        from crm_outbox o
        left join crm_leads l on l.id = o.lead_id
        left join crm_templates t on t.id = o.template_id
        order by o.created_at desc
        limit 100`),
    )
    if (!rows) fail(400, 'We could not load the message queue.')
    return c.json(outboxRow.array().parse(rows))
  })

  // ── Scoring ─────────────────────────────────────────────────
  .get('/scoring-rules', async (c) => {
    const rows = await attempt(c, 'crm.scoring_rules', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, label, field, op, value, points, is_active, position from crm_scoring_rules order by position, created_at`),
    )
    if (!rows) fail(400, 'We could not load scoring rules.')
    return c.json(scoringRule.array().parse(rows))
  })

  .post('/scoring-rules', edit, async (c) => {
    const parsed = createScoringRuleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the rule.')
    const v = parsed.data
    const row = await attempt(c, 'crm.scoring_rule_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql`
          insert into crm_scoring_rules (company_id, label, field, op, value, points, position)
          values (get_current_company_id(), ${v.label}, ${v.field}, ${v.op}, ${v.value === undefined ? null : sql.json(v.value as never)}, ${v.points},
                  (select coalesce(max(position), -1) + 1 from crm_scoring_rules))
          returning id, label, field, op, value, points, is_active, position`
        return r ?? null
      }),
    )
    if (!row) fail(400, 'We could not add this rule.')
    const created = scoringRule.parse(row)
    await audit(c, { action: 'scoring_rule.create', entityType: 'crm_scoring_rule', entityId: created.id, after: v })
    return c.json(created, 201)
  })

  .patch('/scoring-rules/:id', edit, async (c) => {
    const parsed = updateScoringRuleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const { value, ...rest } = parsed.data
    const rows = await attempt(c, 'crm.scoring_rule_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const patch: Record<string, unknown> = { ...rest }
        if (value !== undefined) patch.value = sql.json(value as never)
        return sql<{ id: string }[]>`update crm_scoring_rules set ${sql(patch)} where id = ${id} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update this rule.')
    if (!rows.length) fail(404, 'That rule was not found.')
    await audit(c, { action: 'scoring_rule.update', entityType: 'crm_scoring_rule', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/scoring-rules/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.scoring_rule_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`delete from crm_scoring_rules where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this rule.')
    if (!rows.length) fail(404, 'That rule was not found.')
    await audit(c, { action: 'scoring_rule.delete', entityType: 'crm_scoring_rule', entityId: id })
    return c.body(null, 204)
  })

  // Rescore every open deal after the rules change.
  .post('/scoring/recompute', edit, async (c) => {
    const rows = await attempt(c, 'crm.scoring_recompute', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ n: number }[]>`
        select count(*)::int as n from (
          select crm_score_lead(l.id) from crm_leads l where l.is_archived = false limit 5000
        ) x`),
    )
    if (!rows) fail(400, 'We could not recompute the scores.')
    const rescored = rows[0]?.n ?? 0
    await audit(c, { action: 'scoring.recompute', entityType: 'crm_scoring_rule', after: { rescored } })
    return c.json(recomputeScoresResponse.parse({ rescored }))
  })
