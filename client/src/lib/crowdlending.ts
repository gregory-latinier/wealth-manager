import { api } from './api'

export interface LoanLastValue {
  usd: string
  eur: string
  date: string
  stale: boolean
}

export interface Loan {
  id: string
  /** For example 8lends or La Premiere Brique. */
  platform: string
  /** The project that was financed. */
  name: string
  /** EUR lent, fixed-point string with 2 decimals. */
  lent: string
  /** EUR still to be refunded. 0 once repaid. This is what counts in the net worth. */
  outstanding: string
  /** Expected refund date, YYYY-MM-DD. */
  dueDate: string
  active: boolean
  createdAt: string
  lastValue: LoanLastValue | null
}

const BASE = '/api/admin/crowdlending'

export const crowdlendingApi = {
  list: () => api<{ loans: Loan[] }>(`${BASE}/loans`),
  /** The outstanding amount defaults to the amount lent. */
  add: (body: { platform: string; name: string; lent: string; outstanding?: string; dueDate: string }) => api<Loan>(`${BASE}/loans`, { method: 'POST', body }),
  /** The amount lent cannot be changed. */
  update: (id: string, body: { platform?: string; name?: string; outstanding?: string; dueDate?: string; active?: boolean }) =>
    api<Loan>(`${BASE}/loans/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`${BASE}/loans/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
