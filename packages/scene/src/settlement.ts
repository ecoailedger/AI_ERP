/**
 * The settlement: the company site at the centre of the map.
 * Its footprint is fixed by design, not by data. What happens inside it is drawn from data.
 */
import type { BuildingId } from '@ai-erp/domain';
import { findPath, type WalkGrid } from './astar';
import type { Tile } from './iso';

export const MAP_SIZE = 128;
export const SETTLEMENT_SIZE = 30;
/** Map tile of the settlement's top corner. */
export const SETTLEMENT_ORIGIN = (MAP_SIZE - SETTLEMENT_SIZE) / 2;
/** The col (and row) the four trunk roads run along. */
export const TRUNK = SETTLEMENT_ORIGIN + 15;
const LAST = SETTLEMENT_SIZE - 1;

export interface Rect {
  col: number;
  row: number;
  w: number;
  h: number;
}

/** Settlement-local tile to map tile. */
export const local = (lx: number, ly: number): Tile => ({ col: SETTLEMENT_ORIGIN + lx, row: SETTLEMENT_ORIGIN + ly });
const localRect = (lx: number, ly: number, w: number, h: number): Rect => ({ ...local(lx, ly), w, h });

export interface BuildingPlace {
  id: BuildingId;
  label: string;
  rect: Rect;
  /** Walkable tile outside the door. */
  door: Tile;
  /** Where work that cannot be handled piles up. */
  backlog: Tile;
  /** Wall height in pixels. */
  height: number;
}

export const BUILDINGS: Record<BuildingId, BuildingPlace> = {
  goodsIn: { id: 'goodsIn', label: 'Goods-in', rect: localRect(3, 3, 6, 5), door: local(6, 8), backlog: local(9, 7), height: 34 },
  warehouse: { id: 'warehouse', label: 'Warehouse', rect: localRect(12, 3, 7, 6), door: local(15, 9), backlog: local(19, 8), height: 46 },
  dispatch: { id: 'dispatch', label: 'Dispatch', rect: localRect(22, 3, 6, 5), door: local(24, 8), backlog: local(21, 7), height: 34 },
  sales: { id: 'sales', label: 'Sales office', rect: localRect(3, 21, 6, 5), door: local(6, 20), backlog: local(9, 21), height: 40 },
  accounts: { id: 'accounts', label: 'Accounts', rect: localRect(22, 21, 6, 5), door: local(24, 20), backlog: local(21, 21), height: 40 },
};

/** Where delivered pallets wait: 18 slots beside goods-in. */
export const DOCK: Rect = localRect(3, 9, 6, 3);
/** Where picked orders wait for a van. */
export const LOADING: Rect = localRect(22, 9, 6, 3);

export function rectTiles(rect: Rect): Tile[] {
  const tiles: Tile[] = [];
  for (let row = rect.row; row < rect.row + rect.h; row++) {
    for (let col = rect.col; col < rect.col + rect.w; col++) tiles.push({ col, row });
  }
  return tiles;
}

export const DOCK_SLOTS = rectTiles(DOCK);
export const LOADING_SLOTS = rectTiles(LOADING);

const BAY_ROWS = [4, 6, 8, 10, 12, 18, 20, 22, 24, 26];
/** Lorries unload on the west side of the perimeter road. */
export const LORRY_BAYS = BAY_ROWS.map((ly) => local(0, ly));
/** Vans load on the east side. */
export const VAN_BAYS = BAY_ROWS.map((ly) => local(LAST, ly));

export type GateId = 'N' | 'E' | 'S' | 'W';
export const GATES: Record<GateId, Tile> = {
  N: local(15, 0),
  E: local(LAST, 15),
  S: local(15, LAST),
  W: local(0, 15),
};

/** Late lorries queue here, outside the west side, oldest first. */
export const STALLED_SLOTS: Tile[] = [-3, -5].flatMap((lx) =>
  Array.from({ length: 26 }, (_, i) => i + 2)
    .filter((ly) => ly < 13 || ly > 17)
    .map((ly) => local(lx, ly)),
);

/** The yard: one 2x2 plot per product category, in a 4 by 3 grid. */
export const PLOT_COUNT = 12;
export function plotRect(index: number): Rect {
  return localRect(10 + (index % 4) * 3, 11 + Math.floor(index / 4) * 3, 2, 2);
}
/** Where a worker stands to reach a plot. */
export function plotAccess(index: number): Tile {
  const rect = plotRect(index);
  return { col: rect.col, row: rect.row + 2 };
}
export const YARD: Rect = localRect(9, 10, 13, 10);

/** Fixed spots workers walk to. */
export const SPOTS = {
  noticeBoard: local(10, 21),
  postIn: local(15, LAST - 1),
  debtGate: local(LAST - 1, 15),
} as const;

const inRect = (rect: Rect, col: number, row: number): boolean =>
  col >= rect.col && col < rect.col + rect.w && row >= rect.row && row < rect.row + rect.h;

const BLOCKED: Rect[] = [
  ...Object.values(BUILDINGS).map((building) => building.rect),
  ...Array.from({ length: PLOT_COUNT }, (_, index) => plotRect(index)),
];

export function insideSettlement(col: number, row: number): boolean {
  return inRect({ col: SETTLEMENT_ORIGIN, row: SETTLEMENT_ORIGIN, w: SETTLEMENT_SIZE, h: SETTLEMENT_SIZE }, col, row);
}

export function isPerimeterRoad(col: number, row: number): boolean {
  if (!insideSettlement(col, row)) return false;
  const lx = col - SETTLEMENT_ORIGIN;
  const ly = row - SETTLEMENT_ORIGIN;
  return lx === 0 || ly === 0 || lx === LAST || ly === LAST;
}

/** Workers can walk anywhere in the settlement that is not a building or a stock plot. */
export const WALK_GRID: WalkGrid = {
  width: MAP_SIZE,
  height: MAP_SIZE,
  walkable: (col, row) => insideSettlement(col, row) && !BLOCKED.some((rect) => inRect(rect, col, row)),
};

const walkCache = new Map<string, Tile[]>();

/** A worker's route between two settlement tiles. Falls back to a straight line if blocked. */
export function walkPath(from: Tile, to: Tile): Tile[] {
  const key = `${from.col},${from.row}>${to.col},${to.row}`;
  let path = walkCache.get(key);
  if (!path) {
    path = findPath(WALK_GRID, from, to) ?? [from, to];
    walkCache.set(key, path);
  }
  return path;
}

/** Distance clockwise round the perimeter road from the top corner. */
function perimeterDistance(tile: Tile): number {
  const lx = tile.col - SETTLEMENT_ORIGIN;
  const ly = tile.row - SETTLEMENT_ORIGIN;
  if (ly === 0) return lx;
  if (lx === LAST) return LAST + ly;
  if (ly === LAST) return 2 * LAST + (LAST - lx);
  return 3 * LAST + (LAST - ly);
}

function perimeterTile(distance: number): Tile {
  const d = ((distance % (4 * LAST)) + 4 * LAST) % (4 * LAST);
  if (d <= LAST) return local(d, 0);
  if (d <= 2 * LAST) return local(LAST, d - LAST);
  if (d <= 3 * LAST) return local(LAST - (d - 2 * LAST), LAST);
  return local(0, LAST - (d - 3 * LAST));
}

/** The shorter way round the perimeter road between two tiles on it, as a polyline. */
export function perimeterRoute(from: Tile, to: Tile): Tile[] {
  const loop = 4 * LAST;
  const start = perimeterDistance(from);
  const end = perimeterDistance(to);
  const clockwise = (((end - start) % loop) + loop) % loop;
  const direction = clockwise <= loop / 2 ? 1 : -1;
  const length = direction === 1 ? clockwise : loop - clockwise;
  const points: Tile[] = [from];
  for (let step = 1; step < length; step++) {
    const distance = start + direction * step;
    // Only corners change direction, so only corners need a point.
    if ((((distance % LAST) + LAST) % LAST) === 0) points.push(perimeterTile(distance));
  }
  if (length > 0) points.push(to);
  return points;
}
