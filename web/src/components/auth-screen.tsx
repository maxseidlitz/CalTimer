import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

export function AuthScreen({ setupRequired, onDone }: { setupRequired: boolean; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (setupRequired && passphrase !== repeat) {
      setError('Die Passphrasen stimmen nicht überein.')
      return
    }
    setBusy(true)
    try {
      await api(setupRequired ? '/auth/setup' : '/auth/login', { method: 'POST', body: { code, passphrase } })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-[calc(env(safe-area-inset-top)+2rem)]">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src="/icon.svg" alt="" width={56} height={56} className="mx-auto mb-2 rounded-2xl" />
          <CardTitle className="text-xl">{setupRequired ? 'CalTimer einrichten' : 'Willkommen zurück'}</CardTitle>
          <CardDescription>
            {setupRequired
              ? 'Lege eine Passphrase fest (mind. 10 Zeichen). Den Einrichtungscode findest du im Log des Containers.'
              : 'Melde dich mit deiner Passphrase an.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {setupRequired && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">Einrichtungscode</Label>
                <Input id="code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="passphrase">Passphrase</Label>
              <Input
                id="passphrase"
                type="password"
                required
                minLength={setupRequired ? 10 : undefined}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete={setupRequired ? 'new-password' : 'current-password'}
                autoFocus
              />
            </div>
            {setupRequired && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="repeat">Passphrase wiederholen</Label>
                <Input id="repeat" type="password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Einen Moment …' : setupRequired ? 'Einrichten' : 'Anmelden'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
