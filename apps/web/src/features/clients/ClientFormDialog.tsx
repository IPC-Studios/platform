import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { useCreateClient } from './api'

/** Create-client modal. Owner/manager only surfaces are gated by the caller. */
export function ClientFormDialog() {
  const create = useCreateClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await create.mutateAsync({
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
      })
      setOpen(false)
      setName('')
      setPhone('')
      setEmail('')
      setCity('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the client.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New client
        </Button>
      </DialogTrigger>
      <DialogContent title="New client" description="Add someone you work with.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mumbai" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@email.in" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Add client'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
