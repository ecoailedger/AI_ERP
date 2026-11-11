/**
 * Core: the business, independent of any front end.
 * Give it a dataset and it answers: what did the world look like on this date, and which records say so?
 * It must not import anything from the game (scene, client).
 */
import {
  addDays,
  BUILDING_IDS,
  clampDate,
  type BuildingId,
  type Dataset,
  type FigureId,
  type FigureRecords,
  type IsoDate,
  type RecordCard,
  type RecordRef,
  type WorldEvent,
  type WorldMaster,
  type WorldState,
} from '@ai-erp/domain';
import { buildEvents } from './events';
import { figureRecords } from './figures';
import { buildModel } from './model';
import { recordCard } from './records';
import { takeSnapshot, type Snapshot } from './snapshot';
import { buildState } from './state';

export * from './rules';
export { money, moneyShort } from './format';

export interface Core {
  /** The parts of the world that do not change with the date. */
  master(): WorldMaster;
  /** Pulls a date into the range the dataset can show. */
  clamp(date: IsoDate): IsoDate;
  state(asOf: IsoDate): WorldState;
  record(ref: RecordRef, asOf: IsoDate): RecordCard | null;
  figureRecords(id: FigureId, asOf: IsoDate): FigureRecords;
  /** Events dated from `from` to `to`, both inclusive. */
  events(from: IsoDate, to: IsoDate): WorldEvent[];
}

const CACHE_LIMIT = 400;
/** Every how many days the range is sampled to find the usual queue lengths. */
const TYPICAL_SAMPLE_DAYS = 3;

export function createCore(dataset: Dataset): Core {
  const model = buildModel(dataset);
  const { startDate, endDate } = dataset.meta;
  const snapshots = new Map<IsoDate, Snapshot>();
  const states = new Map<IsoDate, WorldState>();
  let events: WorldEvent[] | null = null;
  let master: WorldMaster | null = null;

  const snapshot = (asOf: IsoDate): Snapshot => {
    let snap = snapshots.get(asOf);
    if (!snap) {
      if (snapshots.size >= CACHE_LIMIT) snapshots.clear();
      snap = takeSnapshot(model, asOf);
      snapshots.set(asOf, snap);
    }
    return snap;
  };

  const stateFor = (asOf: IsoDate): WorldState => {
    let state = states.get(asOf);
    if (!state) {
      if (states.size >= CACHE_LIMIT) states.clear();
      state = buildState(model, snapshot(asOf));
      states.set(asOf, state);
    }
    return state;
  };

  /** The median length of each queue, sampled across the range. */
  const typicalQueue = (): Record<BuildingId, number> => {
    const samples = new Map<BuildingId, number[]>(BUILDING_IDS.map((id) => [id, []]));
    for (let day = startDate; day <= endDate; day = addDays(day, TYPICAL_SAMPLE_DAYS)) {
      for (const building of stateFor(day).buildings) samples.get(building.id)?.push(building.queue.length);
    }
    const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    return Object.fromEntries(BUILDING_IDS.map((id) => [id, median(samples.get(id) ?? [])])) as Record<BuildingId, number>;
  };

  return {
    master() {
      if (!master) {
        const revenue = new Map<string, number>();
        for (const invoice of dataset.salesInvoices) {
          if (invoice.date <= endDate) revenue.set(invoice.customerId, (revenue.get(invoice.customerId) ?? 0) + invoice.net);
        }
        const ranked = [...dataset.customers].sort(
          (a, b) => (revenue.get(b.id) ?? 0) - (revenue.get(a.id) ?? 0) || a.id.localeCompare(b.id),
        );
        const rank = new Map(ranked.map((customer, index) => [customer.id, index + 1]));
        const ordered = new Map<string, number>();
        for (const order of dataset.purchaseOrders) {
          const value = order.lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0);
          ordered.set(order.supplierId, (ordered.get(order.supplierId) ?? 0) + value);
        }
        const supplierRank = new Map(
          [...dataset.suppliers]
            .sort((a, b) => (ordered.get(b.id) ?? 0) - (ordered.get(a.id) ?? 0) || a.id.localeCompare(b.id))
            .map((supplier, index) => [supplier.id, index + 1]),
        );
        master = {
          source: dataset.meta.source,
          range: { start: startDate, end: endDate },
          suppliers: dataset.suppliers.map(({ id, name }) => ({ id, name, rank: supplierRank.get(id) ?? dataset.suppliers.length })),
          customers: dataset.customers.map(({ id, name }) => ({ id, name, rank: rank.get(id) ?? dataset.customers.length })),
          categories: dataset.categories.map(({ id, name }) => ({ id, name })),
          typicalQueue: typicalQueue(),
          simulated: dataset.meta.simulated,
        };
      }
      return master;
    },
    clamp: (date) => clampDate(date, startDate, endDate),
    state: stateFor,
    record: (ref, asOf) => recordCard(model, snapshot(asOf), ref),
    figureRecords: (id, asOf) => figureRecords(model, snapshot(asOf), id),
    events(from, to) {
      events ??= buildEvents(model);
      return events.filter((event) => event.date >= from && event.date <= to);
    },
  };
}
