/**
 * The automation rule language, in one place the UI and the tests can read.
 * The database evaluates rules for real (0035 crm_rule_matches /
 * crm_apply_automations); this mirrors that logic so a rule can be explained
 * and previewed before it is saved, and so the two cannot silently disagree.
 */
export type AutomationTrigger = 'lead_created' | 'stage_changed' | 'follow_up_overdue'
export type AutomationAction =
  | 'assign_to'
  | 'set_follow_up_days'
  | 'mark_hot'
  | 'add_note'
  | 'notify_assignee'
  | 'start_cadence'

export interface RuleCondition {
  source?: string | undefined
  to_status?: string | undefined
  from_status?: string | undefined
  is_hot?: boolean | undefined
}

export interface RuleLead {
  source: string
  status: string
  is_hot: boolean
}

/** Every key present on the condition must match; an empty condition matches all. */
export function ruleMatches(cond: RuleCondition, lead: RuleLead, fromStatus: string | null): boolean {
  if (cond.source !== undefined && cond.source !== lead.source) return false
  if (cond.to_status !== undefined && cond.to_status !== lead.status) return false
  if (cond.from_status !== undefined && cond.from_status !== fromStatus) return false
  if (cond.is_hot !== undefined && cond.is_hot !== lead.is_hot) return false
  return true
}

export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  lead_created: 'a lead arrives',
  stage_changed: 'a lead changes stage',
  follow_up_overdue: 'a follow-up is overdue',
}

export const ACTION_LABEL: Record<AutomationAction, string> = {
  assign_to: 'assign it to',
  set_follow_up_days: 'schedule a follow-up in',
  mark_hot: 'mark it hot',
  add_note: 'add a note',
  notify_assignee: 'notify the owner',
  start_cadence: 'start the cadence',
}

export interface RuleShape {
  trigger: AutomationTrigger
  condition: RuleCondition
  action: AutomationAction
  action_value: {
    user_id?: string | undefined
    days?: number | undefined
    note?: string | undefined
    cadence_id?: string | undefined
  }
}

/** One sentence a person can read back: "When a lead arrives from facebook, mark it hot." */
export function describeRule(
  rule: RuleShape,
  userName?: (id: string) => string | undefined,
  cadenceName?: (id: string) => string | undefined,
): string {
  const when = `When ${TRIGGER_LABEL[rule.trigger]}`
  const clauses: string[] = []
  if (rule.condition.source) clauses.push(`from ${rule.condition.source}`)
  if (rule.condition.from_status) clauses.push(`leaving ${rule.condition.from_status}`)
  if (rule.condition.to_status) clauses.push(`into ${rule.condition.to_status}`)
  if (rule.condition.is_hot !== undefined) clauses.push(rule.condition.is_hot ? 'that is hot' : 'that is not hot')
  let does: string = ACTION_LABEL[rule.action]
  if (rule.action === 'assign_to' && rule.action_value.user_id) {
    does += ` ${userName?.(rule.action_value.user_id) ?? 'a teammate'}`
  } else if (rule.action === 'set_follow_up_days') {
    const d = rule.action_value.days ?? 1
    does += ` ${d} day${d === 1 ? '' : 's'}`
  } else if (rule.action === 'add_note' && rule.action_value.note) {
    does += ` “${rule.action_value.note}”`
  } else if (rule.action === 'start_cadence' && rule.action_value.cadence_id) {
    does += ` “${cadenceName?.(rule.action_value.cadence_id) ?? 'follow-up'}”`
  }
  return `${when}${clauses.length ? ' ' + clauses.join(' ') : ''}, ${does}.`
}
