import { CheckIcon } from 'lucide-react'
import type { CalEvent } from '@/lib/types'
import { fmtTime, toDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export function EventRow({
  event,
  added,
  onSelect,
}: {
  event: CalEvent
  added: boolean
  onSelect: (ev: CalEvent) => void
}) {
  const start = toDate(event.start, event.allDay)
  const past = start <= new Date()
  const meta = [event.calendar, event.location].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      disabled={past}
      onClick={() => onSelect(event)}
      className={cn(
        'flex w-full items-stretch gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
        'hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      <span aria-hidden className="w-1 shrink-0 rounded-full" style={{ background: event.color ?? 'var(--primary)' }} />
      <span className="w-12 shrink-0 text-sm font-medium tabular-nums">
        {event.allDay ? 'Ganzt.' : fmtTime.format(start)}
        {!event.allDay && (
          <span className="block text-xs font-normal text-muted-foreground">{fmtTime.format(new Date(event.end))}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{event.title}</span>
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {added && (
            <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-emerald-600 dark:text-emerald-400">
              <CheckIcon className="size-3" /> Widget
            </span>
          )}
          {added && meta && <span>·</span>}
          <span className="truncate">{meta}</span>
        </span>
      </span>
    </button>
  )
}
