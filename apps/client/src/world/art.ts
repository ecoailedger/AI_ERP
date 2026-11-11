/**
 * The world's art, drawn in code as isometric shapes and baked into textures.
 * All of it is original. Nothing here is copied from, or modelled on, any published game.
 */
import type { BuildingId } from '@ai-erp/domain';
import { TILE_HEIGHT, TILE_WIDTH, type BuildingPlace, type Heading } from '@ai-erp/scene';
import { Graphics, type Renderer, type Texture } from 'pixi.js';
import { BUILDING_COLOURS, mix, PALETTE, shade, WORKER_COLOURS } from './palette';

export interface Tex {
  texture: Texture;
  /** Anchor that puts the drawing's origin on the sprite's position. */
  ax: number;
  ay: number;
}

type Corner = readonly [col: number, row: number, z?: number];

const sx = (col: number, row: number): number => ((col - row) * TILE_WIDTH) / 2;
const sy = (col: number, row: number, z = 0): number => ((col + row) * TILE_HEIGHT) / 2 - z;

/** A filled polygon through grid corners, each with an optional height in pixels. */
export function face(g: Graphics, corners: readonly Corner[], colour: number, alpha = 1): void {
  g.poly(corners.flatMap(([col, row, z]) => [sx(col, row), sy(col, row, z)])).fill({ color: colour, alpha });
}

/** An upright box on the grid. Lit from the left: top brightest, right side darkest. */
export function box(g: Graphics, col: number, row: number, w: number, h: number, z0: number, height: number, colour: number): void {
  const top = z0 + height;
  face(g, [[col, row + h, top], [col + w, row + h, top], [col + w, row + h, z0], [col, row + h, z0]], shade(colour, 0.84));
  face(g, [[col + w, row + h, top], [col + w, row, top], [col + w, row, z0], [col + w, row + h, z0]], shade(colour, 0.66));
  face(g, [[col, row, top], [col + w, row, top], [col + w, row + h, top], [col, row + h, top]], colour);
}

/** A pitched roof with its ridge running along the col axis. */
function gableRoof(g: Graphics, col: number, row: number, w: number, h: number, z: number, rise: number, colour: number, wall: number): void {
  const mid = row + h / 2;
  face(g, [[col, row, z], [col + w, row, z], [col + w, mid, z + rise], [col, mid, z + rise]], shade(colour, 0.72));
  face(g, [[col + w, row + h, z], [col + w, row, z], [col + w, mid, z + rise]], shade(wall, 0.66));
  face(g, [[col, row + h, z], [col + w, row + h, z], [col + w, mid, z + rise], [col, mid, z + rise]], colour);
}

function shadow(g: Graphics, col: number, row: number, w: number, h: number, alpha = 0.22): void {
  face(g, [[col, row], [col + w, row], [col + w, row + h], [col, row + h]], PALETTE.shadow, alpha);
}

/** Small marks scattered over a face, placed by a fixed pattern so the same thing always looks the same. */
function specks(g: Graphics, col: number, row: number, w: number, h: number, z: number, count: number, colour: number, size = 1.3): void {
  for (let i = 0; i < count; i++) {
    const u = (i * 0.618 + 0.13) % 1;
    const v = (i * 0.377 + 0.41) % 1;
    g.circle(sx(col + u * w, row + v * h), sy(col + u * w, row + v * h, z), size).fill({ color: colour, alpha: 0.9 });
  }
}

/** Draws a building straight onto the map. Buildings never move, so they need no texture. */
export function drawBuilding(g: Graphics, place: BuildingPlace): void {
  const { col, row, w, h } = place.rect;
  const { wall, roof, trim } = BUILDING_COLOURS[place.id];
  const z = place.height;
  shadow(g, col + 0.3, row + 0.3, w + 0.5, h + 0.5);
  box(g, col, row, w, h, 0, z, wall);

  // Windows along both visible walls.
  for (let c = col + 0.7; c < col + w - 0.9; c += 1.25) {
    if (Math.abs(c - (place.door.col + 0.1)) < 0.9 && place.door.row >= row + h) continue;
    face(g, [[c, row + h, z * 0.72], [c + 0.6, row + h, z * 0.72], [c + 0.6, row + h, z * 0.38], [c, row + h, z * 0.38]], PALETTE.glass);
  }
  for (let r = row + 0.7; r < row + h - 0.9; r += 1.25) {
    face(g, [[col + w, r + 0.6, z * 0.72], [col + w, r, z * 0.72], [col + w, r, z * 0.38], [col + w, r + 0.6, z * 0.38]], shade(PALETTE.glass, 0.78));
  }
  // A door shows only where it faces the viewer. Sales and accounts open onto the yard behind them.
  if (place.door.row >= row + h) {
    const c = place.door.col;
    face(g, [[c, row + h, z * 0.6], [c + 1, row + h, z * 0.6], [c + 1, row + h, 0], [c, row + h, 0]], trim);
  }

  if (place.id === 'warehouse') {
    box(g, col - 0.15, row - 0.15, w + 0.3, h + 0.3, z, 4, roof);
    for (let c = col + 1; c < col + w - 1.5; c += 2.2) box(g, c, row + h / 2 - 0.6, 1.3, 1.2, z + 4, 5, PALETTE.glass);
  } else {
    gableRoof(g, col - 0.2, row - 0.2, w + 0.4, h + 0.4, z, 20, roof, wall);
    box(g, col + w - 1.4, row + 0.8, 0.5, 0.5, z + 8, 14, shade(wall, 0.8));
  }
  // A coloured band at the base, so each function is recognisable from a distance.
  face(g, [[col, row + h, 5], [col + w, row + h, 5], [col + w, row + h, 0], [col, row + h, 0]], trim);
  face(g, [[col + w, row + h, 5], [col + w, row, 5], [col + w, row, 0], [col + w, row + h, 0]], shade(trim, 0.8));
}

interface Part {
  from: number;
  to: number;
  halfWidth: number;
  z0: number;
  height: number;
  colour: number;
}

/** Draws box parts laid out along a vehicle's direction of travel, back to front. */
function alongHeading(g: Graphics, heading: Heading, parts: readonly Part[]): void {
  const onCol = heading === 'pc' || heading === 'nc';
  const sign = heading === 'pc' || heading === 'pr' ? 1 : -1;
  const placed = parts.map((part) => {
    const a = Math.min(part.from * sign, part.to * sign);
    const length = Math.abs(part.to - part.from);
    return onCol
      ? { part, col: a, row: -part.halfWidth, w: length, h: part.halfWidth * 2 }
      : { part, col: -part.halfWidth, row: a, w: part.halfWidth * 2, h: length };
  });
  placed.sort((p, q) => p.col + p.row + p.part.z0 * 0.001 - (q.col + q.row + q.part.z0 * 0.001));
  for (const { part, col, row, w, h } of placed) box(g, col, row, w, h, part.z0, part.height, part.colour);
}

function wheels(g: Graphics, heading: Heading, positions: readonly number[], halfWidth: number): void {
  const onCol = heading === 'pc' || heading === 'nc';
  for (const position of positions) {
    for (const side of [-halfWidth, halfWidth]) {
      const col = onCol ? position : side;
      const row = onCol ? side : position;
      g.ellipse(sx(col, row), sy(col, row, 2), 3.4, 2.6).fill(PALETTE.tyre);
    }
  }
}

export class Art {
  private readonly cache = new Map<string, Tex>();

  constructor(private readonly renderer: Renderer) {}

  private make(key: string, draw: (g: Graphics) => void): Tex {
    let tex = this.cache.get(key);
    if (!tex) {
      const g = new Graphics();
      draw(g);
      const bounds = g.getLocalBounds();
      const texture = this.renderer.generateTexture({ target: g, resolution: 2, antialias: true });
      tex = { texture, ax: -bounds.x / Math.max(1, bounds.width), ay: -bounds.y / Math.max(1, bounds.height) };
      g.destroy();
      this.cache.set(key, tex);
    }
    return tex;
  }

  lorry(heading: Heading, colour: number): Tex {
    return this.make(`lorry:${heading}:${colour}`, (g) => {
      const onCol = heading === 'pc' || heading === 'nc';
      shadow(g, onCol ? -0.7 : -0.26, onCol ? -0.26 : -0.7, onCol ? 1.3 : 0.52, onCol ? 0.52 : 1.3, 0.28);
      wheels(g, heading, [-0.48, -0.2, 0.36].map((p) => p * (heading === 'pc' || heading === 'pr' ? 1 : -1)), 0.21);
      alongHeading(g, heading, [
        { from: -0.64, to: 0.12, halfWidth: 0.21, z0: 4, height: 16, colour },
        { from: -0.64, to: 0.12, halfWidth: 0.21, z0: 9, height: 3, colour: PALETTE.white },
        { from: 0.17, to: 0.5, halfWidth: 0.2, z0: 4, height: 8, colour: PALETTE.white },
        { from: 0.17, to: 0.5, halfWidth: 0.2, z0: 12, height: 4, colour: PALETTE.glass },
      ]);
    });
  }

  van(heading: Heading, colour: number): Tex {
    return this.make(`van:${heading}:${colour}`, (g) => {
      const onCol = heading === 'pc' || heading === 'nc';
      shadow(g, onCol ? -0.4 : -0.22, onCol ? -0.22 : -0.4, onCol ? 0.8 : 0.44, onCol ? 0.44 : 0.8, 0.28);
      wheels(g, heading, [-0.24, 0.22].map((p) => p * (heading === 'pc' || heading === 'pr' ? 1 : -1)), 0.17);
      alongHeading(g, heading, [
        { from: -0.36, to: 0.1, halfWidth: 0.17, z0: 3, height: 12, colour: PALETTE.white },
        { from: -0.36, to: 0.1, halfWidth: 0.17, z0: 7, height: 3, colour },
        { from: 0.12, to: 0.34, halfWidth: 0.17, z0: 3, height: 6, colour: PALETTE.white },
        { from: 0.12, to: 0.34, halfWidth: 0.17, z0: 9, height: 4, colour: PALETTE.glass },
      ]);
    });
  }

  /** Money on its way in: a handcart carrying a coin. */
  cart(): Tex {
    return this.make('cart', (g) => {
      shadow(g, -0.22, -0.22, 0.44, 0.44, 0.28);
      box(g, -0.18, -0.18, 0.36, 0.36, 2, 6, PALETTE.woodDark);
      g.circle(0, -13, 6).fill(shade(PALETTE.gold, 0.75));
      g.circle(0, -14, 5.2).fill(PALETTE.gold);
      g.rect(-0.8, -17, 1.6, 6).fill(shade(PALETTE.gold, 0.6));
    });
  }

  /** A supplier's bill on its way in: an envelope. */
  letter(): Tex {
    return this.make('letter', (g) => {
      g.ellipse(0, 0, 7, 3).fill({ color: PALETTE.shadow, alpha: 0.28 });
      g.roundRect(-8, -16, 16, 11, 1.5).fill(PALETTE.white).stroke({ color: PALETTE.ink, width: 1, alpha: 0.6 });
      g.moveTo(-8, -16).lineTo(0, -9).lineTo(8, -16).stroke({ color: PALETTE.ink, width: 1, alpha: 0.6 });
      g.circle(5, -8, 1.8).fill(PALETTE.late);
    });
  }

  /** A worker, drawn upright and facing right. Flipped by the renderer when walking left. */
  worker(building: BuildingId, pose: 'walk' | 'carry' | 'work', step: 0 | 1): Tex {
    return this.make(`worker:${building}:${pose}:${step}`, (g) => {
      const tunic = WORKER_COLOURS[building];
      g.ellipse(0, 0.5, 5.5, 2.6).fill({ color: PALETTE.shadow, alpha: 0.3 });
      const stride = pose === 'work' ? 0 : step === 0 ? 1.6 : -1.6;
      g.roundRect(-3 - stride, -6, 2.6, 6, 1).fill(PALETTE.ink);
      g.roundRect(0.4 + stride, -6, 2.6, 6, 1).fill(shade(PALETTE.ink, 1.5));
      g.roundRect(-4.2, -15, 8.4, 10, 2.4).fill(tunic);
      g.roundRect(-4.2, -9, 8.4, 2, 0.8).fill(shade(tunic, 0.7));
      if (pose === 'carry') {
        g.roundRect(2.5, -15 - step, 7.5, 7, 1).fill(PALETTE.wood).stroke({ color: PALETTE.woodDark, width: 1 });
        g.roundRect(0.5, -13.5, 4, 2.2, 1).fill(PALETTE.skin);
      } else if (pose === 'work') {
        const lift = step === 0 ? -19 : -16;
        g.roundRect(3.2, lift, 2.2, 7, 1).fill(PALETTE.skin);
        g.roundRect(-5.4, -14, 2.2, 6, 1).fill(PALETTE.skin);
      } else {
        g.roundRect(-5.6 + stride * 0.5, -14, 2.2, 6.5, 1).fill(PALETTE.skin);
        g.roundRect(3.4 - stride * 0.5, -14, 2.2, 6.5, 1).fill(PALETTE.skin);
      }
      g.circle(0, -18.5, 3.6).fill(PALETTE.skin);
      g.roundRect(-4, -23, 8, 3.4, 1.4).fill(shade(tunic, 0.72));
      g.rect(-4.6, -20.4, 9.6, 1.3).fill(shade(tunic, 0.55));
    });
  }

  /** A stockpile on a 2x2 plot: more crates for more value, weathering as it ages. */
  pile(crates: number, ageBand: 0 | 1 | 2 | 3, colour: number): Tex {
    return this.make(`pile:${crates}:${ageBand}:${colour}`, (g) => {
      // Dust dulls the wood from band 1; moss takes over by band 3.
      const dull = [0, 0.3, 0.42, 0.5][ageBand] as number;
      const base = ageBand === 3 ? mix(mix(PALETTE.wood, PALETTE.dust, dull), PALETTE.moss, 0.22) : mix(PALETTE.wood, PALETTE.dust, dull);
      const spots = [
        [0.08, 0.08],
        [1.06, 0.08],
        [0.08, 1.06],
        [1.06, 1.06],
      ] as const;
      for (let i = 0; i < crates; i++) {
        const [col, row] = spots[i % 4] as readonly [number, number];
        const z = Math.floor(i / 4) * 13;
        const tone = shade(base, 1 - ((i * 7) % 5) * 0.035);
        box(g, col, row, 0.86, 0.86, z, 13, tone);
        // A band in the category's colour, like a strap round the crate.
        face(g, [[col, row + 0.86, z + 9], [col + 0.86, row + 0.86, z + 9], [col + 0.86, row + 0.86, z + 6], [col, row + 0.86, z + 6]], mix(colour, PALETTE.dust, dull));
        face(g, [[col + 0.86, row + 0.86, z + 9], [col + 0.86, row, z + 9], [col + 0.86, row, z + 6], [col + 0.86, row + 0.86, z + 6]], shade(mix(colour, PALETTE.dust, dull), 0.76));
        if (ageBand >= 1) specks(g, col + 0.05, row + 0.05, 0.76, 0.76, z + 13, 5, PALETTE.dust);
        if (ageBand >= 3) specks(g, col + 0.05, row + 0.05, 0.76, 0.76, z + 13, 4, PALETTE.moss, 2.4);
      }
      if (ageBand >= 2) {
        // Weeds growing up round the base.
        for (let i = 0; i < 16; i++) {
          const along = (i * 0.137 + 0.05) % 1;
          const onFront = i % 2 === 0;
          const col = onFront ? along * 2 : 2.02;
          const row = onFront ? 2.02 : along * 2;
          const x = sx(col, row);
          const y = sy(col, row);
          const tall = 5 + ((i * 5) % 6) + (ageBand === 3 ? 4 : 0);
          g.poly([x - 2.2, y, x, y - tall, x + 2.2, y]).fill(i % 3 === 0 ? PALETTE.moss : PALETTE.weed);
        }
      }
    });
  }

  /** A delivery waiting on the dock. Left too long, it gets a tarp thrown over it. */
  pallet(stale: boolean): Tex {
    return this.make(`pallet:${stale}`, (g) => {
      shadow(g, -0.34, -0.34, 0.72, 0.72, 0.2);
      box(g, -0.32, -0.32, 0.64, 0.64, 0, 3, PALETTE.woodDark);
      if (stale) {
        box(g, -0.33, -0.33, 0.66, 0.66, 3, 12, PALETTE.tarp);
        specks(g, -0.28, -0.28, 0.56, 0.56, 15, 6, PALETTE.dust);
      } else {
        box(g, -0.27, -0.27, 0.54, 0.54, 3, 11, PALETTE.woodLight);
        face(g, [[-0.27, 0.27, 10], [0.27, 0.27, 10], [0.27, 0.27, 8], [-0.27, 0.27, 8]], PALETTE.woodDark);
      }
    });
  }

  /** A supplier: a yard with a shed, a crane, and one container per open order. */
  port(colour: number, containers: number): Tex {
    return this.make(`port:${colour}:${containers}`, (g) => {
      face(g, [[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]], PALETTE.concrete);
      face(g, [[-2.5, 2.5], [2.5, 2.5], [2.5, 2.5, -4], [-2.5, 2.5, -4]], PALETTE.concreteDark);
      face(g, [[2.5, 2.5], [2.5, -2.5], [2.5, -2.5, -4], [2.5, 2.5, -4]], shade(PALETTE.concreteDark, 0.82));
      box(g, -2.2, -2.2, 2.5, 1.7, 0, 22, PALETTE.white);
      gableRoof(g, -2.35, -2.35, 2.8, 2, 22, 13, colour, PALETTE.white);
      face(g, [[-1.5, -0.5, 13], [-0.7, -0.5, 13], [-0.7, -0.5, 0], [-1.5, -0.5, 0]], shade(colour, 0.6));
      // Crane.
      box(g, 1.5, -2.1, 0.28, 0.28, 0, 50, PALETTE.steel);
      box(g, 0.2, -2.1, 1.9, 0.28, 46, 4, PALETTE.gold);
      g.moveTo(sx(0.5, -1.96), sy(0.5, -1.96, 46)).lineTo(sx(0.5, -1.96), sy(0.5, -1.96, 30)).stroke({ color: PALETTE.ink, width: 1 });
      for (let i = 0; i < containers; i++) {
        const col = -2.1 + (i % 3) * 1.35;
        const row = 0.5 + Math.floor(i / 3) * 0.85;
        box(g, col, row, 1.2, 0.6, 0, 11, i % 2 === 0 ? colour : shade(colour, 1.25));
      }
      // Flag in the supplier's colour, so its lorries can be matched to it.
      const fx = sx(2.2, 2.2);
      const fy = sy(2.2, 2.2);
      g.rect(fx - 0.8, fy - 30, 1.6, 30).fill(PALETTE.ink);
      g.poly([fx + 0.8, fy - 30, fx + 15, fy - 26, fx + 0.8, fy - 21]).fill(colour);
    });
  }

  /** A customer: more houses for more revenue. A barrier means on stop, an amber banner means over limit. */
  village(colour: number, houses: number, status: 'ok' | 'overLimit' | 'onStop'): Tex {
    return this.make(`village:${colour}:${houses}:${status}`, (g) => {
      face(g, [[-2.3, -2.3], [2.3, -2.3], [2.3, 2.3], [-2.3, 2.3]], 0x9fae78);
      // Fill from the middle outwards, then draw back to front.
      const order = [4, 1, 3, 5, 7, 0, 2, 6, 8].slice(0, houses).sort((a, b) => (a % 3) + Math.floor(a / 3) - ((b % 3) + Math.floor(b / 3)) || a - b);
      for (const slot of order) {
        const col = -1.85 + (slot % 3) * 1.3;
        const row = -1.85 + Math.floor(slot / 3) * 1.3;
        const wall = status === 'onStop' ? PALETTE.dust : 0xeadfc4;
        const roof = status === 'onStop' ? mix(colour, PALETTE.dust, 0.6) : colour;
        shadow(g, col + 0.1, row + 0.1, 1, 1, 0.16);
        box(g, col, row, 0.9, 0.9, 0, 11, wall);
        gableRoof(g, col - 0.08, row - 0.08, 1.06, 1.06, 11, 9, roof, wall);
        face(g, [[col + 0.32, row + 0.9, 7], [col + 0.58, row + 0.9, 7], [col + 0.58, row + 0.9, 0], [col + 0.32, row + 0.9, 0]], shade(roof, 0.55));
      }
      if (status === 'onStop') {
        // A striped barrier across the front: no more orders go in.
        for (let i = 0; i < 8; i++) {
          box(g, -2.2 + i * 0.55, 2.3, 0.55, 0.16, 7, 4, i % 2 === 0 ? PALETTE.late : PALETTE.white);
        }
        box(g, -2.3, 2.26, 0.2, 0.2, 0, 11, PALETTE.ink);
        box(g, 2.15, 2.26, 0.2, 0.2, 0, 11, PALETTE.ink);
      }
      if (status === 'overLimit') {
        const fx = sx(2.1, -2.1);
        const fy = sy(2.1, -2.1);
        g.rect(fx - 0.9, fy - 36, 1.8, 36).fill(PALETTE.ink);
        g.poly([fx + 0.9, fy - 36, fx + 17, fy - 36, fx + 13, fy - 30, fx + 17, fy - 24, fx + 0.9, fy - 24]).fill(PALETTE.warn);
      }
    });
  }

  /** Small customers, grouped. */
  hamlet(houses: number, anyOnStop: boolean): Tex {
    return this.make(`hamlet:${houses}:${anyOnStop}`, (g) => {
      face(g, [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]], 0xa8b382);
      const spots = [
        [-0.45, -0.45],
        [-1.5, -0.6],
        [0.5, -1.5],
        [-0.7, 0.6],
        [0.6, 0.5],
      ] as const;
      const drawn = [...spots.slice(0, houses)].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      for (const [col, row] of drawn) {
        box(g, col, row, 0.8, 0.8, 0, 8, 0xe0d3b3);
        gableRoof(g, col - 0.07, row - 0.07, 0.94, 0.94, 8, 8, 0xc9a85c, 0xe0d3b3);
      }
      if (anyOnStop) {
        for (let i = 0; i < 4; i++) box(g, -1 + i * 0.5, 1.8, 0.5, 0.14, 6, 3, i % 2 === 0 ? PALETTE.late : PALETTE.white);
      }
    });
  }

  /** Work a building cannot keep up with, piled at its door. */
  backlog(tier: 1 | 2 | 3): Tex {
    return this.make(`backlog:${tier}`, (g) => {
      shadow(g, -0.4, -0.4, 0.9, 0.9, 0.2);
      const stacks = tier === 1 ? [[0, 0, 2]] : tier === 2 ? [[-0.25, -0.2, 3], [0.2, 0.15, 2]] : [[-0.32, -0.3, 4], [0.22, -0.2, 3], [-0.1, 0.25, 5]];
      for (const [col, row, count] of stacks as number[][]) {
        for (let i = 0; i < (count as number); i++) {
          box(g, (col as number) - 0.2, (row as number) - 0.2, 0.42, 0.42, i * 5, 5, i % 2 === 0 ? PALETTE.white : 0xd9cfb6);
        }
      }
      const top = tier === 1 ? 10 : tier === 2 ? 15 : 25;
      g.circle(0, -top - 9, 5).fill(PALETTE.late);
      g.rect(-0.9, -top - 12.5, 1.8, 4.6).fill(PALETTE.white);
      g.rect(-0.9, -top - 6.8, 1.8, 1.8).fill(PALETTE.white);
    });
  }

  /** Fog of war over a 2x2 plot: the data there cannot be trusted. */
  fog(): Tex {
    return this.make('fog', (g) => {
      const blobs = [
        [0, -4, 70, 34, 0.86],
        [-34, 2, 44, 24, 0.8],
        [36, 4, 46, 24, 0.8],
        [-10, -28, 46, 26, 0.84],
        [22, -24, 40, 22, 0.8],
        [0, 14, 52, 20, 0.74],
      ] as const;
      for (const [x, y, rx, ry, alpha] of blobs) g.ellipse(x, y, rx, ry).fill({ color: PALETTE.fog, alpha });
      for (const [x, y, rx, ry] of blobs.slice(0, 3)) g.ellipse(x - 8, y - 6, rx * 0.5, ry * 0.4).fill({ color: 0x3a4654, alpha: 0.35 });
    });
  }

  /** A warning marker that floats over anything late. */
  marker(colour: number): Tex {
    return this.make(`marker:${colour}`, (g) => {
      g.poly([0, 0, -7, -11, 7, -11]).fill(colour);
      g.circle(0, -17, 9).fill(colour).stroke({ color: PALETTE.white, width: 1.5 });
      g.roundRect(-1.4, -23, 2.8, 7.5, 1).fill(PALETTE.white);
      g.circle(0, -12.4, 1.6).fill(PALETTE.white);
    });
  }
}
