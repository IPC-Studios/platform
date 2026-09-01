import { useState, type FormEvent } from 'react'
import { Check, Copy, UserPlus } from 'lucide-react'
import { createInvitationRequest } from '@ipc/contracts'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useCreateInvitation } from './api'

type Field = 'name' | 'email' | 'role' | 'phone'

const LABELS: Record<Field, string> = {
  name: 'Name',
  email: 'Email',
  role: 'Access level',
  phone: 'Phone',
}

/**
 * Invite — the other half of Add Team Member.
 *
 * Adding sets someone's password for them; inviting lets them set their own via
 * a 7-day link. The link is shown after sending because the email is not always
 * the channel that reaches crew: most of this gets pasted into WhatsApp.
 */
export function InviteDialog() {
  const invite = useCreateInvitation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<'admin' | 'manager' | 'employee'>('employee')
  const [engagement, setEngagement] = useState<'in_house' | 'freelancer'>('in_house')
  const [errors, setErrors] = useState<FieldErrors<Field>>({})
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function reset() {
    setName('')
    setEmail('')
    setPhone('')
    setRole('employee')
    setEngagement('in_house')
    setErrors({})
    setLink(null)
    setCopied(false)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = {
      name: name.trim(),
      email: email.trim(),
      role,
      engagement_type: engagement,
      role_ids: [],
      ...(phone.trim() ? { phone: phone.trim() } : {}),
    }
    const found = fieldErrors<Field>(createInvitationRequest, body, { labels: LABELS })
    setErrors(found)
    if (Object.keys(found).length > 0) return

    invite.mutate(createInvitationRequest.parse(body), {
      onSuccess: (res) => setLink(res.invite_link),
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
        <Button variant="outline">
          <UserPlus /> Invite User
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Invite a team member"
        description="They set their own password from the link. It expires in 7 days."
      >
        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Invitation sent to <span className="font-medium">{email}</span>. You can also send them
              this link directly.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(link)
                  setCopied(true)
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!errors.name}
                autoFocus
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!errors.email}
                placeholder="name@example.com"
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Access level</Label>
                <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Engagement</Label>
                <Select
                  value={engagement}
                  onChange={(e) => setEngagement(e.target.value as typeof engagement)}
                >
                  <option value="in_house">In-house staff</option>
                  <option value="freelancer">Freelancer / Vendor</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
                aria-invalid={!!errors.phone}
              />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? 'Sending…' : 'Send invitation'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
