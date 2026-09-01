import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { createLeadRequest, type CreateLeadRequest } from '@ipc/contracts'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useAddLead } from './api'

type Field = 'name' | 'phone' | 'email'

const LABELS: Record<Field, string> = { name: 'Name', phone: 'Phone', email: 'Email' }

/**
 * Adding a lead by hand — the enquiry that came in over the phone.
 *
 * Only the number is required: it is how the studio finds them again, and it is
 * what the server dedupes on. Everything else can be filled in from the drawer
 * once there is time.
 */
export function AddLeadDialog({ onAdded }: { onAdded?: (id: string) => void }) {
  const add = useAddLead()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState<CreateLeadRequest['source']>('enquiry')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<FieldErrors<Field>>({})

  function reset() {
    setName('')
    setPhone('')
    setEmail('')
    setSource('enquiry')
    setNotes('')
    setErrors({})
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = {
      phone: phone.trim(),
      source,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    const found = fieldErrors<Field>(createLeadRequest, body, { labels: LABELS })
    setErrors(found)
    if (Object.keys(found).length > 0) return

    add.mutate(createLeadRequest.parse(body), {
      onSuccess: (lead) => {
        setOpen(false)
        reset()
        onAdded?.(lead.id)
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add lead
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a lead"
        description="A number is enough to start. If we already have it, you'll be taken to that lead instead."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>
              Phone <span className="text-destructive">*</span>
            </Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210"
              aria-invalid={!!errors.phone}
              autoFocus
            />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Aanya Sharma"
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Optional"
                aria-invalid={!!errors.email}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Source</Label>
              <Select
                value={source}
                onChange={(e) => setSource(e.target.value as CreateLeadRequest['source'])}
              >
                <option value="enquiry">Enquiry</option>
                <option value="referral">Referral</option>
                <option value="manual">Manual</option>
                <option value="webform">Web form</option>
                <option value="facebook">Facebook</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What are they asking for? Dates, budget, how they found you."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add lead'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
