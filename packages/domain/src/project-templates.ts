export interface TemplateDeliverable {
  name: string
  description: string | null
  quantity: number
}

export interface TemplateShoot {
  name: string
  kind: string | null
  duration_hours: number | null
}

export interface TemplateTask {
  title: string
  priority: string
  sort_order: number
}

export function expandTemplate(template: {
  deliverables_json: TemplateDeliverable[]
  shoots_json: TemplateShoot[]
  tasks_json: TemplateTask[]
}): {
  deliverables: TemplateDeliverable[]
  shoots: TemplateShoot[]
  tasks: TemplateTask[]
} {
  return {
    deliverables: template.deliverables_json.map((d, i) => ({
      ...d,
      quantity: d.quantity || 1,
      sort_order: i,
    })),
    shoots: template.shoots_json.map((s, i) => ({
      ...s,
      sort_order: i,
    })),
    tasks: template.tasks_json.map((t, i) => ({
      ...t,
      sort_order: t.sort_order ?? i,
    })),
  }
}

export function templateStats(template: {
  deliverables_json: TemplateDeliverable[]
  shoots_json: TemplateShoot[]
  tasks_json: TemplateTask[]
}): { deliverableCount: number; shootCount: number; taskCount: number } {
  return {
    deliverableCount: template.deliverables_json.length,
    shootCount: template.shoots_json.length,
    taskCount: template.tasks_json.length,
  }
}
