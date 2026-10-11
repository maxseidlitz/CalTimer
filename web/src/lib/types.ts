export type CalEvent = {
  id: string
  uid: string
  title: string
  location: string | null
  allDay: boolean
  start: string
  end: string
  calendar: string
  color: string | null
  repeat?: string | null
  added?: boolean
  reasons?: string[]
  score?: number
}

export type Widget = {
  id: string
  title: string
  start: string
  allDay: boolean
  location: string | null
  calendar: string | null
  color: string | null
  eventId: string | null
  createdAt: string
}

export type CalendarInfo = {
  id: string
  name: string
  color: string | null
  hint: string
}

export type FeedError = { calendar: string; error: string }

export type Status = { connected: boolean; calendars: CalendarInfo[]; demo: boolean }

export type AuthStatus = { setupRequired: boolean; authenticated: boolean }

export type Overview = {
  connected: boolean
  upcoming: CalEvent[]
  suggestions: CalEvent[]
  errors: FeedError[]
}
