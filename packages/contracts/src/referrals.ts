import { z } from 'zod'
import { uuid, isoDateTime, money, pagination, paginated } from './shared/primitives'

export const referralRewardType = z.enum(['percentage', 'fixed', 'credit', 'custom'])
export type ReferralRewardType = z.infer<typeof referralRewardType>

export const referralCampaignStatus = z.enum(['active', 'paused', 'ended'])
export type ReferralCampaignStatus = z.infer<typeof referralCampaignStatus>

export const referralSubmissionStatus = z.enum(['pending', 'converted', 'rewarded', 'rejected'])
export type ReferralSubmissionStatus = z.infer<typeof referralSubmissionStatus>

export const referralCampaign = z.object({
  id: uuid,
  company_id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  reward_type: referralRewardType,
  reward_value: money,
  reward_description: z.string().nullable(),
  status: referralCampaignStatus,
  created_at: isoDateTime,
})
export type ReferralCampaign = z.infer<typeof referralCampaign>

export const referralCampaignSummary = z.object({
  total_campaigns: z.number().int(),
  active_campaigns: z.number().int(),
  total_submissions: z.number().int(),
  converted_submissions: z.number().int(),
  total_rewards: money,
})
export type ReferralCampaignSummary = z.infer<typeof referralCampaignSummary>

export const referralSubmission = z.object({
  id: uuid,
  campaign_id: uuid,
  campaign_name: z.string(),
  referrer_name: z.string().nullable(),
  referrer_phone: z.string().nullable(),
  client_name: z.string(),
  client_phone: z.string().nullable(),
  client_email: z.string().nullable(),
  status: referralSubmissionStatus,
  reward_granted: z.boolean(),
  reward_amount: money.nullable(),
  notes: z.string().nullable(),
  created_at: isoDateTime,
})
export type ReferralSubmission = z.infer<typeof referralSubmission>

export const referralCampaignList = z.object({
  campaigns: z.array(referralCampaign),
  summary: referralCampaignSummary,
})
export type ReferralCampaignList = z.infer<typeof referralCampaignList>

export const createReferralCampaignRequest = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullish(),
  reward_type: referralRewardType.default('fixed'),
  reward_value: money.default(0),
  reward_description: z.string().trim().max(200).nullish(),
})
export type CreateReferralCampaignRequest = z.infer<typeof createReferralCampaignRequest>

export const referralSubmissionList = z.object({
  items: z.array(referralSubmission),
  next_cursor: isoDateTime.nullable().default(null),
})
export type ReferralSubmissionList = z.infer<typeof referralSubmissionList>

export const submitReferralRequest = z.object({
  referrer_name: z.string().trim().max(160).nullish(),
  referrer_phone: z.string().trim().max(40).nullish(),
  client_name: z.string().trim().min(2).max(160),
  client_phone: z.string().trim().max(40).nullish(),
  client_email: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
})
export type SubmitReferralRequest = z.infer<typeof submitReferralRequest>
