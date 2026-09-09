import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { DirectoryMember } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { useUpdateMember, useAssignRoles, useEmployeeRoles } from './api'
import { byStage } from './role-stages'

const PAYOUT_LABEL: Record<string, string> = {
  salary: 'Salary',
  per_shoot: 'Per shoot',
  per_day: 'Per day',
  per_project: 'Per project',
  custom: 'Custom',
}

/**
 * Everything about a team member the create wizard could set, editable
 * afterwards: this is the same field set, not a trimmed-down version of it.
 * Pay is its own section since it's owner-only and most edits here are
 * contact-detail fixes, not salary revisions.
 */
export function EditMemberDialog({ member }: { member: DirectoryMember }) {
  const update = useUpdateMember()
  const assignRoles = useAssignRoles()
  const { data: roles } = useEmployeeRoles()
  const [open, setOpen] = useState(false)

  const [name, setName] = useState(member.name)
  const [phone, setPhone] = useState(member.phone ?? '')
  const [alternatePhone, setAlternatePhone] = useState(member.alternate_phone ?? '')
  const [address, setAddress] = useState(member.address ?? '')
  const [role, setRole] = useState(member.role as 'super_admin' | 'admin' | 'manager' | 'employee')
  const [engagementType, setEngagementType] = useState<'in_house' | 'freelancer'>(
    member.engagement_type === 'freelancer' ? 'freelancer' : 'in_house',
  )
  const [roleIds, setRoleIds] = useState<string[]>(member.role_ids)

  const [showPay, setShowPay] = useState(false)
  const [salary, setSalary] = useState(member.salary != null ? String(member.salary) : '')
  const [payoutType, setPayoutType] = useState(member.payout_type ?? '')
  const [commissionPct, setCommissionPct] = useState(member.commission_pct != null ? String(member.commission_pct) : '')
  const [commissionBasis, setCommissionBasis] = useState(member.commission_basis ?? '')
  const [stipendAmount, setStipendAmount] = useState(member.stipend_amount != null ? String(member.stipend_amount) : '')
  const [payFrom, setPayFrom] = useState(member.pay_effective_from ?? '')
  const [payTo, setPayTo] = useState(member.pay_effective_to ?? '')
  const [compNotes, setCompNotes] = useState(member.compensation_notes ?? '')

  const [error, setError] = useState<string | null>(null)
  const freelance = engagementType === 'freelancer'

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  async function onSave() {
    setError(null)
    try {
      await update.mutateAsync({
        userId: member.user_id,
        patch: {
          name: name.trim(),
          phone: phone.trim() || null,
          alternate_phone: alternatePhone.trim() || null,
          address: address.trim() || null,
          ...(role === 'super_admin' ? {} : { role }),
          engagement_type: engagementType,
          salary: salary.trim() === '' ? null : Number(salary),
          payout_type: payoutType ? (payoutType as NonNullable<typeof member.payout_type>) : null,
          commission_pct: commissionPct.trim() === '' ? null : Number(commissionPct),
          commission_basis: commissionBasis ? (commissionBasis as NonNullable<typeof member.commission_basis>) : null,
          stipend_amount: stipendAmount.trim() === '' ? null : Number(stipendAmount),
          pay_effective_from: payFrom || null,
          pay_effective_to: payTo || null,
          compensation_notes: compNotes.trim() || null,
        },
      })
      const currentIds = new Set(member.role_ids)
      const nextIds = new Set(roleIds)
      const changed = currentIds.size !== nextIds.size || [...currentIds].some((id) => !nextIds.has(id))
      if (changed) await assignRoles.mutateAsync({ userId: member.user_id, roles: { role_ids: roleIds } })
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save these changes.')
    }
  }

  const busy = update.isPending || assignRoles.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Edit">
          <Pencil />
          <span className="sr-only">Edit {member.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent title={`Edit ${member.name}`} description="Anything set when they joined can be corrected here.">
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Alternate phone</Label>
              <Input value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Engagement</Label>
              <Select value={engagementType} onChange={(e) => setEngagementType(e.target.value as 'in_house' | 'freelancer')}>
                <option value="in_house">In-house staff</option>
                <option value="freelancer">Freelancer / Vendor</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="City or full address" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Access level</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)} disabled={role === 'super_admin'}>
              {role === 'super_admin' && <option value="super_admin">Owner</option>}
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="employee">Employee</option>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Job roles</Label>
            {byStage(roles ?? []).map(
              (group) =>
                group.roles.length > 0 && (
                  <div key={group.stage}>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {group.roles.map((r) => (
                        <label key={r.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                          <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
                          {r.type_name}
                        </label>
                      ))}
                    </div>
                  </div>
                ),
            )}
          </div>

          {!showPay ? (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setShowPay(true)}>
              Edit pay ({salary ? formatINR(Number(salary)) : 'not set'}
              {payoutType ? ` · ${PAYOUT_LABEL[payoutType]}` : ''})
            </Button>
          ) : (
            <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>{freelance ? 'Standard rate (₹)' : 'Monthly salary (₹)'}</Label>
                  <Input inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Payout type</Label>
                  <Select value={payoutType} onChange={(e) => setPayoutType(e.target.value)}>
                    <option value="">Same as above</option>
                    <option value="salary">Salary</option>
                    <option value="per_shoot">Per shoot</option>
                    <option value="per_day">Per day</option>
                    <option value="per_project">Per project</option>
                    <option value="custom">Custom</option>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Commission %</Label>
                  <Input inputMode="numeric" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} placeholder="0" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Commission basis</Label>
                  <Select value={commissionBasis} onChange={(e) => setCommissionBasis(e.target.value)}>
                    <option value="">—</option>
                    <option value="revenue">On project revenue</option>
                    <option value="payment">On payment received</option>
                    <option value="profit">On profit</option>
                    <option value="manual">Manual</option>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Stipend (₹)</Label>
                  <Input inputMode="numeric" value={stipendAmount} onChange={(e) => setStipendAmount(e.target.value)} placeholder="0" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Effective from</Label>
                  <Input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Effective to</Label>
                  <Input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Pay notes</Label>
                <Input value={compNotes} onChange={(e) => setCompNotes(e.target.value)} placeholder="e.g. Second-shooter rate for weddings" />
              </div>
            </div>
          )}

          <Card>
            <CardContent className="p-3 text-xs text-muted-foreground">
              Active / inactive and removing this person happen from the row actions, not here.
            </CardContent>
          </Card>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void onSave()} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
