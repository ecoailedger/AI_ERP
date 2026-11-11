/**
 * World layout: where every supplier, customer and stock category sits on the map.
 * Built from master data only, so it does not shift as the date changes.
 * Entities are placed in master order, so adding one never moves the others.
 */
import type { WorldMaster } from '@ai-erp/domain';
import { hashString } from './hash';
import type { Tile } from './iso';
import { tilesOnPath } from './paths';
import {
  GATES,
  MAP_SIZE,
  PLOT_COUNT,
  plotAccess,
  plotRect,
  SETTLEMENT_ORIGIN,
  SETTLEMENT_SIZE,
  STALLED_SLOTS,
  TRUNK,
  type GateId,
  type Rect,
} from './settlement';

/** Customers ranked this high get their own village. The rest share hamlets. */
export const VILLAGE_COUNT = 36;
export const HAMLET_COUNT = 8;

const CENTRE = MAP_SIZE / 2;
const PORT_RING = { radius: 56, slots: 40 };
const HAMLET_RING = { radius: 49, slots: HAMLET_COUNT };
/** Bigger customers sit closer in. */
const VILLAGE_RINGS = [
  { maxRank: 8, radius: 26, slots: 16, band: 3 },
  { maxRank: 20, radius: 36, slots: 24, band: 2 },
  { maxRank: VILLAGE_COUNT, radius: 45, slots: 32, band: 1 },
] as const;

export interface Place {
  /** Tile the place is centred on. */
  tile: Tile;
  gate: GateId;
  /** Road from the place to its settlement gate, as tile corners of the road tiles. */
  road: Tile[];
}

export interface PortPlace extends Place {
  supplierId: string;
  name: string;
}

export interface VillagePlace extends Place {
  customerId: string;
  name: string;
  /** 3 is the innermost ring, for the biggest customers. */
  band: 1 | 2 | 3;
}

export interface HamletPlace extends Place {
  index: number;
  customerIds: string[];
}

export interface PlotPlace {
  categoryId: string;
  name: string;
  rect: Rect;
  access: Tile;
}

export type CustomerHome = { kind: 'village'; index: number } | { kind: 'hamlet'; index: number };

export interface Layout {
  mapSize: number;
  ports: PortPlace[];
  villages: VillagePlace[];
  hamlets: HamletPlace[];
  plots: PlotPlace[];
  /** Road tiles outside the settlement, as "col,row" keys. */
  roadTiles: Set<string>;
  portBySupplier: Map<string, PortPlace>;
  homeByCustomer: Map<string, CustomerHome>;
  plotByCategory: Map<string, PlotPlace>;
}

export const tileKey = (col: number, row: number): string => `${col},${row}`;

/** A slot on a ring round the settlement. Slots sit between the trunk roads, never on them. */
function ringTile(radius: number, slots: number, slot: number): Tile {
  const angle = ((slot + 0.5) / slots) * Math.PI * 2;
  return {
    col: Math.round(CENTRE + radius * Math.cos(angle)),
    row: Math.round(CENTRE + radius * Math.sin(angle)),
  };
}

/** Gives each id a ring slot from its hash, moving on to the next free slot on a clash. */
function assignSlots(ids: readonly string[], slots: number, taken = new Set<number>()): Map<string, number> {
  const assigned = new Map<string, number>();
  for (const id of ids) {
    if (taken.size >= slots) break;
    let slot = hashString(id) % slots;
    while (taken.has(slot)) slot = (slot + 1) % slots;
    taken.add(slot);
    assigned.set(id, slot);
  }
  return assigned;
}

/** Road from a place to the settlement: straight to the nearest trunk road, then along it to the gate. */
function roadTo(tile: Tile): { gate: GateId; road: Tile[] } {
  const dc = tile.col - TRUNK;
  const dr = tile.row - TRUNK;
  if (Math.abs(dr) >= Math.abs(dc)) {
    const gate: GateId = dr < 0 ? 'N' : 'S';
    const end = { col: TRUNK, row: gate === 'N' ? SETTLEMENT_ORIGIN - 1 : SETTLEMENT_ORIGIN + SETTLEMENT_SIZE };
    return { gate, road: [tile, { col: TRUNK, row: tile.row }, end, GATES[gate]] };
  }
  const gate: GateId = dc < 0 ? 'W' : 'E';
  const end = { col: gate === 'W' ? SETTLEMENT_ORIGIN - 1 : SETTLEMENT_ORIGIN + SETTLEMENT_SIZE, row: TRUNK };
  return { gate, road: [tile, { col: tile.col, row: TRUNK }, end, GATES[gate]] };
}

export function buildLayout(master: WorldMaster): Layout {
  const roadTiles = new Set<string>();
  const place = (tile: Tile): Place => {
    const { gate, road } = roadTo(tile);
    for (const roadTile of tilesOnPath(road.slice(0, -1))) roadTiles.add(tileKey(roadTile.col, roadTile.row));
    return { tile, gate, road };
  };

  const portSlots = assignSlots(master.suppliers.map((supplier) => supplier.id), PORT_RING.slots);
  const ports: PortPlace[] = master.suppliers.flatMap((supplier) => {
    const slot = portSlots.get(supplier.id);
    if (slot === undefined) return [];
    return [{ supplierId: supplier.id, name: supplier.name, ...place(ringTile(PORT_RING.radius, PORT_RING.slots, slot)) }];
  });

  const villages: VillagePlace[] = [];
  const hamletMembers: string[][] = Array.from({ length: HAMLET_COUNT }, () => []);
  const homeByCustomer = new Map<string, CustomerHome>();
  const takenByRing = VILLAGE_RINGS.map(() => new Set<number>());
  for (const customer of master.customers) {
    const ringIndex = VILLAGE_RINGS.findIndex((ring) => customer.rank <= ring.maxRank);
    const ring = VILLAGE_RINGS[ringIndex];
    const slot = ring && assignSlots([customer.id], ring.slots, takenByRing[ringIndex]).get(customer.id);
    if (ring && slot !== undefined) {
      homeByCustomer.set(customer.id, { kind: 'village', index: villages.length });
      villages.push({ customerId: customer.id, name: customer.name, band: ring.band, ...place(ringTile(ring.radius, ring.slots, slot)) });
    } else {
      const index = hashString(customer.id) % HAMLET_COUNT;
      (hamletMembers[index] as string[]).push(customer.id);
      homeByCustomer.set(customer.id, { kind: 'hamlet', index });
    }
  }

  const hamlets: HamletPlace[] = hamletMembers.map((customerIds, index) => ({
    index,
    customerIds,
    // A part-slot turn puts each hamlet midway between two ports on the ring outside it.
    ...place(ringTile(HAMLET_RING.radius, HAMLET_RING.slots, index + 0.3)),
  }));

  const plots: PlotPlace[] = master.categories.slice(0, PLOT_COUNT).map((category, index) => ({
    categoryId: category.id,
    name: category.name,
    rect: plotRect(index),
    access: plotAccess(index),
  }));

  for (const slot of STALLED_SLOTS) roadTiles.add(tileKey(slot.col, slot.row));

  return {
    mapSize: MAP_SIZE,
    ports,
    villages,
    hamlets,
    plots,
    roadTiles,
    portBySupplier: new Map(ports.map((port) => [port.supplierId, port])),
    homeByCustomer,
    plotByCategory: new Map(plots.map((plot) => [plot.categoryId, plot])),
  };
}

/** The place a customer's vans drive to. */
export function customerPlace(layout: Layout, customerId: string): Place | null {
  const home = layout.homeByCustomer.get(customerId);
  if (!home) return null;
  return (home.kind === 'village' ? layout.villages[home.index] : layout.hamlets[home.index]) ?? null;
}
