import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClockIcon, PlusIcon, SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { AuthScreen } from '@/components/auth-screen'
import { CreateDrawer } from '@/components/create-drawer'
import { SettingsSheet } from '@/components/settings-sheet'
import { WidgetCard } from '@/components/widget-card'
import { useNow } from '@/hooks/use-now'
import { api, AUTH_EVENT } from '@/lib/api'
import type { AuthStatus, CalEvent, CalendarInfo, Status, Widget } from '@/lib/types'
import { describeWhen, toDate } from '@/lib/time'

type Phase = 'loading' | 'auth' | 'ready' | 'offline'

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [setupRequired, setSetupRequired] = useState(false)
  const [calendars, setCalendars] = useState<CalendarInfo[]>([])
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleting, setDeleting] = useState<Widget | null>(null)
  const now = useNow()

  const load = useCallback(async () => {
    try {
      const auth = await api<AuthStatus>('/auth/status')
      if (!auth.authenticated) {
        setSetupRequired(auth.setupRequired)
        setPhase('auth')
        return
      }
      const [status, list] = await Promise.all([api<Status>('/status'), api<Widget[]>('/widgets')])
      setCalendars(status.calendars)
      setWidgets(list)
      setPhase('ready')
    } catch (err) {
      if ((err as { status?: number }).status !== 401) setPhase('offline')
    }
  }, [])

  useEffect(() => {
    load()
    // Sitzung abgelaufen → zurück zur Anmeldung.
    const onAuth = () => {
      setSetupRequired(false)
      setPhase('auth')
    }
    window.addEventListener(AUTH_EVENT, onAuth)
    return () => window.removeEventListener(AUTH_EVENT, onAuth)
  }, [load])

  // Kommende zuerst (nächster oben), vergangene ans Ende.
  const sorted = useMemo(() => {
    return [...widgets].sort((a, b) => {
      const ta = toDate(a.start, a.allDay).getTime()
      const tb = toDate(b.start, b.allDay).getTime()
      const pa = ta <= now
      const pb = tb <= now
      if (pa !== pb) return pa ? 1 : -1
      return pa ? tb - ta : ta - tb
    })
    // Sortierung nur bei Änderungen der Liste neu berechnen, nicht jede Sekunde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets])

  async function createWidget(ev: CalEvent, title: string) {
    try {
      const widget = await api<Widget>('/widgets', {
        method: 'POST',
        body: {
          title,
          start: ev.start,
          allDay: ev.allDay,
          location: ev.location,
          calendar: ev.calendar,
          color: ev.color,
          eventId: ev.id,
        },
      })
      setWidgets((list) => [...list, widget])
      setCreateOpen(false)
      toast.success('Widget erstellt', { description: title })
    } catch (err) {
      toast.error((err as Error).message)
      throw err
    }
  }

  async function deleteWidget(w: Widget) {
    try {
      await api(`/widgets/${encodeURIComponent(w.id)}`, { method: 'DELETE' })
      setWidgets((list) => list.filter((x) => x.id !== w.id))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (phase === 'auth') {
    return (
      <>
        <AuthScreen setupRequired={setupRequired} onDone={load} />
        <Toaster position="top-center" />
      </>
    )
  }

  if (phase === 'offline') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-medium">Server nicht erreichbar</p>
        <p className="text-sm text-muted-foreground">Ist der CalTimer-Container gestartet und bist du im Heimnetz?</p>
        <Button variant="outline" onClick={() => { setPhase('loading'); load() }}>
          Erneut versuchen
        </Button>
      </main>
    )
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" width={28} height={28} className="rounded-lg" />
            <h1 className="text-lg font-semibold tracking-tight">CalTimer</h1>
          </div>
          <Button variant="ghost" size="icon" aria-label="Einstellungen" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+6.5rem)]">
        {phase === 'loading' ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CalendarClockIcon className="size-6 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold">Noch keine Timer</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Tippe unten auf „Widget erstellen“ und wähle einen Termin aus deinem Kalender.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((w) => (
              <WidgetCard key={w.id} widget={w} now={now} onClick={() => setDeleting(w)} />
            ))}
          </div>
        )}
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center bg-linear-to-t from-background via-background/80 to-transparent px-4 pt-8 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <Button size="lg" className="pointer-events-auto h-12 rounded-full px-6 text-base shadow-lg" onClick={() => setCreateOpen(true)}>
          <PlusIcon /> Widget erstellen
        </Button>
      </div>

      <CreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        connected={calendars.length > 0}
        widgets={widgets}
        now={now}
        onCalendarAdded={(cal) => {
          setCalendars((list) => [...list, cal])
          toast.success(`„${cal.name}“ hinzugefügt`)
        }}
        onCreate={createWidget}
      />

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} calendars={calendars} onCalendarsChange={setCalendars} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Widget löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && `„${deleting.title}“ – ${describeWhen(deleting.start, deleting.allDay)}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && deleteWidget(deleting)}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster position="top-center" />
    </div>
  )
}
