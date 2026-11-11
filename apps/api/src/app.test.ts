import { createCore } from '@ai-erp/core';
import { FIGURE_IDS, type FigureRecords, type RecordCard, type WorldEvent, type WorldMaster, type WorldState } from '@ai-erp/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { DUMMY_DATA_DIR, loadDataset } from './data';

const app = buildApp(createCore(loadDataset(DUMMY_DATA_DIR)));
afterAll(() => app.close());

const get = (url: string) => app.inject({ method: 'GET', url });

describe('api', () => {
  it('answers /health', async () => {
    const response = await get('/health');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', source: 'dummy' });
  });

  it('serves the master data', async () => {
    const master = (await get('/master')).json<WorldMaster>();
    expect(master.range).toEqual({ start: '2026-08-03', end: '2026-10-31' });
    expect(master.suppliers).toHaveLength(25);
    expect(master.customers).toHaveLength(120);
  });

  it('serves the state for a date, defaulting to the latest', async () => {
    const latest = (await get('/state')).json<WorldState>();
    expect(latest.asOf).toBe('2026-10-31');
    const earlier = (await get('/state?at=2026-09-15')).json<WorldState>();
    expect(earlier.asOf).toBe('2026-09-15');
    expect(earlier.figures.map((figure) => figure.id)).toEqual(FIGURE_IDS);
    expect(earlier.buildings).toHaveLength(6);
  });

  it('pulls an out-of-range date into range and rejects a malformed one', async () => {
    expect((await get('/state?at=2030-01-01')).json<WorldState>().asOf).toBe('2026-10-31');
    const bad = await get('/state?at=yesterday');
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: string }>().error).toContain('YYYY-MM-DD');
  });

  it('serves the records behind a figure, and they add up to it', async () => {
    const state = (await get('/state?at=2026-09-15')).json<WorldState>();
    for (const id of FIGURE_IDS) {
      const records = (await get(`/figures/${id}/records?at=2026-09-15`)).json<FigureRecords>();
      const total = Math.round(records.rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
      expect(total, id).toBe(state.figures.find((figure) => figure.id === id)?.value);
    }
    expect((await get('/figures/profit/records')).statusCode).toBe(400);
  });

  it('serves a record card, with 404 for a missing record and 400 for a bad type', async () => {
    const state = (await get('/state')).json<WorldState>();
    const order = state.purchaseOrders[0];
    const card = (await get(`/records/purchaseOrder/${order?.id}`)).json<RecordCard>();
    expect(card.ref).toEqual({ type: 'purchaseOrder', id: order?.id });
    expect(card.source[0]).toMatchObject({ system: 'dummy', entity: 'purchaseOrders' });
    expect((await get('/records/purchaseOrder/PO0')).statusCode).toBe(404);
    expect((await get('/records/spaceship/1')).statusCode).toBe(400);
  });

  it('serves events in a date range', async () => {
    const body = (await get('/events?from=2026-09-14&to=2026-09-15')).json<{ events: WorldEvent[] }>();
    expect(body.events.length).toBeGreaterThan(50);
    expect(body.events.every((event) => event.date >= '2026-09-14' && event.date <= '2026-09-15')).toBe(true);
  });
});
