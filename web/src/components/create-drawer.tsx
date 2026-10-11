import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeftIcon, PlusIcon, SparklesIcon, XIcon } from 'lucide-react'
import { de } from 'react-day-picker/locale'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConnectCalendar } from '@/components/connect-calendar'
import { EventRow } from '@/components/event-row'
import { WidgetCard } from '@/components/widget-card'
import { api, range } from '@/lib/api'
import type { CalEvent, CalendarInfo, FeedError, Overview, Widget } from '@/lib/types'
import { addDays, DAY, dayHeading, dayKey, describeWhen, eventDays, inDays, startOfDay, startOfMonth, toDate } from '@/lib/time'

const LIST_DAYS = 60

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connected: boolean
  widgets: Widget[]
  now: number
  onCalendarAdded: (cal: CalendarInfo) => void
  onCreate: (ev: CalEvent, title: string) => Promise<void>
}

let lastFeedError = ''
function reportFeedErrors(errors: FeedError[] = []) {
  const msg = errors.map((e) => `${e.calendar}: ${e.error}`).join(' · ')
  if (msg && msg !== lastFeedError) toast.error(msg)
  lastFeedError = msg
}

export function CreateDrawer({ open, onOpenChange, connected, widgets, now, onCalendarAdded, onCreate }: Props) {
  const [tab, setTab] = useState('list')
  const [selected, setSelected] = useState<CalEvent | null>(null)

  // Beim Öffnen immer mit der Liste starten.
  useEffect(() => {
    if (open) {
      setTab('list')
      setSelected(null)
    }
  }, [open])

  const addedIds = useMemo(() => new Set(widgets.map((w) => w.eventId).filter(Boolean)), [widgets])

  let title = 'Widget erstellen'
  let description = 'Wähle einen Termin für deinen Countdown.'
  if (!connected) {
    title = 'Kalender verbinden'
    description = 'Gib einen iCloud-Kalender frei, um Termine auszuwählen.'
  } else if (selected) {
    title = 'Neues Widget'
    description = 'Titel anpassen und erstellen.'
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto h-[92dvh] max-w-2xl">
        <DrawerHeader className="relative px-4 text-left">
          {selected && (
            <Button variant="ghost" size="sm" className="mb-1 -ml-2 w-fit" onClick={() => setSelected(null)}>
              <ArrowLeftIcon /> Zurück
            </Button>
          )}
          <DrawerTitle className="text-lg">{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]" data-vaul-no-drag>
          {!connected ? (
            <ConnectCalendar onAdded={onCalendarAdded} />
          ) : selected ? (
            <ConfirmView event={selected} now={now} onCreate={onCreate} />
          ) : (
            <Tabs value={tab} onValueChange={setTab} className="gap-4">
              <TabsList className="sticky top-0 z-10 grid w-full grid-cols-3">
                <TabsTrigger value="list">Liste</TabsTrigger>
                <TabsTrigger value="month">Kalender</TabsTrigger>
                <TabsTrigger value="suggestions">
                  <SparklesIcon /> Vorschläge
                </TabsTrigger>
              </TabsList>
              <TabsContent value="list">
                <ListTab addedIds={addedIds} onSelect={setSelected} />
              </TabsContent>
              <TabsContent value="month">
                <MonthTab addedIds={addedIds} onSelect={setSelected} />
              </TabsContent>
              <TabsContent value="suggestions">
                <SuggestionsTab onSelect={setSelected} onCreate={onCreate} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

// ---------- Liste ----------

function ListTab({ addedIds, onSelect }: { addedIds: Set<string | null>; onSelect: (ev: CalEvent) => void }) {
  const [events, setEvents] = useState<CalEvent[] | null>(null)
  const [until, setUntil] = useState<Date | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (from: Date, to: Date) => {
    const res = await api<{ events: CalEvent[]; errors: FeedError[] }>(`/events?${range(from, to)}`)
    reportFeedErrors(res.errors)
    const nowDate = new Date()
    // Bereits begonnene Termine sind kein sinnvolles Countdown-Ziel.
    return res.events.filter((ev) => toDate(ev.start, ev.allDay) > nowDate)
  }, [])

  useEffect(() => {
    const from = new Date()
    const to = new Date(from.getTime() + LIST_DAYS * DAY)
    load(from, to)
      .then((evs) => {
        setEvents(evs)
        setUntil(to)
      })
      .catch((err) => setError(err.message))
  }, [load])

  async function loadMore() {
    if (!until) return
    setLoadingMore(true)
    const to = new Date(until.getTime() + LIST_DAYS * DAY)
    try {
      const more = await load(until, to)
      setEvents((prev) => {
        const seen = new Set((prev ?? []).map((e) => e.id))
        return [...(prev ?? []), ...more.filter((e) => !seen.has(e.id))]
      })
      setUntil(to)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  if (error) return <p className="py-10 text-center text-sm text-muted-foreground">{error}</p>
  if (!events) return <ListSkeleton />

  const groups = new Map<string, CalEvent[]>()
  for (const ev of events) {
    const key = dayKey(toDate(ev.start, ev.allDay))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(ev)
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.size === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Keine anstehenden Termine.</p>}
      {[...groups.entries()].map(([key, evs]) => (
        <section key={key} className="flex flex-col gap-2">
          <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {dayHeading(toDate(key, true))}
          </h3>
          {evs.map((ev) => (
            <EventRow key={ev.id} event={ev} added={addedIds.has(ev.id)} onSelect={onSelect} />
          ))}
        </section>
      ))}
      <Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
        {loadingMore ? 'Lade …' : 'Weitere Termine laden'}
      </Button>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  )
}

// ---------- Kalender ----------

function MonthTab({ addedIds, onSelect }: { addedIds: Set<string | null>; onSelect: (ev: CalEvent) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()))
  const [cache, setCache] = useState<Record<string, CalEvent[]>>({})
  const monthId = dayKey(month).slice(0, 7)
  const events = cache[monthId]

  useEffect(() => {
    if (cache[monthId]) return
    // Ganze sichtbare Wochen abdecken (inkl. Tage aus Nachbarmonaten).
    const from = addDays(month, -7)
    const to = addDays(month, 45)
    api<{ events: CalEvent[]; errors: FeedError[] }>(`/events?${range(from, to)}`)
      .then((res) => {
        reportFeedErrors(res.errors)
        setCache((c) => ({ ...c, [monthId]: res.events }))
      })
      .catch((err) => toast.error(err.message))
  }, [month, monthId, cache])

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>()
    for (const ev of events ?? []) {
      for (const d of eventDays(ev)) {
        if (!map.has(d)) map.set(d, [])
        map.get(d)!.push(ev)
      }
    }
    return map
  }, [events])

  const daysWithEvents = useMemo(() => [...byDay.keys()].map((k) => toDate(k, true)), [byDay])
  const dayEvents = byDay.get(dayKey(day)) ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card p-2">
        <Calendar
          mode="single"
          locale={de}
          required
          selected={day}
          onSelect={(d) => d && setDay(d)}
          month={month}
          onMonthChange={(m) => setMonth(startOfMonth(m))}
          modifiers={{ hasEvents: daysWithEvents }}
          modifiersClassNames={{
            hasEvents:
              'relative after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary',
          }}
          className="w-full bg-transparent p-0 [--cell-size:--spacing(10)]"
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{dayHeading(day)}</h3>
        {!events ? (
          <Skeleton className="h-14 w-full" />
        ) : dayEvents.length ? (
          dayEvents.map((ev) => <EventRow key={ev.id} event={ev} added={addedIds.has(ev.id)} onSelect={onSelect} />)
        ) : (
          <p className="px-1 text-sm text-muted-foreground">Keine Termine an diesem Tag.</p>
        )}
      </section>
    </div>
  )
}

// ---------- Vorschläge ----------

function SuggestionsTab({
  onSelect,
  onCreate,
}: {
  onSelect: (ev: CalEvent) => void
  onCreate: (ev: CalEvent, title: string) => Promise<void>
}) {
  const [items, setItems] = useState<CalEvent[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Overview>('/overview')
      .then((ov) => {
        reportFeedErrors(ov.errors)
        setItems(ov.suggestions)
      })
      .catch((err) => toast.error(err.message))
  }, [])

  useEffect(load, [load])

  async function add(ev: CalEvent) {
    setBusy(ev.id)
    try {
      await onCreate(ev, ev.title)
      setItems((list) => list?.filter((s) => s.id !== ev.id) ?? null)
    } finally {
      setBusy(null)
    }
  }

  async function dismiss(ev: CalEvent) {
    setItems((list) => list?.filter((s) => s.title !== ev.title) ?? null)
    try {
      await api('/suggestions/dismiss', { method: 'POST', body: { title: ev.title } })
      load()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (!items) return <ListSkeleton />
  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <SparklesIcon className="size-6 text-muted-foreground" />
        <p className="font-medium">Gerade keine Vorschläge</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Vorschläge entstehen aus Urlauben, Geburtstagen, Konzerten, Deadlines & mehrtägigen Terminen der nächsten 4 Monate.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((ev) => (
        <div key={ev.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: ev.color ?? 'var(--primary)' }} />
            <button type="button" onClick={() => onSelect(ev)} className="min-w-0 flex-1 text-left">
              <p className="line-clamp-2 font-medium break-words">{ev.title}</p>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{describeWhen(ev.start, ev.allDay, true)}</p>
            </button>
            <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 shrink-0" aria-label={`„${ev.title}“ ausblenden`} onClick={() => dismiss(ev)}>
              <XIcon />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{inDays(toDate(ev.start, ev.allDay))}</span>
            {ev.reasons?.map((r) => (
              <Badge key={r} variant="secondary">
                {r}
              </Badge>
            ))}
            <Button size="sm" className="ml-auto" disabled={busy === ev.id} onClick={() => add(ev)}>
              <PlusIcon /> Hinzufügen
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- Bestätigen ----------

function ConfirmView({
  event,
  now,
  onCreate,
}: {
  event: CalEvent
  now: number
  onCreate: (ev: CalEvent, title: string) => Promise<void>
}) {
  const [title, setTitle] = useState(event.title)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await onCreate(event, title.trim() || event.title)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <WidgetCard widget={{ ...event, title: title.trim() || event.title }} now={now} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="widget-title">Titel auf dem Widget</Label>
        <Input id="widget-title" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} />
      </div>
      <Button type="submit" size="lg" disabled={busy}>
        <PlusIcon /> Widget erstellen
      </Button>
    </form>
  )
}
