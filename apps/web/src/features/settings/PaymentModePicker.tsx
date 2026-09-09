import { useState } from 'react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Label, Select, Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { useActiveLookups, useCreateCustomLookup } from './api'

/** Pick a studio-defined payment mode, or add one inline without leaving the form (owner only). */
export function PaymentModePicker({
  value,
  onChange,
  label = 'Mode',
}: {
  value: string
  onChange: (v: string) => void
  label?: string
}) {
  const { session } = useAuth()
  const { data: modes } = useActiveLookups('payment_type')
  const createLookup = useCreateCustomLookup()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  async function onAdd() {
    if (!name.trim()) return
    await createLookup.mutateAsync({ category: 'payment_type', value: name.trim() })
    onChange(name.trim())
    setAdding(false)
    setName('')
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>New payment mode</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wallet" autoFocus />
          <Button type="button" size="sm" onClick={() => void onAdd()} disabled={!name.trim() || createLookup.isPending}>
            Add
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select
        value={value}
        onChange={(e) => {
          if (e.target.value === '__add__') setAdding(true)
          else onChange(e.target.value)
        }}
      >
        <option value="">—</option>
        {/* A mode logged before one was renamed or removed still shows its own text, unselected from the list. */}
        {value && !(modes ?? []).some((m) => m.value === value) && <option value={value}>{value}</option>}
        {(modes ?? []).map((m) => (
          <option key={m.id} value={m.value}>
            {m.value}
          </option>
        ))}
        {session?.is_owner && <option value="__add__">+ Add new mode…</option>}
      </Select>
    </div>
  )
}
