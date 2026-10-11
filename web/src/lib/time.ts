export const DAY = 24 * 60 * 60 * 1000

/** Ganztägige Termine kommen als "YYYY-MM-DD" und starten um lokale Mitternacht. */
export function toDate(value: string, allDay: boolean): Date {
  if (allDay) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(value)
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export function dayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Alle Kalendertage, die ein Termin berührt (Ende bei Ganztägigen exklusiv). */
export function eventDays(ev: { start: string; end: string; allDay: boolean }) {
  const start = startOfDay(toDate(ev.start, ev.allDay))
  let end = toDate(ev.end, ev.allDay)
  if (ev.allDay || end.getTime() === startOfDay(end).getTime()) end = new Date(end.getTime() - 1)
  if (end < start) end = start
  const days: string[] = []
  for (let d = start; d <= end && days.length < 62; d = addDays(d, 1)) days.push(dayKey(d))
  return days
}

const fmtDayHeading = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
const fmtLong = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const fmtShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
export const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })

export function dayHeading(d: Date) {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / DAY)
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Morgen'
  return fmtDayHeading.format(d)
}

export function describeWhen(start: string, allDay: boolean, short = false) {
  const d = toDate(start, allDay)
  const day = (short ? fmtShort : fmtLong).format(d)
  return allDay ? `${day} · ganztägig` : `${day} · ${fmtTime.format(d)} Uhr`
}

export function inDays(d: Date) {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / DAY)
  if (diff <= 0) return 'Heute'
  if (diff === 1) return 'Morgen'
  if (diff < 14) return `in ${diff} Tagen`
  if (diff < 60) return `in ${Math.round(diff / 7)} Wochen`
  return `in ${Math.round(diff / 30)} Monaten`
}

export type Countdown =
  | { past: true; ms: number }
  | { past: false; days: number; hours: number; minutes: number; seconds: number }

export function countdown(target: number, now: number): Countdown {
  const ms = target - now
  if (ms <= 0) return { past: true, ms }
  const total = Math.floor(ms / 1000)
  return {
    past: false,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

export function since(ms: number) {
  const mins = Math.floor(Math.abs(ms) / 60000)
  if (mins < 1) return 'Jetzt!'
  if (mins < 60) return `seit ${mins} Min.`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `seit ${hours} Std.`
  const days = Math.floor(hours / 24)
  return `seit ${days} ${days === 1 ? 'Tag' : 'Tagen'}`
}
