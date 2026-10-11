import type { CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { countdown, describeWhen, since, toDate } from '@/lib/time'
import { cn } from '@/lib/utils'

type WidgetLike = {
  title: string
  start: string
  allDay: boolean
  calendar: string | null
  color: string | null
}

const UNITS = [
  ['days', 'Tage'],
  ['hours', 'Std'],
  ['minutes', 'Min'],
  ['seconds', 'Sek'],
] as const

export function WidgetCard({
  widget,
  now,
  onClick,
  className,
}: {
  widget: WidgetLike
  now: number
  onClick?: () => void
  className?: string
}) {
  const c = countdown(toDate(widget.start, widget.allDay).getTime(), now)
  const accent = { '--accent-color': widget.color ?? 'var(--primary)' } as CSSProperties

  const body = (
    <Card
      style={accent}
      className={cn(
        'relative min-w-0 gap-0 overflow-hidden p-0 transition-colors',
        onClick && 'hover:bg-accent/40',
        c.past && 'opacity-60',
        className,
      )}
    >
      {/* Farbstreifen des Kalenders */}
      <div aria-hidden className="h-1 w-full bg-(--accent-color)" />

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="line-clamp-2 text-base leading-snug font-semibold break-words">{widget.title}</h3>
          {/* Datum und Kalender dürfen umbrechen statt sich zu überlagern. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm whitespace-nowrap text-muted-foreground">
              {describeWhen(widget.start, widget.allDay)}
            </span>
            {widget.calendar && (
              <Badge variant="secondary" className="max-w-full justify-start" title={widget.calendar}>
                <span className="min-w-0 truncate">{widget.calendar}</span>
              </Badge>
            )}
          </div>
        </div>

        {c.past ? (
          <p className="text-sm font-medium text-muted-foreground">Vorbei · {since(c.ms)}</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {UNITS.map(([key, label]) => (
              <div key={key} className="min-w-0 rounded-lg bg-muted/60 px-1 py-2.5 text-center">
                <div
                  className={cn(
                    'truncate text-2xl leading-none font-semibold tracking-tight tabular-nums',
                    key === 'days' && 'text-(--accent-color)',
                  )}
                >
                  {key === 'days' ? c.days : String(c[key]).padStart(2, '0')}
                </div>
                <div className="mt-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )

  if (!onClick) return body
  return (
    <button type="button" onClick={onClick} className="block w-full min-w-0 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      {body}
    </button>
  )
}
