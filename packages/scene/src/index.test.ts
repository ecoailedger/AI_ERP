import type { PurchaseOrderState, QueueItem, WorldMaster, WorldState } from '@ai-erp/domain';
import { describe, expect, it } from 'vitest';
import {
  buildFrame,
  buildLayout,
  buildSchedules,
  BUILDINGS,
  findPath,
  GATES,
  hashUnit,
  MAP_SIZE,
  pathLength,
  perimeterRoute,
  pointAlong,
  screenToTile,
  SETTLEMENT_ORIGIN,
  SETTLEMENT_SIZE,
  staffBuildings,
  STAFFING,
  STALLED_SLOTS,
  tileToScreen,
  TRUNK,
  WALK_GRID,
  walkPath,
  workerPose,
  type WalkGrid,
} from './index';

function master(supplierCount = 25, customerCount = 120): WorldMaster {
  return {
    source: 'test',
    range: { start: '2026-08-03', end: '2026-10-31' },
    suppliers: Array.from({ length: supplierCount }, (_, i) => ({ id: `SUP${String(i + 1).padStart(3, '0')}`, name: `Supplier ${i + 1}` })),
    customers: Array.from({ length: customerCount }, (_, i) => ({ id: `CUS${String(i + 1).padStart(4, '0')}`, name: `Customer ${i + 1}`, rank: i + 1 })),
    categories: Array.from({ length: 12 }, (_, i) => ({ id: `CAT${String(i + 1).padStart(2, '0')}`, name: `Category ${i + 1}` })),
    simulated: [],
  };
}

function order(id: string, patch: Partial<PurchaseOrderState> = {}): PurchaseOrderState {
  return {
    id,
    supplierId: 'SUP001',
    orderDate: '2026-09-01',
    dueDate: '2026-09-21',
    originalDueDate: '2026-09-21',
    status: 'in_transit',
    late: false,
    daysLate: 0,
    unacknowledged: false,
    arrivingToday: false,
    qtyOutstanding: 10,
    value: 100,
    lineCount: 1,
    ...patch,
  };
}

function state(patch: Partial<WorldState> = {}): WorldState {
  const base = master();
  return {
    asOf: '2026-09-11',
    figures: [],
    suppliers: base.suppliers.map((s) => ({ ...s, openPoCount: 0, latePoCount: 0, openPoValue: 0, worstDaysLate: 0 })),
    customers: base.customers.map((c) => ({
      id: c.id,
      name: c.name,
      revenue: 1000 / c.rank,
      balance: 0,
      creditLimit: 1000,
      onStop: false,
      overLimit: false,
      openOrderCount: 0,
    })),
    purchaseOrders: [],
    dock: [],
    stockpiles: base.categories.map((c, i) => ({
      categoryId: c.id,
      name: c.name,
      qty: 10,
      value: (i + 1) * 1000,
      productCount: 5,
      ageBand: 0,
      agedValue: 0,
      untrusted: false,
    })),
    salesOrders: [],
    paymentsIn: [],
    billsIn: [],
    buildings: [
      { id: 'goodsIn', label: 'Goods-in', queue: [] },
      { id: 'warehouse', label: 'Warehouse', queue: [] },
      { id: 'sales', label: 'Sales office', queue: [] },
      { id: 'accounts', label: 'Accounts', queue: [] },
      { id: 'dispatch', label: 'Dispatch', queue: [] },
    ],
    alerts: [],
    fog: [],
    ...patch,
  };
}

const pick = (id: string): QueueItem => ({
  kind: 'pick',
  ref: { type: 'salesOrder', id },
  label: `Picking ${id}`,
  detail: 'Customer',
  value: 10,
  ageDays: 0,
  flag: 'ok',
  categoryId: 'CAT03',
  partyId: 'CUS0001',
});

describe('iso projection', () => {
  it('round-trips tile to screen and back', () => {
    const { x, y } = tileToScreen(7.5, 3.25);
    expect(screenToTile(x, y)).toEqual({ col: 7.5, row: 3.25 });
    expect(tileToScreen(1, 0)).toEqual({ x: 32, y: 16 });
  });
});

describe('paths', () => {
  it('finds the point a distance along a polyline', () => {
    const path = [
      { col: 0, row: 0 },
      { col: 4, row: 0 },
      { col: 4, row: 3 },
    ];
    expect(pathLength(path)).toBe(7);
    expect(pointAlong(path, 2)).toEqual({ col: 2, row: 0, heading: 'pc' });
    expect(pointAlong(path, 5)).toEqual({ col: 4, row: 1, heading: 'pr' });
    expect(pointAlong(path, 99)).toMatchObject({ col: 4, row: 3 });
  });

  it('takes the shorter way round the perimeter road', () => {
    const route = perimeterRoute(GATES.N, GATES.W);
    expect(route[0]).toEqual(GATES.N);
    expect(route.at(-1)).toEqual(GATES.W);
    expect(pathLength(route)).toBe(30);
    expect(pathLength(perimeterRoute(GATES.W, GATES.N))).toBe(30);
    expect(pathLength(perimeterRoute(GATES.N, GATES.S))).toBe(57);
  });
});

describe('pathfinding', () => {
  const wall: WalkGrid = { width: 5, height: 5, walkable: (col, row) => !(col === 2 && row < 4) };

  it('walks round a wall without cutting its corner', () => {
    const path = findPath(wall, { col: 0, row: 0 }, { col: 4, row: 0 });
    expect(path?.[0]).toEqual({ col: 0, row: 0 });
    expect(path?.at(-1)).toEqual({ col: 4, row: 0 });
    expect(path?.every((tile) => wall.walkable(tile.col, tile.row))).toBe(true);
    expect(path).toContainEqual({ col: 2, row: 4 });
  });

  it('returns null when there is no way through', () => {
    const sealed: WalkGrid = { width: 5, height: 5, walkable: (col) => col !== 2 };
    expect(findPath(sealed, { col: 0, row: 0 }, { col: 4, row: 0 })).toBeNull();
  });

  it('routes workers between every building door without crossing a building', () => {
    const doors = Object.values(BUILDINGS).map((building) => building.door);
    for (const from of doors) {
      for (const to of doors) {
        const path = walkPath(from, to);
        expect(path.every((tile) => WALK_GRID.walkable(tile.col, tile.row))).toBe(true);
        expect(path.at(-1)).toEqual(to);
      }
    }
  });
});

describe('layout', () => {
  const layout = buildLayout(master());

  it('is the same every time', () => {
    expect(buildLayout(master())).toEqual(layout);
  });

  it('places every supplier and customer, inside the map and outside the settlement', () => {
    expect(layout.ports).toHaveLength(25);
    expect(layout.villages).toHaveLength(36);
    expect(layout.homeByCustomer.size).toBe(120);
    expect(layout.hamlets.reduce((sum, hamlet) => sum + hamlet.customerIds.length, 0)).toBe(84);
    for (const place of [...layout.ports, ...layout.villages, ...layout.hamlets]) {
      const { col, row } = place.tile;
      expect(col).toBeGreaterThanOrEqual(3);
      expect(col).toBeLessThan(MAP_SIZE - 3);
      expect(row).toBeGreaterThanOrEqual(3);
      expect(row).toBeLessThan(MAP_SIZE - 3);
      const clear =
        col < SETTLEMENT_ORIGIN - 3 ||
        col >= SETTLEMENT_ORIGIN + SETTLEMENT_SIZE + 3 ||
        row < SETTLEMENT_ORIGIN - 3 ||
        row >= SETTLEMENT_ORIGIN + SETTLEMENT_SIZE + 3;
      expect(clear).toBe(true);
    }
  });

  it('keeps places apart and off the trunk roads', () => {
    const places = [...layout.ports, ...layout.villages, ...layout.hamlets];
    for (const [i, a] of places.entries()) {
      expect(Math.abs(a.tile.col - TRUNK) >= 3 && Math.abs(a.tile.row - TRUNK) >= 3).toBe(true);
      for (const b of places.slice(i + 1)) {
        expect(Math.hypot(a.tile.col - b.tile.col, a.tile.row - b.tile.row)).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('runs every road from its place to a settlement gate', () => {
    for (const place of [...layout.ports, ...layout.villages, ...layout.hamlets]) {
      expect(place.road[0]).toEqual(place.tile);
      expect(place.road.at(-1)).toEqual(GATES[place.gate]);
    }
  });

  it('does not move anything when a supplier is added', () => {
    const bigger = buildLayout(master(26));
    expect(bigger.ports.slice(0, 25)).toEqual(layout.ports);
    expect(bigger.villages).toEqual(layout.villages);
    expect(bigger.ports).toHaveLength(26);
  });

  it('gives bigger customers the inner ring', () => {
    const distance = (customerId: string): number => {
      const village = layout.villages.find((candidate) => candidate.customerId === customerId);
      return Math.hypot((village?.tile.col ?? 0) - TRUNK, (village?.tile.row ?? 0) - TRUNK);
    };
    expect(distance('CUS0001')).toBeLessThan(distance('CUS0015'));
    expect(distance('CUS0015')).toBeLessThan(distance('CUS0030'));
  });
});

describe('frame', () => {
  const layout = buildLayout(master());

  it('queues late lorries oldest first, and leaves unconfirmed orders at the port', () => {
    const frame = buildFrame(
      layout,
      state({
        purchaseOrders: [
          order('PO3', { late: true, daysLate: 2, dueDate: '2026-09-09' }),
          order('PO1', { late: true, daysLate: 9, dueDate: '2026-09-02' }),
          order('PO2', { late: true, daysLate: 20, dueDate: '2026-08-22', status: 'raised', unacknowledged: true }),
        ],
      }),
      0.5,
    );
    const stalled = frame.vehicles.filter((vehicle) => vehicle.state === 'stalled');
    expect(stalled.map((vehicle) => vehicle.refs[0]?.id)).toEqual(['PO1', 'PO3']);
    expect(stalled[0]).toMatchObject({ col: (STALLED_SLOTS[0]?.col ?? 0) + 0.5, late: true, daysLate: 9 });
    const waiting = frame.vehicles.filter((vehicle) => vehicle.state === 'waiting');
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.refs[0]?.id).toBe('PO2');
  });

  it('moves a lorry along its road as the due date nears', () => {
    const port = layout.portBySupplier.get('SUP001');
    const distanceToGate = (asOf: string, fraction: number): number => {
      const frame = buildFrame(layout, state({ asOf, purchaseOrders: [order('PO1')] }), fraction);
      const lorry = frame.vehicles[0];
      const gate = GATES[port?.gate ?? 'N'];
      return Math.abs((lorry?.col ?? 0) - gate.col) + Math.abs((lorry?.row ?? 0) - gate.row);
    };
    expect(distanceToGate('2026-09-05', 0)).toBeGreaterThan(distanceToGate('2026-09-05', 0.9));
    expect(distanceToGate('2026-09-05', 0.9)).toBeGreaterThan(distanceToGate('2026-09-15', 0));
  });

  it('groups orders from one supplier due the same day into a convoy', () => {
    const frame = buildFrame(layout, state({ purchaseOrders: [order('PO1'), order('PO2'), order('PO3', { dueDate: '2026-09-25' })] }), 0.5);
    expect(frame.vehicles.map((vehicle) => vehicle.refs.length).sort()).toEqual([1, 2]);
  });

  it('sizes stockpiles by value and fogs untrusted ones', () => {
    const frame = buildFrame(layout, state({ fog: [{ scope: 'category', id: 'CAT02', reason: 'Negative stock' }] }), 0.5);
    expect(frame.piles.at(-1)?.crates).toBe(12);
    expect(frame.piles[0]?.crates).toBe(1);
    expect(frame.piles.find((pile) => pile.categoryId === 'CAT02')).toMatchObject({ fogged: true, fogReason: 'Negative stock' });
  });

  it('is the same for the same state and time', () => {
    const world = state({ purchaseOrders: [order('PO1'), order('PO2', { late: true, daysLate: 3 })] });
    expect(buildFrame(layout, world, 0.37)).toEqual(buildFrame(layout, world, 0.37));
  });
});

describe('workers', () => {
  const layout = buildLayout(master());
  const withPicks = (count: number): WorldState => {
    const world = state();
    const warehouse = world.buildings.find((building) => building.id === 'warehouse');
    if (warehouse) warehouse.queue = Array.from({ length: count }, (_, i) => pick(`SO${i + 1}`));
    return world;
  };

  it('puts no workers in a building with no work', () => {
    const staffing = staffBuildings(layout, state());
    expect(staffing.every((entry) => entry.workers === 0 && entry.backlog === 0)).toBe(true);
    expect(buildSchedules(staffing)).toEqual([]);
  });

  it('staffs a building in line with its workload', () => {
    const { tasksPerWorker } = STAFFING.warehouse;
    const staffed = (count: number) => staffBuildings(layout, withPicks(count)).find((entry) => entry.building === 'warehouse');
    expect(staffed(1)?.workers).toBe(1);
    expect(staffed(tasksPerWorker + 1)?.workers).toBe(2);
    expect(staffed(tasksPerWorker * 3)?.workers).toBe(3);
  });

  it('turns work beyond capacity into a backlog', () => {
    const { tasksPerWorker, maxWorkers } = STAFFING.warehouse;
    const capacity = tasksPerWorker * maxWorkers;
    const staffed = staffBuildings(layout, withPicks(capacity + 7)).find((entry) => entry.building === 'warehouse');
    expect(staffed).toMatchObject({ workers: maxWorkers, backlog: 7 });
    expect(staffed?.tasks).toHaveLength(capacity);
  });

  it('gives every worker a job that names a record', () => {
    const schedules = buildSchedules(staffBuildings(layout, withPicks(20)));
    expect(schedules).toHaveLength(3);
    for (const schedule of schedules) {
      for (const seconds of [0, 3.3, 17, 120]) {
        const pose = workerPose(schedule, seconds);
        expect(pose.task.ref.type).toBe('salesOrder');
        expect(pose.task.label).toMatch(/^Picking SO\d+$/);
        expect(WALK_GRID.walkable(Math.floor(pose.col), Math.floor(pose.row))).toBe(true);
      }
    }
  });

  it('puts a worker in the same place at the same moment, every time', () => {
    const first = buildSchedules(staffBuildings(layout, withPicks(20)));
    const second = buildSchedules(staffBuildings(layout, withPicks(20)));
    for (const [i, schedule] of first.entries()) {
      expect(workerPose(schedule, 42.5)).toEqual(workerPose(second[i] ?? schedule, 42.5));
    }
  });

  it('keeps workers in a building out of step with each other', () => {
    const schedules = buildSchedules(staffBuildings(layout, withPicks(20)));
    const offsets = new Set(schedules.map((schedule) => schedule.offset.toFixed(3)));
    expect(offsets.size).toBe(schedules.length);
    expect(hashUnit('warehouse:0')).not.toBe(hashUnit('warehouse:1'));
  });
});
