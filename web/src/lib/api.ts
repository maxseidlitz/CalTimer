export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Wird ausgelöst, wenn die Sitzung abgelaufen ist – App zeigt dann die Anmeldung.
export const AUTH_EVENT = 'caltimer:auth-required'

type Options = { method?: string; body?: unknown }

export async function api<T = unknown>(path: string, { method = 'GET', body }: Options = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null as T
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && data.code === 'auth') window.dispatchEvent(new Event(AUTH_EVENT))
  if (!res.ok) throw new ApiError(data.error || `Fehler ${res.status}`, res.status, data.code)
  return data as T
}

export const range = (from: Date, to: Date) =>
  `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
