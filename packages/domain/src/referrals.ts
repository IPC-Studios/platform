import { roundINR } from './money'

export interface RewardCalculationInput {
  reward_type: 'percentage' | 'fixed' | 'credit' | 'custom'
  reward_value: number
  deal_value?: number
}

export function calculateReward(input: RewardCalculationInput): number {
  switch (input.reward_type) {
    case 'percentage':
      return roundINR(((input.deal_value ?? 0) * input.reward_value) / 100)
    case 'fixed':
      return roundINR(input.reward_value)
    case 'credit':
      return roundINR(input.reward_value)
    case 'custom':
      return roundINR(input.reward_value)
  }
}

export function duplicateCheck(
  existing: ReadonlyArray<{ client_phone: string | null; client_email: string | null }>,
  newPhone: string | null,
  newEmail: string | null,
): boolean {
  if (!newPhone && !newEmail) return false
  return existing.some(
    (e) =>
      (newPhone && e.client_phone === newPhone) ||
      (newEmail && e.client_email === newEmail),
  )
}
