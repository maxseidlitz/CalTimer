import { useState, type FormEvent } from 'react'
import { LinkIcon, ShieldCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import type { CalendarInfo } from '@/lib/types'

export function ConnectCalendar({ onAdded, compact = false }: { onAdded: (cal: CalendarInfo) => void; compact?: boolean }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const cal = await api<CalendarInfo>('/calendars', { method: 'POST', body: { url, name } })
      setUrl('')
      setName('')
      onAdded(cal)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {!compact && (
        <div className="flex gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-muted-foreground">
            CalTimer bekommt <span className="font-medium text-foreground">kein iCloud-Passwort</span>. Du gibst einzelne
            Kalender per geheimem Link frei – nur diese Termine sind lesbar.
          </p>
        </div>
      )}

      <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
        {[
          <>iPhone: <b className="font-medium text-foreground">Kalender</b>-App → unten <b className="font-medium text-foreground">Kalender</b> → <b className="font-medium text-foreground">(i)</b> neben dem Kalender</>,
          <><b className="font-medium text-foreground">Öffentlicher Kalender</b> einschalten → <b className="font-medium text-foreground">Link teilen</b> → <b className="font-medium text-foreground">Kopieren</b></>,
          <>Link hier einfügen</>,
        ].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="cal-url">Kalender-Link</Label>
          <Input
            id="cal-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="webcal://p…-caldav.icloud.com/published/…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cal-name">Name (optional)</Label>
          <Input id="cal-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="wird aus dem Kalender übernommen" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={busy}>
          <LinkIcon /> {busy ? 'Prüfe Kalender …' : 'Kalender hinzufügen'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Behandle den Link wie ein Passwort. „Öffentlicher Kalender“ aus- und wieder einschalten erzeugt einen neuen Link.
        </p>
      </form>
    </div>
  )
}
