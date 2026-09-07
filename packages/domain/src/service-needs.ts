/**
 * Crew needs for a shoot day. Requirements arrive by name, so "Drone pilot"
 * twice in one payload (or differing only by case/whitespace) is one need
 * with the quantities added — not two rows the booking screen double-counts.
 * Pure, so the API and its tests share it.
 */
export interface ServiceNeed {
  name: string
  quantity: number
}

export function mergeServiceNeeds(lines: ReadonlyArray<{ name: string; quantity: number }>): ServiceNeed[] {
  const merged = new Map<string, ServiceNeed>()
  for (const line of lines) {
    const name = line.name.trim()
    if (!name) continue
    const prev = merged.get(name.toLowerCase())
    merged.set(
      name.toLowerCase(),
      prev ? { name: prev.name, quantity: prev.quantity + line.quantity } : { name, quantity: line.quantity },
    )
  }
  return [...merged.values()]
}
