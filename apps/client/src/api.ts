/** Talks to the core over HTTP. The client holds no business logic: it asks, and draws the answer. */
import type { FigureId, FigureRecords, IsoDate, RecordCard, RecordRef, WorldMaster, WorldState } from '@ai-erp/domain';

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The core answered ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

const states = new Map<IsoDate, Promise<WorldState>>();

export const api = {
  master: (): Promise<WorldMaster> => get('/master'),

  /** World state for a date. Cached, because replaying visits each day many times. */
  state(date: IsoDate): Promise<WorldState> {
    let pending = states.get(date);
    if (!pending) {
      pending = get<WorldState>(`/state?at=${date}`);
      states.set(date, pending);
      pending.catch(() => states.delete(date));
    }
    return pending;
  },

  record: (ref: RecordRef, date: IsoDate): Promise<RecordCard> =>
    get(`/records/${ref.type}/${encodeURIComponent(ref.id)}?at=${date}`),

  figureRecords: (id: FigureId, date: IsoDate): Promise<FigureRecords> => get(`/figures/${id}/records?at=${date}`),
};
