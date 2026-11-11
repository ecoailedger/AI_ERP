import { describe, expect, it } from 'vitest';
import { screenToTile, tileToScreen } from './index';

describe('iso projection', () => {
  it('puts the origin tile at the origin', () => {
    expect(tileToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('moves right and down along the column axis', () => {
    expect(tileToScreen(1, 0)).toEqual({ x: 32, y: 16 });
  });

  it('round-trips tile to screen and back', () => {
    const { x, y } = tileToScreen(7, 3);
    expect(screenToTile(x, y)).toEqual({ col: 7, row: 3 });
  });
});
