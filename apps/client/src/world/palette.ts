/** The world's colours. One palette, so everything on the map reads as one place. */
import type { BuildingId } from '@ai-erp/domain';
import { hashUnit } from '@ai-erp/scene';

export const PALETTE = {
  void: 0x141d18,
  grass: 0x4f7d45,
  grassLight: 0x5a8a4d,
  grassDark: 0x46703f,
  road: 0x8d8573,
  roadEdge: 0x756e5f,
  paving: 0xb9ad93,
  pavingLine: 0xa39780,
  perimeter: 0x7d7667,
  dock: 0xc9b98f,
  dockLine: 0xe0b84a,
  yard: 0x9a8562,
  plot: 0x86734f,
  plotLine: 0x6b5a3c,
  layby: 0x8a5e55,
  shadow: 0x1c261f,
  wood: 0xb98a4e,
  woodDark: 0x8f6736,
  woodLight: 0xd3a868,
  tarp: 0x6f8794,
  dust: 0xb8b2a2,
  weed: 0x5f9a3e,
  moss: 0x3f7a4a,
  concrete: 0xa9a59a,
  concreteDark: 0x8c887e,
  steel: 0x59626b,
  glass: 0x9cc4d6,
  skin: 0xe6b48c,
  tyre: 0x2a2a2a,
  white: 0xf4efe2,
  gold: 0xe8b93a,
  late: 0xd9432f,
  warn: 0xe39a2d,
  ok: 0x7fbf6a,
  fog: 0x1a2028,
  ink: 0x1f1a14,
} as const;

/** Walls, roof and trim for each function's building. */
export const BUILDING_COLOURS: Record<BuildingId, { wall: number; roof: number; trim: number }> = {
  goodsIn: { wall: 0xd8c9a3, roof: 0x4f7fa8, trim: 0x2f5878 },
  purchasing: { wall: 0xe4d6b4, roof: 0x3f9aa0, trim: 0x27696e },
  warehouse: { wall: 0xcfc4ad, roof: 0x8a6f52, trim: 0x5e4a35 },
  dispatch: { wall: 0xd8c9a3, roof: 0xc0703a, trim: 0x8a4a22 },
  sales: { wall: 0xe4d6b4, roof: 0x5f9a6a, trim: 0x3c6e47 },
  accounts: { wall: 0xe4d6b4, roof: 0x8f5f9a, trim: 0x623e6c },
};

/** The tunic colour of each building's workers. */
export const WORKER_COLOURS: Record<BuildingId, number> = {
  goodsIn: 0x4f7fa8,
  purchasing: 0x3f9aa0,
  warehouse: 0x9a7650,
  dispatch: 0xc0703a,
  sales: 0x5f9a6a,
  accounts: 0x8f5f9a,
};

export function hsl(hue: number, saturation: number, lightness: number): number {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (channel(0) << 16) | (channel(8) << 8) | channel(4);
}

/** Each supplier and customer gets its own colour, so its vehicles can be told apart at a glance. */
export function partyColour(id: string, lightness = 0.5): number {
  return hsl(Math.floor(hashUnit(`hue:${id}`) * 24) * 15, 0.55, lightness);
}

export function shade(colour: number, factor: number): number {
  const scale = (channel: number): number => Math.max(0, Math.min(255, Math.round(channel * factor)));
  return (scale((colour >> 16) & 255) << 16) | (scale((colour >> 8) & 255) << 8) | scale(colour & 255);
}

export function mix(a: number, b: number, t: number): number {
  const blend = (shift: number): number => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (blend(16) << 16) | (blend(8) << 8) | blend(0);
}
