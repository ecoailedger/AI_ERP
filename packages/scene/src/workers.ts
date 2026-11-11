/**
 * Workers: the small figures that carry out the work sitting in each building's queue.
 * Every worker is doing a job that a record created. No work, no workers.
 * Where a worker is at any moment is a pure function of the queue and the clock, so replays match.
 */
import { BUILDING_IDS, type BuildingId, type QueueItem, type RecordRef, type TaskKind, type WorldState } from '@ai-erp/domain';
import { dockSlots, lorryBays } from './frame';
import { hashString, hashUnit } from './hash';
import type { Tile } from './iso';
import type { Layout } from './layout';
import { BUILDINGS, DOCK_SLOTS, LOADING_SLOTS, LORRY_BAYS, SPOTS, VAN_BAYS, walkPath } from './settlement';

export type StaffingLevels = Record<BuildingId, { tasksPerWorker: number; maxWorkers: number }>;

/** The least work one worker handles, and how many workers a building can hold. */
export const STAFFING: StaffingLevels = {
  goodsIn: { tasksPerWorker: 2, maxWorkers: 6 },
  warehouse: { tasksPerWorker: 8, maxWorkers: 12 },
  sales: { tasksPerWorker: 10, maxWorkers: 8 },
  accounts: { tasksPerWorker: 6, maxWorkers: 6 },
  dispatch: { tasksPerWorker: 8, maxWorkers: 10 },
};

const WALK_SPEED = 2.4;
const CARRY_SPEED = 1.7;
const PICKUP_SECONDS = 0.6;

export interface WorkerTask {
  key: string;
  building: BuildingId;
  kind: TaskKind;
  ref: RecordRef;
  label: string;
  detail: string;
  flag: QueueItem['flag'];
  from: Tile;
  to: Tile;
  /** Whether the worker carries something between the two ends. */
  carries: boolean;
}

export interface Staffing {
  building: BuildingId;
  workers: number;
  /** Tasks the workers are getting through. */
  tasks: WorkerTask[];
  /** Tasks beyond what the building can handle. Shown as a pile at the door. */
  backlog: number;
}

export type WorkerPhase = 'walk' | 'carry' | 'work';

interface Segment {
  start: number;
  end: number;
  phase: WorkerPhase;
  path: Tile[];
  /** Running distance along the path at each point. */
  distances: number[];
  task: WorkerTask;
}

export interface WorkerSchedule {
  key: string;
  building: BuildingId;
  segments: Segment[];
  duration: number;
  /** Start offset, so workers in a building do not move in step. */
  offset: number;
}

export interface WorkerPose {
  key: string;
  building: BuildingId;
  col: number;
  row: number;
  phase: WorkerPhase;
  /** Direction of travel on screen: -1 left, 1 right. */
  facing: -1 | 1;
  /** 0 to 1 through the current step, for the walk cycle. */
  stride: number;
  task: WorkerTask;
}

const CARRY_KINDS: ReadonlySet<TaskKind> = new Set(['unload', 'putaway', 'pick', 'load', 'match_bill']);

function endpoints(layout: Layout, state: WorldState, building: BuildingId, item: QueueItem): { from: Tile; to: Tile } {
  const pick = <T>(list: readonly T[], id: string): T => list[hashString(id) % list.length] as T;
  const plot = (categoryId: string | null): Tile =>
    (categoryId !== null && layout.plotByCategory.get(categoryId)?.access) || BUILDINGS.warehouse.door;
  const inside = (bay: Tile, dx: number): Tile => ({ col: bay.col + dx, row: bay.row });

  switch (item.kind) {
    case 'unload': {
      const receipt = state.dock.find((pallet) => pallet.receiptId === item.ref.id);
      const bay = LORRY_BAYS[(receipt && lorryBays(state).get(receipt.purchaseOrderId)) ?? hashString(item.ref.id) % LORRY_BAYS.length] as Tile;
      const slot = dockSlots(state).get(item.ref.id);
      return { from: inside(bay, 1), to: slot !== undefined ? (DOCK_SLOTS[slot] as Tile) : pick(DOCK_SLOTS, item.ref.id) };
    }
    case 'putaway': {
      const slot = dockSlots(state).get(item.ref.id);
      return { from: slot !== undefined ? (DOCK_SLOTS[slot] as Tile) : pick(DOCK_SLOTS, item.ref.id), to: plot(item.categoryId) };
    }
    case 'pick':
      return { from: plot(item.categoryId), to: pick(LOADING_SLOTS, item.ref.id) };
    case 'load':
      return { from: pick(LOADING_SLOTS, item.ref.id), to: inside(pick(VAN_BAYS, item.ref.id), -1) };
    case 'enter_order':
      return { from: BUILDINGS.sales.door, to: SPOTS.noticeBoard };
    case 'chase_stock':
      return { from: BUILDINGS.sales.door, to: BUILDINGS.warehouse.door };
    case 'match_bill':
      return { from: SPOTS.postIn, to: BUILDINGS.accounts.door };
    case 'pay_bill':
      return { from: BUILDINGS.accounts.door, to: SPOTS.postIn };
    case 'chase_debt':
      return { from: BUILDINGS.accounts.door, to: SPOTS.debtGate };
    default:
      return { from: BUILDINGS[building].door, to: BUILDINGS[building].door };
  }
}

/** A queue this many times its usual length fills the building. Anything beyond is a backlog. */
const BUSY_FACTOR = 1.5;

/**
 * Staffing sized to the business: a building is full when its queue is well beyond its usual length.
 * So a backlog pile means an unusually busy day, whatever the size of the business.
 */
export function staffingLevels(typicalQueue: Partial<Record<BuildingId, number>>): StaffingLevels {
  return Object.fromEntries(
    BUILDING_IDS.map((building) => {
      const { tasksPerWorker, maxWorkers } = STAFFING[building];
      const scaled = Math.ceil(((typicalQueue[building] ?? 0) * BUSY_FACTOR) / maxWorkers);
      return [building, { tasksPerWorker: Math.max(tasksPerWorker, scaled), maxWorkers }];
    }),
  ) as StaffingLevels;
}

/** How many workers a building puts on a queue of this length, and how many jobs are left over. */
export function headcount(building: BuildingId, jobs: number, levels: StaffingLevels = STAFFING): { workers: number; backlog: number } {
  const { tasksPerWorker, maxWorkers } = levels[building];
  const workers = Math.min(maxWorkers, Math.ceil(jobs / tasksPerWorker));
  return { workers, backlog: Math.max(0, jobs - workers * tasksPerWorker) };
}

/** Turns each building's queue into workers and their tasks. */
export function staffBuildings(layout: Layout, state: WorldState): Staffing[] {
  return BUILDING_IDS.map((building) => {
    const queue = state.buildings.find((candidate) => candidate.id === building)?.queue ?? [];
    const { workers, backlog } = headcount(building, queue.length, layout.staffing);
    const handled = queue.slice(0, queue.length - backlog);
    return {
      building,
      workers,
      backlog,
      tasks: handled.map((item) => ({
        key: `${building}:${item.kind}:${item.ref.id}`,
        building,
        kind: item.kind,
        ref: item.ref,
        label: item.label,
        detail: item.detail,
        flag: item.flag,
        carries: CARRY_KINDS.has(item.kind),
        ...endpoints(layout, state, building, item),
      })),
    };
  });
}

function distancesAlong(path: readonly Tile[]): number[] {
  const distances = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Tile;
    const b = path[i] as Tile;
    distances.push((distances[i - 1] as number) + Math.hypot(b.col - a.col, b.row - a.row));
  }
  return distances;
}

/** Each worker's repeating round: walk to the job, pick up, carry, set down, on to the next. */
export function buildSchedules(staffing: readonly Staffing[]): WorkerSchedule[] {
  const schedules: WorkerSchedule[] = [];
  for (const { building, workers, tasks } of staffing) {
    for (let worker = 0; worker < workers; worker++) {
      const own = tasks.filter((_, index) => index % workers === worker);
      if (own.length === 0) continue;
      const segments: Segment[] = [];
      let clock = 0;
      const add = (phase: WorkerPhase, path: Tile[], seconds: number, task: WorkerTask): void => {
        segments.push({ start: clock, end: clock + seconds, phase, path, distances: distancesAlong(path), task });
        clock += seconds;
      };
      let position = (own[own.length - 1] as WorkerTask).to;
      for (const task of own) {
        const approach = walkPath(position, task.from);
        const haul = walkPath(task.from, task.to);
        const approachLength = distancesAlong(approach).at(-1) ?? 0;
        const haulLength = distancesAlong(haul).at(-1) ?? 0;
        if (approachLength > 0) add('walk', approach, approachLength / WALK_SPEED, task);
        add('work', [task.from], PICKUP_SECONDS, task);
        if (haulLength > 0) add(task.carries ? 'carry' : 'walk', haul, haulLength / (task.carries ? CARRY_SPEED : WALK_SPEED), task);
        // How long the job takes at the far end varies by record, and is the same every replay.
        add('work', [task.to], 0.8 + hashUnit(task.key) * 1.4, task);
        position = task.to;
      }
      const key = `${building}:${worker}`;
      schedules.push({ key, building, segments, duration: clock, offset: hashUnit(key) * clock });
    }
  }
  return schedules;
}

/** Where a worker is, `seconds` into the day's work. */
export function workerPose(schedule: WorkerSchedule, seconds: number): WorkerPose {
  const time = (((seconds + schedule.offset) % schedule.duration) + schedule.duration) % schedule.duration;
  const segment = schedule.segments.find((candidate) => time < candidate.end) ?? (schedule.segments.at(-1) as Segment);
  const span = segment.end - segment.start;
  const progress = span > 0 ? (time - segment.start) / span : 0;
  const total = segment.distances.at(-1) ?? 0;
  const target = progress * total;

  let index = 1;
  while (index < segment.path.length - 1 && (segment.distances[index] as number) < target) index++;
  const a = segment.path[Math.max(0, index - 1)] as Tile;
  const b = segment.path[Math.min(index, segment.path.length - 1)] as Tile;
  const startDistance = segment.distances[Math.max(0, index - 1)] ?? 0;
  const stepLength = Math.hypot(b.col - a.col, b.row - a.row);
  const t = stepLength > 0 ? (target - startDistance) / stepLength : 0;
  // On screen, x grows with col and shrinks with row.
  const screenDx = b.col - a.col - (b.row - a.row);

  return {
    key: schedule.key,
    building: schedule.building,
    col: a.col + (b.col - a.col) * t + 0.5,
    row: a.row + (b.row - a.row) * t + 0.5,
    phase: segment.phase,
    facing: screenDx < 0 ? -1 : 1,
    stride: segment.phase === 'work' ? progress : (target * 1.6) % 1,
    task: segment.task,
  };
}
