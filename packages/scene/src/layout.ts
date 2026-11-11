/**
 * World layout: where every supplier, customer and stock category sits on the map.
 * Built from master data only, so it does not shift as the date changes.
 * Entities are placed in master order, so adding one never moves the others.
 */
import type { GeoPoint, WorldMaster } from '@ai-erp/domain';
import { hashString, hashUnit } from './hash';
import type { Tile } from './iso';
import { tilesOnPath } from './paths';
import { staffingLevels, type StaffingLevels } from './workers';
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

/** Suppliers ranked this high get their own port. The rest share depots. */
export const PORT_COUNT = 64;
/** Ring slots kept for the shared depots, spread evenly round the map. */
const DEPOT_SLOTS = [4, 13, 22, 31, 40, 49, 58, 67] as const;
export const DEPOT_COUNT = DEPOT_SLOTS.length;

/** Customers ranked this high get their own village. The rest share hamlets. */
export const VILLAGE_COUNT = 100;
/** Small customers are grouped by compass direction, twelve ways. */
const HAMLET_SECTORS = 12;

const CENTRE = MAP_SIZE / 2;
/** Tiles from the centre of the map to the ring of supplier ports. */
export const PORT_RADIUS = 86;
const PORT_RING = { radius: PORT_RADIUS, slots: 72 };
const HAMLET_RING = { radius: 76, slots: HAMLET_SECTORS };
/** How near and how far from the centre a customer can sit, in tiles. */
const CUSTOMER_REACH = { min: 25, max: 68 };
/** A customer this many kilometres away, or further, sits at the far edge. */
const FAR_KM = 600;
/** Least distance between two places, in tiles. */
const PLACE_GAP = 6;
/** With no locations to go on, bigger customers sit closer in. */
const RANK_RINGS = [
  { maxRank: 10, radius: 30 },
  { maxRank: 30, radius: 42 },
  { maxRank: 60, radius: 54 },
  { maxRank: VILLAGE_COUNT, radius: 66 },
] as const;

export interface Place {
  /** Tile the place is centred on. */
  tile: Tile;
  gate: GateId;
  /** Road from the place to its settlement gate, as tile corners of the road tiles. */
  road: Tile[];
}

export interface PortPlace extends Place {
  /** The supplier id for a port, or `depot:n` for a depot shared by small suppliers. */
  key: string;
  supplierIds: string[];
  name: string;
  shared: boolean;
}

export interface VillagePlace extends Place {
  customerId: string;
  name: string;
  /** 3 for the biggest customers, 1 for the smallest that still get a village. */
  band: 1 | 2 | 3;
  /** True when the village sits where the customer really is, relative to the site. */
  located: boolean;
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
  /** How much work each building's workers get through, sized to this business. */
  staffing: StaffingLevels;
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

/**
 * Where a real place belongs on the map: its compass direction from the site, and further out the further away it is.
 * North is up the screen. Distance is compressed, so nearby customers do not pile onto the settlement.
 */
export function geoTile(site: GeoPoint, point: GeoPoint): Tile {
  const east = (point.lon - site.lon) * Math.cos((site.lat * Math.PI) / 180) * 111.32;
  const north = (point.lat - site.lat) * 110.57;
  const km = Math.hypot(east, north);
  const reach = CUSTOMER_REACH.min + (CUSTOMER_REACH.max - CUSTOMER_REACH.min) * Math.min(1, km / FAR_KM) ** 0.55;
  const ux = km > 0 ? east / km : 0;
  const uy = km > 0 ? north / km : 1;
  // On the grid, screen-right is (+col, -row) and screen-up is (-col, -row).
  return {
    col: CENTRE + (reach * (ux - uy)) / Math.SQRT2,
    row: CENTRE + (reach * (-ux - uy)) / Math.SQRT2,
  };
}

/** Compass sector of a place seen from the site: 0 is north, going clockwise. */
function sectorOf(site: GeoPoint, point: GeoPoint): number {
  const east = (point.lon - site.lon) * Math.cos((site.lat * Math.PI) / 180);
  const north = point.lat - site.lat;
  const bearing = (Math.atan2(east, north) + Math.PI * 2) % (Math.PI * 2);
  return Math.floor((bearing / (Math.PI * 2)) * HAMLET_SECTORS) % HAMLET_SECTORS;
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

  const major = master.suppliers.filter((supplier) => supplier.rank <= PORT_COUNT);
  const minor = master.suppliers.filter((supplier) => supplier.rank > PORT_COUNT);
  const portSlots = assignSlots(major.map((supplier) => supplier.id), PORT_RING.slots, new Set<number>(DEPOT_SLOTS));
  const ports: PortPlace[] = major.flatMap((supplier) => {
    const slot = portSlots.get(supplier.id);
    if (slot === undefined) return [];
    return [{ key: supplier.id, supplierIds: [supplier.id], name: supplier.name, shared: false, ...place(ringTile(PORT_RING.radius, PORT_RING.slots, slot)) }];
  });
  if (minor.length > 0) {
    const members: string[][] = DEPOT_SLOTS.map(() => []);
    for (const supplier of minor) (members[hashString(supplier.id) % DEPOT_COUNT] as string[]).push(supplier.id);
    DEPOT_SLOTS.forEach((slot, index) => {
      const supplierIds = members[index] as string[];
      if (supplierIds.length === 0) return;
      ports.push({
        key: `depot:${index}`,
        supplierIds,
        name: `${supplierIds.length} small suppliers`,
        shared: true,
        ...place(ringTile(PORT_RING.radius, PORT_RING.slots, slot)),
      });
    });
  }

  // ---- Customers. Bigger ones are placed first, so they get the spot nearest their true position.
  const occupied: Tile[] = ports.map((port) => port.tile);
  const isFree = (tile: Tile): boolean => {
    const radius = Math.hypot(tile.col - CENTRE, tile.row - CENTRE);
    if (radius < CUSTOMER_REACH.min - 1 || radius > PORT_RADIUS - PLACE_GAP - 1) return false;
    if (Math.abs(tile.col - TRUNK) < 3 || Math.abs(tile.row - TRUNK) < 3) return false;
    return occupied.every((other) => Math.hypot(other.col - tile.col, other.row - tile.row) >= PLACE_GAP);
  };
  /** The free tile nearest a target, searching outwards in a spiral. */
  const settle = (target: Tile): Tile => {
    for (let ring = 0; ring < 80; ring++) {
      const steps = Math.max(1, ring * 6);
      for (let step = 0; step < steps; step++) {
        const angle = (step / steps) * Math.PI * 2;
        const tile = {
          col: Math.round(target.col + ring * 1.5 * Math.cos(angle)),
          row: Math.round(target.row + ring * 1.5 * Math.sin(angle)),
        };
        if (isFree(tile)) {
          occupied.push(tile);
          return tile;
        }
      }
    }
    const fallback = { col: Math.round(target.col), row: Math.round(target.row) };
    occupied.push(fallback);
    return fallback;
  };
  const onRing = (radius: number, turn: number): Tile => ({
    col: CENTRE + radius * Math.cos(turn * Math.PI * 2),
    row: CENTRE + radius * Math.sin(turn * Math.PI * 2),
  });

  const { site } = master;
  const byRank = [...master.customers].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const villages: VillagePlace[] = [];
  const homeByCustomer = new Map<string, CustomerHome>();
  for (const customer of byRank) {
    if (customer.rank > VILLAGE_COUNT) continue;
    const located = site !== null && customer.location !== null;
    const ring = RANK_RINGS.find((candidate) => customer.rank <= candidate.maxRank) ?? RANK_RINGS[RANK_RINGS.length - 1];
    const target =
      site !== null && customer.location !== null
        ? geoTile(site, customer.location)
        : onRing(ring?.radius ?? CUSTOMER_REACH.max, hashUnit(`turn:${customer.id}`));
    homeByCustomer.set(customer.id, { kind: 'village', index: villages.length });
    villages.push({
      customerId: customer.id,
      name: customer.name,
      band: customer.rank <= 10 ? 3 : customer.rank <= 40 ? 2 : 1,
      located,
      ...place(settle(target)),
    });
  }

  // Small customers share a hamlet with others in the same direction. Those with no location share one more.
  const groups = new Map<number, { customerIds: string[]; targets: Tile[] }>();
  for (const customer of byRank) {
    if (customer.rank <= VILLAGE_COUNT) continue;
    const located = site !== null && customer.location !== null;
    const sector =
      site !== null && customer.location !== null
        ? sectorOf(site, customer.location)
        : site !== null
          ? HAMLET_SECTORS
          : hashString(customer.id) % HAMLET_SECTORS;
    const group = groups.get(sector) ?? { customerIds: [], targets: [] };
    group.customerIds.push(customer.id);
    if (located && site !== null && customer.location !== null) group.targets.push(geoTile(site, customer.location));
    groups.set(sector, group);
  }
  const hamlets: HamletPlace[] = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([sector, group], index) => {
      for (const customerId of group.customerIds) homeByCustomer.set(customerId, { kind: 'hamlet', index });
      // A hamlet sits at the middle of its customers, or out on the ring between two ports if none has a location.
      const target =
        group.targets.length > 0
          ? {
              col: group.targets.reduce((sum, tile) => sum + tile.col, 0) / group.targets.length,
              row: group.targets.reduce((sum, tile) => sum + tile.row, 0) / group.targets.length,
            }
          : ringTile(HAMLET_RING.radius, HAMLET_RING.slots, sector - 0.333 + (sector === HAMLET_SECTORS ? 6.4 : 0));
      return { index, customerIds: group.customerIds, ...place(settle(target)) };
    });

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
    staffing: staffingLevels(master.typicalQueue),
    portBySupplier: new Map(ports.flatMap((port) => port.supplierIds.map((id) => [id, port] as const))),
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
