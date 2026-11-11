/** Isometric projection. Tile size is fixed in docs/BUILD-PLAN.md section 10. */
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

export interface Point {
  x: number;
  y: number;
}

/** A position on the grid. Whole numbers are tile corners; add 0.5 for a tile centre. */
export interface Tile {
  col: number;
  row: number;
}

/** Grid position to screen pixels, relative to the map origin. */
export function tileToScreen(col: number, row: number): Point {
  return {
    x: ((col - row) * TILE_WIDTH) / 2,
    y: ((col + row) * TILE_HEIGHT) / 2,
  };
}

/** Screen pixels back to a fractional grid position. Inverse of tileToScreen. */
export function screenToTile(x: number, y: number): Tile {
  return {
    col: x / TILE_WIDTH + y / TILE_HEIGHT,
    row: y / TILE_HEIGHT - x / TILE_WIDTH,
  };
}

/** Drawing order: things further down the screen are drawn later. */
export function depthOf(col: number, row: number): number {
  return col + row;
}
