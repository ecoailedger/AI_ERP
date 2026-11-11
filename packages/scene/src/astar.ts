/** A* pathfinding on a small grid, for workers walking around the settlement. */
import type { Tile } from './iso';

export interface WalkGrid {
  width: number;
  height: number;
  /** True where a worker can stand. */
  walkable: (col: number, row: number) => boolean;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Shortest walk between two tiles, as a list of tiles including both ends.
 * Diagonal steps are allowed but never cut a corner. Returns null if there is no way through.
 */
export function findPath(grid: WalkGrid, from: Tile, to: Tile): Tile[] | null {
  const { width, height } = grid;
  const index = (col: number, row: number): number => row * width + col;
  const inside = (col: number, row: number): boolean => col >= 0 && row >= 0 && col < width && row < height;
  if (!inside(from.col, from.row) || !inside(to.col, to.row)) return null;
  if (!grid.walkable(to.col, to.row)) return null;

  const start = index(from.col, from.row);
  const goal = index(to.col, to.row);
  const cost = new Float64Array(width * height).fill(Infinity);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const open: number[] = [start];
  cost[start] = 0;

  const estimate = (i: number): number => {
    const dc = Math.abs((i % width) - to.col);
    const dr = Math.abs(Math.floor(i / width) - to.row);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
  };

  while (open.length > 0) {
    // The grid is small, so a linear scan for the best open tile is fast enough.
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < open.length; i++) {
      const candidate = open[i] as number;
      const score = (cost[candidate] as number) + estimate(candidate);
      if (score < bestScore || (score === bestScore && candidate < (open[best] as number))) {
        best = i;
        bestScore = score;
      }
    }
    const current = open.splice(best, 1)[0] as number;
    if (current === goal) break;
    if (closed[current]) continue;
    closed[current] = 1;
    const col = current % width;
    const row = Math.floor(current / width);

    for (const [dc, dr] of NEIGHBOURS) {
      const nextCol = col + dc;
      const nextRow = row + dr;
      if (!inside(nextCol, nextRow) || !grid.walkable(nextCol, nextRow)) continue;
      if (dc !== 0 && dr !== 0 && (!grid.walkable(col + dc, row) || !grid.walkable(col, row + dr))) continue;
      const next = index(nextCol, nextRow);
      if (closed[next]) continue;
      const nextCost = (cost[current] as number) + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (nextCost < (cost[next] as number)) {
        cost[next] = nextCost;
        cameFrom[next] = current;
        open.push(next);
      }
    }
  }

  if (start !== goal && cameFrom[goal] === -1) return null;
  const path: Tile[] = [];
  for (let i = goal; i !== -1; i = i === start ? -1 : (cameFrom[i] as number)) {
    path.push({ col: i % width, row: Math.floor(i / width) });
  }
  return path.reverse();
}
