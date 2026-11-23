import { api } from './api'

export type LoanCurrency = 'EUR' | 'USD'

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
  /** Currency of the loan. Cannot be changed. */
  currency: LoanCurrency
  /** Amount lent in `currency`, fixed-point string with 2 decimals. */
  lent: string
  /** Amount still to be refunded in `currency`. 0 once repaid. This is what counts in the net worth. */
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
  add: (body: { platform: string; name: string; currency: LoanCurrency; lent: string; outstanding?: string; dueDate: string }) => api<Loan>(`${BASE}/loans`, { method: 'POST', body }),
  /** The currency and the amount lent cannot be changed. */
  update: (id: string, body: { platform?: string; name?: string; outstanding?: string; dueDate?: string; active?: boolean }) =>
    api<Loan>(`${BASE}/loans/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`${BASE}/loans/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
