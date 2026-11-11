/**
 * Whole-world checks: the core's state, turned into a scene, for every day of the dummy data.
 * These hold the drawing to the data: what is on the map must match what the core says.
 */
import { createCore } from '@ai-erp/core';
import { addDays } from '@ai-erp/domain';
import { buildFrame, buildLayout, buildSchedules, staffBuildings, STAFFING, STALLED_SLOTS, workerPose } from '@ai-erp/scene';
import { describe, expect, it } from 'vitest';
import { DUMMY_DATA_DIR, loadDataset } from './data';

const core = createCore(loadDataset(DUMMY_DATA_DIR));
const master = core.master();
const layout = buildLayout(master);
const days: string[] = [];
for (let day = master.range.start; day <= master.range.end; day = addDays(day, 1)) days.push(day);

describe('the world, every day', () => {
  it('queues exactly the late lorries the core reports', () => {
    for (const day of days) {
      const state = core.state(day);
      const frame = buildFrame(layout, state, 0.5);
      const late = state.purchaseOrders.filter((order) => order.late && order.status !== 'raised' && !order.arrivingToday).length;
      const stalled = frame.vehicles.filter((vehicle) => vehicle.state === 'stalled').length;
      expect(stalled + frame.stalledOverflow, day).toBe(late);
      expect(late).toBeLessThanOrEqual(STALLED_SLOTS.length);
    }
  });

  it('puts every open purchase order on the map exactly once', () => {
    for (const day of days) {
      const state = core.state(day);
      const drawn = buildFrame(layout, state, 0.5)
        .vehicles.filter((vehicle) => vehicle.kind === 'lorry')
        .flatMap((vehicle) => vehicle.refs.map((ref) => ref.id))
        .sort();
      expect(drawn, day).toEqual(state.purchaseOrders.map((order) => order.id).sort());
    }
  });

  it('puts every shipped order in a van, and every delivery on the dock', () => {
    for (const day of days) {
      const state = core.state(day);
      const frame = buildFrame(layout, state, 0.5);
      const inVans = frame.vehicles.filter((vehicle) => vehicle.kind === 'van' && vehicle.state === 'moving').flatMap((vehicle) => vehicle.refs).length;
      expect(inVans, day).toBe(state.salesOrders.filter((order) => order.status === 'shipped').length);
      expect(frame.pallets.length + frame.palletOverflow, day).toBe(state.dock.length);
    }
  });

  it('gives every worker a job from a building queue, and no workers to an idle building', () => {
    for (const day of days) {
      const state = core.state(day);
      const staffing = staffBuildings(layout, state);
      for (const entry of staffing) {
        const queue = state.buildings.find((building) => building.id === entry.building)?.queue ?? [];
        expect(entry.tasks.length + entry.backlog, `${entry.building} on ${day}`).toBe(queue.length);
        expect(entry.workers).toBeLessThanOrEqual(STAFFING[entry.building].maxWorkers);
        expect(entry.backlog).toBe(Math.max(0, queue.length - entry.workers * layout.staffing[entry.building].tasksPerWorker));
        if (queue.length === 0) expect(entry.workers).toBe(0);
        const refs = new Set(queue.map((item) => `${item.kind}:${item.ref.id}`));
        for (const task of entry.tasks) expect(refs.has(`${task.kind}:${task.ref.id}`)).toBe(true);
      }
      expect(buildSchedules(staffing).length).toBe(staffing.reduce((sum, entry) => sum + entry.workers, 0));
    }
  });

  it('replays identically: same day and moment, same scene', () => {
    for (const day of [days[0], days[40], days.at(-1)] as string[]) {
      const first = buildFrame(layout, core.state(day), 0.42);
      const second = buildFrame(buildLayout(core.master()), core.state(day), 0.42);
      expect(second).toEqual(first);
      const a = buildSchedules(staffBuildings(layout, core.state(day)));
      const b = buildSchedules(staffBuildings(layout, core.state(day)));
      expect(a.map((schedule) => workerPose(schedule, 73.2))).toEqual(b.map((schedule) => workerPose(schedule, 73.2)));
    }
  });

  it('shows something stuck on most days, so the exceptions can be seen', () => {
    const withLate = days.filter((day) => core.state(day).suppliers.some((supplier) => supplier.latePoCount > 0)).length;
    expect(withLate / days.length).toBeGreaterThan(0.9);
  });
});
