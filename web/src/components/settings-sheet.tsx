import { useState } from 'react'
import { LogOutIcon, PlusIcon, ShieldAlertIcon, Trash2Icon } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ConnectCalendar } from '@/components/connect-calendar'
import { api } from '@/lib/api'
import type { CalendarInfo } from '@/lib/types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  calendars: CalendarInfo[]
  onCalendarsChange: (calendars: CalendarInfo[]) => void
}

export function SettingsSheet({ open, onOpenChange, calendars, onCalendarsChange }: Props) {
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<CalendarInfo | null>(null)
  const [logoutAll, setLogoutAll] = useState(false)

  async function remove(cal: CalendarInfo) {
    try {
      await api(`/calendars/${encodeURIComponent(cal.id)}`, { method: 'DELETE' })
      onCalendarsChange(calendars.filter((c) => c.id !== cal.id))
      toast.success(`„${cal.name}“ entfernt`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function logout(all: boolean) {
    await api(all ? '/auth/logout-all' : '/auth/logout', { method: 'POST' }).catch(() => {})
    location.reload()
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setAdding(false) }}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Einstellungen</SheetTitle>
            <SheetDescription>Kalender und Anmeldung verwalten.</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-6 px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Kalender</h3>
              <div className="overflow-hidden rounded-xl border">
                {calendars.length === 0 && <p className="p-4 text-sm text-muted-foreground">Noch kein Kalender freigegeben.</p>}
                {calendars.map((cal, i) => (
                  <div key={cal.id}>
                    {i > 0 && <Separator />}
                    <div className="flex items-center gap-3 p-3">
                      <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: cal.color ?? 'var(--primary)' }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{cal.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{cal.hint}</p>
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label={`${cal.name} entfernen`} onClick={() => setRemoving(cal)}>
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {adding ? (
                <div className="rounded-xl border p-4">
                  <ConnectCalendar
                    compact
                    onAdded={(cal) => {
                      onCalendarsChange([...calendars, cal])
                      setAdding(false)
                      toast.success(`„${cal.name}“ hinzugefügt`)
                    }}
                  />
                </div>
              ) : (
                <Button variant="outline" onClick={() => setAdding(true)}>
                  <PlusIcon /> Kalender hinzufügen
                </Button>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Sicherheit</h3>
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={() => logout(false)}>
                  <LogOutIcon /> Abmelden
                </Button>
                <Button variant="outline" className="text-destructive" onClick={() => setLogoutAll(true)}>
                  <ShieldAlertIcon /> Alle Geräte abmelden
                </Button>
              </div>
            </section>

            <p className="text-xs text-muted-foreground">
              Tipp: In Safari über „Teilen → Zum Home-Bildschirm“ öffnet sich CalTimer wie eine App im Vollbild.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{removing?.name}“ entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Deine Widgets bleiben erhalten. Schalte „Öffentlicher Kalender“ auf dem iPhone ebenfalls aus, damit der Link ungültig wird.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => removing && remove(removing)}>
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={logoutAll} onOpenChange={setLogoutAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alle Geräte abmelden?</AlertDialogTitle>
            <AlertDialogDescription>Du musst dich danach auf jedem Gerät neu anmelden.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => logout(true)}>
              Abmelden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
