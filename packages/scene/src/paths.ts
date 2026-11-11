/** Polylines on the grid: lengths, and the point a given distance along. */
import type { Tile } from './iso';

/** Travel direction along a grid axis: +col, -col, +row, -row. */
export type Heading = 'pc' | 'nc' | 'pr' | 'nr';

export interface PathPoint extends Tile {
  heading: Heading;
}

export function headingOf(from: Tile, to: Tile, fallback: Heading = 'pc'): Heading {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (dc === 0 && dr === 0) return fallback;
  if (Math.abs(dc) >= Math.abs(dr)) return dc >= 0 ? 'pc' : 'nc';
  return dr >= 0 ? 'pr' : 'nr';
}

export function pathLength(points: readonly Tile[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Tile;
    const b = points[i] as Tile;
    length += Math.hypot(b.col - a.col, b.row - a.row);
  }
  return length;
}

/** The point `distance` along the path, clamped to its ends. */
export function pointAlong(points: readonly Tile[], distance: number): PathPoint {
  const first = points[0];
  if (!first) throw new Error('pointAlong needs at least one point');
  let remaining = Math.max(0, distance);
  let heading: Heading = 'pc';
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Tile;
    const b = points[i] as Tile;
    const segment = Math.hypot(b.col - a.col, b.row - a.row);
    if (segment === 0) continue;
    heading = headingOf(a, b, heading);
    if (remaining <= segment) {
      const t = remaining / segment;
      return { col: a.col + (b.col - a.col) * t, row: a.row + (b.row - a.row) * t, heading };
    }
    remaining -= segment;
  }
  const last = points[points.length - 1] as Tile;
  return { col: last.col, row: last.row, heading };
}

/** Every whole tile an axis-aligned polyline passes through. */
export function tilesOnPath(points: readonly Tile[]): Tile[] {
  const tiles: Tile[] = [];
  const first = points[0];
  if (!first) return tiles;
  tiles.push({ col: first.col, row: first.row });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Tile;
    const b = points[i] as Tile;
    const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
    for (let s = 1; s <= steps; s++) {
      tiles.push({
        col: a.col + Math.sign(b.col - a.col) * s,
        row: a.row + Math.sign(b.row - a.row) * s,
      });
    }
  }
  return tiles;
}
