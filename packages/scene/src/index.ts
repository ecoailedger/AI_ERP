/**
 * Scene: turns world state into a scene description (layout, placement, task queues).
 * Pure functions, no rendering and no business outcomes. World generation arrives in milestone 1.5.
 */

/** Isometric tile size in pixels (2:1), fixed in docs/BUILD-PLAN.md section 10. */
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

export interface Point {
  x: number;
  y: number;
}

export interface TileCoord {
  col: number;
  row: number;
}

/** Grid tile (col, row) to screen pixels, relative to the map origin. */
export function tileToScreen(col: number, row: number): Point {
  return {
    x: ((col - row) * TILE_WIDTH) / 2,
    y: ((col + row) * TILE_HEIGHT) / 2,
  };
}

/** Screen pixels back to fractional grid coordinates. Inverse of tileToScreen. */
export function screenToTile(x: number, y: number): TileCoord {
  return {
    col: x / TILE_WIDTH + y / TILE_HEIGHT,
    row: y / TILE_HEIGHT - x / TILE_WIDTH,
  };
}
