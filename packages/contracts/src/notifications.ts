import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const notification = z.object({
  id: uuid,
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  read_at: isoDateTime.nullable(),
  created_at: isoDateTime,
})
export type Notification = z.infer<typeof notification>
