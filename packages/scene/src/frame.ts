/**
 * Scene frame: where everything that moves or changes is, for one world state and time of day.
 * Pure presentation. It never decides a business outcome: late, aged and untrusted all come from the core.
 */
import { toDayNumber, type RecordRef, type WorldState } from '@ai-erp/domain';
import type { Tile } from './iso';
import { customerPlace, type Layout } from './layout';
import { pathLength, pointAlong, type Heading } from './paths';
import { DOCK_SLOTS, GATES, LORRY_BAYS, perimeterRoute, STALLED_SLOTS, VAN_BAYS } from './settlement';

export type VehicleKind = 'lorry' | 'van' | 'cart' | 'letter';
export type VehicleState = 'moving' | 'stalled' | 'waiting' | 'unloading' | 'parked';

export interface Vehicle {
  key: string;
  kind: VehicleKind;
  /** The records this vehicle stands for. More than one means a convoy. */
  refs: RecordRef[];
  col: number;
  row: number;
  heading: Heading;
  state: VehicleState;
  /** Supplier or customer the vehicle belongs to. Picks its colour. */
  partyId: string;
  late: boolean;
  daysLate: number;
  label: string;
}

export interface PalletSprite {
  key: string;
  ref: RecordRef;
  col: number;
  row: number;
  stale: boolean;
  label: string;
}

export interface PileSprite {
  categoryId: string;
  /** Crates to draw, 0 to 12. Tracks stock value. */
  crates: number;
  ageBand: 0 | 1 | 2 | 3;
  fogged: boolean;
  fogReason: string;
  label: string;
}

export interface PortSprite {
  /** Matches PortPlace.key. */
  key: string;
  /** Set for a port that belongs to one supplier. Picks its colour. */
  supplierId: string | null;
  /** Kept dark because some of its orders cannot be placed in time. */
  fogged: boolean;
  fogReason: string;
  /** Containers waiting at the port: open orders, capped. */
  containers: number;
  openCount: number;
  lateCount: number;
  worstDaysLate: number;
  label: string;
}

export interface VillageSprite {
  customerId: string;
  /** Houses to draw, 1 to 9. Tracks revenue. */
  houses: number;
  onStop: boolean;
  overLimit: boolean;
  label: string;
}

export interface HamletSprite {
  index: number;
  houses: number;
  customerCount: number;
  onStopCount: number;
  label: string;
}

export interface SceneFrame {
  vehicles: Vehicle[];
  pallets: PalletSprite[];
  /** Deliveries on the dock beyond the slots that can be drawn. */
  palletOverflow: number;
  piles: PileSprite[];
  ports: PortSprite[];
  villages: VillageSprite[];
  hamlets: HamletSprite[];
  /** Late lorries beyond the queue slots that can be drawn. */
  stalledOverflow: number;
}

const PARKED_VAN_LIMIT = 4;
/** A lorry due this many days out, or more, is at the far end of its road. */
export const DELIVERY_HORIZON_DAYS = 28;
const centre = (tile: Tile): Tile => ({ col: tile.col + 0.5, row: tile.row + 0.5 });
const centred = (tiles: readonly Tile[]): Tile[] => tiles.map(centre);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

const short = (value: number): string =>
  value >= 1_000_000 ? `£${(value / 1_000_000).toFixed(2)}m` : value >= 1000 ? `£${Math.round(value / 1000)}k` : `£${Math.round(value)}`;

/** The bay each lorry arriving today unloads at, by purchase order id. */
export function lorryBays(state: WorldState): Map<string, number> {
  const arriving = state.purchaseOrders
    .filter((order) => order.arrivingToday)
    .map((order) => order.id)
    .sort();
  return new Map(arriving.map((id, index) => [id, index % LORRY_BAYS.length]));
}

/** The dock slot each delivery sits on, by receipt id. */
export function dockSlots(state: WorldState): Map<string, number> {
  const sorted = [...state.dock].sort((a, b) => a.receivedDate.localeCompare(b.receivedDate) || a.receiptId.localeCompare(b.receiptId));
  return new Map(sorted.slice(0, DOCK_SLOTS.length).map((pallet, index) => [pallet.receiptId, index]));
}

/**
 * @param dayFraction how far through the day it is, 0 to 1. Vehicles move smoothly with it.
 */
export function buildFrame(layout: Layout, state: WorldState, dayFraction: number): SceneFrame {
  const now = toDayNumber(state.asOf) + clamp(dayFraction, 0, 1);
  const supplierName = new Map(state.suppliers.map((supplier) => [supplier.id, supplier.name]));
  const customerById = new Map(state.customers.map((customer) => [customer.id, customer]));
  const vehicles: Vehicle[] = [];

  // ---- Lorries: one per purchase order, or one convoy per supplier and due date.
  const bays = lorryBays(state);
  const stalled = state.purchaseOrders
    .filter((order) => order.late && order.status !== 'raised' && !order.arrivingToday)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  stalled.slice(0, STALLED_SLOTS.length).forEach((order, index) => {
    const slot = centre(STALLED_SLOTS[index] as Tile);
    vehicles.push({
      key: `lorry:${order.id}`,
      kind: 'lorry',
      refs: [{ type: 'purchaseOrder', id: order.id }],
      ...slot,
      heading: 'nr',
      state: 'stalled',
      partyId: order.supplierId,
      late: true,
      daysLate: order.daysLate,
      label: `${order.id} from ${supplierName.get(order.supplierId) ?? order.supplierId}: ${order.daysLate} days late`,
    });
  });

  const travelling = new Map<string, typeof state.purchaseOrders>();
  const waiting = new Map<string, typeof state.purchaseOrders>();
  for (const order of state.purchaseOrders) {
    const port = layout.portBySupplier.get(order.supplierId);
    if (!port) continue;
    const name = supplierName.get(order.supplierId) ?? order.supplierId;
    if (order.arrivingToday) {
      const bay = LORRY_BAYS[bays.get(order.id) ?? 0] as Tile;
      const route = centred(perimeterRoute(GATES[port.gate], bay));
      const length = pathLength(route);
      // The first quarter of the day is the drive from the gate to the bay.
      const driving = dayFraction < 0.25;
      const point = pointAlong(route, driving ? (dayFraction / 0.25) * length : length);
      vehicles.push({
        key: `lorry:${order.id}`,
        kind: 'lorry',
        refs: [{ type: 'purchaseOrder', id: order.id }],
        col: point.col,
        row: point.row,
        heading: point.heading,
        state: driving ? 'moving' : 'unloading',
        partyId: order.supplierId,
        late: false,
        daysLate: 0,
        label: `${order.id} from ${name}: unloading`,
      });
    } else if (order.status === 'raised' || order.dueUnknown || order.stale) {
      // Not confirmed, no due date, or long dead: none of these can be placed on the road.
      const list = waiting.get(order.supplierId) ?? [];
      list.push(order);
      waiting.set(order.supplierId, list);
    } else if (!order.late) {
      const key = `${order.supplierId}|${order.dueDate}`;
      const list = travelling.get(key) ?? [];
      list.push(order);
      travelling.set(key, list);
    }
  }

  for (const [key, orders] of travelling) {
    const first = orders[0] as (typeof orders)[number];
    const port = layout.portBySupplier.get(first.supplierId);
    if (!port) continue;
    const route = centred(port.road);
    // Lorries are spaced by delivery date: the nearer the due date, the nearer the gate.
    const daysToDue = toDayNumber(first.dueDate) - now;
    const progress = clamp(1 - daysToDue / DELIVERY_HORIZON_DAYS, 0.03, 0.95);
    const point = pointAlong(route, progress * pathLength(route));
    const name = supplierName.get(first.supplierId) ?? first.supplierId;
    vehicles.push({
      key: `lorry:${key}`,
      kind: 'lorry',
      refs: orders.map((order) => ({ type: 'purchaseOrder' as const, id: order.id })),
      col: point.col,
      row: point.row,
      heading: point.heading,
      state: 'moving',
      partyId: first.supplierId,
      late: false,
      daysLate: 0,
      label:
        orders.length > 1
          ? `${orders.length} orders from ${name}, due ${first.dueDate}`
          : `${first.id} from ${name}, due ${first.dueDate}`,
    });
  }

  for (const [supplierId, orders] of waiting) {
    const port = layout.portBySupplier.get(supplierId);
    if (!port) continue;
    const name = supplierName.get(supplierId) ?? supplierId;
    const unconfirmed = orders.filter((order) => order.unacknowledged);
    const undated = orders.filter((order) => order.dueUnknown);
    const stale = orders.filter((order) => order.stale);
    const worst = orders.reduce((max, order) => (order.late ? Math.max(max, order.daysLate) : max), 0);
    const start = pointAlong(centred(port.road), 1.6);
    vehicles.push({
      key: `lorry:waiting:${supplierId}`,
      kind: 'lorry',
      refs: orders.map((order) => ({ type: 'purchaseOrder' as const, id: order.id })),
      col: start.col,
      row: start.row,
      heading: start.heading,
      state: 'waiting',
      partyId: supplierId,
      late: worst > 0,
      daysLate: worst,
      label:
        stale.length > 0
          ? `${stale.length} at ${name} long overdue, probably never closed`
          : undated.length > 0
          ? `${undated.length} at ${name} with no due date`
          : unconfirmed.length > 0
            ? `${orders.length} at ${name} not yet confirmed by the supplier`
            : `${orders.length} at ${name}, just raised`,
    });
  }

  // ---- Vans: shipped orders on their way, one convoy per destination and ship date.
  const shipped = state.salesOrders.filter((order) => order.status === 'shipped' && order.shippedDate !== null);
  const vanGroups = groupBy(shipped, (order) => {
    const home = layout.homeByCustomer.get(order.customerId);
    return `${home?.kind}:${home?.index}|${order.shippedDate}`;
  });
  let vanIndex = 0;
  for (const [key, orders] of vanGroups) {
    const first = orders[0] as (typeof orders)[number];
    const destination = customerPlace(layout, first.customerId);
    if (!destination || first.shippedDate === null) continue;
    const bay = VAN_BAYS[vanIndex++ % VAN_BAYS.length] as Tile;
    const route = centred([...perimeterRoute(bay, GATES[destination.gate]), ...[...destination.road].reverse().slice(1)]);
    const shippedDay = toDayNumber(first.shippedDate);
    const arrivalDay = first.deliveredDate !== null ? toDayNumber(first.deliveredDate) : shippedDay + 2;
    const progress = clamp((now - shippedDay) / Math.max(1, arrivalDay - shippedDay), 0.02, 0.98);
    const point = pointAlong(route, progress * pathLength(route));
    const customers = new Set(orders.map((order) => order.customerId));
    const name = customers.size === 1 ? (customerById.get(first.customerId)?.name ?? first.customerId) : `${customers.size} small customers`;
    vehicles.push({
      key: `van:${key}`,
      kind: 'van',
      refs: orders.map((order) => ({ type: 'salesOrder' as const, id: order.id })),
      col: point.col,
      row: point.row,
      heading: point.heading,
      state: 'moving',
      partyId: first.customerId,
      late: false,
      daysLate: 0,
      label: orders.length > 1 ? `${orders.length} orders on the way to ${name}` : `${first.id} on the way to ${name}`,
    });
  }

  // Picked orders past their committed date: the van sits at dispatch with a warning flag.
  const heldBack = state.salesOrders
    .filter((order) => order.status === 'picked' && order.late)
    .sort((a, b) => b.daysLate - a.daysLate || a.id.localeCompare(b.id));
  heldBack.slice(0, PARKED_VAN_LIMIT).forEach((order, index) => {
    const bay = centre(VAN_BAYS[VAN_BAYS.length - 1 - index] as Tile);
    vehicles.push({
      key: `van:held:${order.id}`,
      kind: 'van',
      refs: [{ type: 'salesOrder', id: order.id }],
      ...bay,
      heading: 'pr',
      state: 'parked',
      partyId: order.customerId,
      late: true,
      daysLate: order.daysLate,
      label: `${order.id} picked but not shipped: ${order.daysLate} days past its committed date`,
    });
  });

  // ---- Money: payments travel in from customers, bills from suppliers, over the day.
  for (const [customerHome, payments] of groupBy(state.paymentsIn, (payment) => {
    const home = layout.homeByCustomer.get(payment.partyId);
    return `${home?.kind}:${home?.index}`;
  })) {
    const first = payments[0] as (typeof payments)[number];
    const origin = customerPlace(layout, first.partyId);
    if (!origin) continue;
    const route = centred(origin.road);
    const point = pointAlong(route, clamp(dayFraction, 0.02, 0.98) * pathLength(route));
    const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
    vehicles.push({
      key: `cart:${customerHome}`,
      kind: 'cart',
      refs: payments.map((payment) => ({ type: 'salesInvoice' as const, id: payment.invoiceId })),
      col: point.col,
      row: point.row,
      heading: point.heading,
      state: 'moving',
      partyId: first.partyId,
      late: false,
      daysLate: 0,
      label: `${payments.length === 1 ? 'Payment' : `${payments.length} payments`} coming in: ${short(total)}`,
    });
  }
  for (const [supplierId, bills] of groupBy(state.billsIn, (bill) => bill.partyId)) {
    const port = layout.portBySupplier.get(supplierId);
    if (!port) continue;
    const route = centred(port.road);
    const point = pointAlong(route, clamp(dayFraction, 0.02, 0.98) * pathLength(route));
    const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
    vehicles.push({
      key: `letter:${supplierId}`,
      kind: 'letter',
      refs: bills.map((bill) => ({ type: 'purchaseInvoice' as const, id: bill.invoiceId })),
      col: point.col,
      row: point.row,
      heading: point.heading,
      state: 'moving',
      partyId: supplierId,
      late: false,
      daysLate: 0,
      label: `${bills.length === 1 ? 'Bill' : `${bills.length} bills`} from ${supplierName.get(supplierId) ?? supplierId}: ${short(total)}`,
    });
  }

  // ---- Dock, stock, ports, villages
  const slots = dockSlots(state);
  const pallets: PalletSprite[] = state.dock.flatMap((pallet) => {
    const slot = slots.get(pallet.receiptId);
    if (slot === undefined) return [];
    return [
      {
        key: `pallet:${pallet.receiptId}`,
        ref: { type: 'goodsReceipt' as const, id: pallet.receiptId },
        ...centre(DOCK_SLOTS[slot] as Tile),
        stale: pallet.stale,
        label: pallet.stale
          ? `${pallet.receiptId}: on the dock ${pallet.daysOnDock} days`
          : `${pallet.receiptId}: delivered ${pallet.receivedDate}`,
      },
    ];
  });

  const fogByCategory = new Map(state.fog.filter((flag) => flag.scope === 'category').map((flag) => [flag.id, flag.reason]));
  const biggestPile = Math.max(1, ...state.stockpiles.map((pile) => pile.value));
  const piles: PileSprite[] = state.stockpiles.map((pile) => ({
    categoryId: pile.categoryId,
    crates: pile.value > 0 ? clamp(Math.round((pile.value / biggestPile) * 12), 1, 12) : 0,
    ageBand: pile.ageBand,
    fogged: fogByCategory.has(pile.categoryId),
    fogReason: fogByCategory.get(pile.categoryId) ?? '',
    label: `${pile.name}: ${short(pile.value)} in stock${pile.ageBand > 0 ? `, ${short(pile.agedValue)} ageing` : ''}`,
  }));

  const supplierById = new Map(state.suppliers.map((supplier) => [supplier.id, supplier]));
  const fogBySupplier = new Map(state.fog.filter((flag) => flag.scope === 'supplier').map((flag) => [flag.id, flag.reason]));
  const ports: PortSprite[] = layout.ports.map((port) => {
    const members = port.supplierIds.flatMap((id) => supplierById.get(id) ?? []);
    const openCount = members.reduce((sum, supplier) => sum + supplier.openPoCount, 0);
    const lateCount = members.reduce((sum, supplier) => sum + supplier.latePoCount, 0);
    const worstDaysLate = members.reduce((max, supplier) => Math.max(max, supplier.worstDaysLate), 0);
    const staleCount = members.reduce((sum, supplier) => sum + supplier.stalePoCount, 0);
    const fogged = port.supplierIds.filter((id) => fogBySupplier.has(id));
    return {
      key: port.key,
      supplierId: port.shared ? null : (port.supplierIds[0] ?? null),
      containers: Math.min(6, openCount),
      openCount,
      lateCount,
      worstDaysLate,
      fogged: fogged.length > 0,
      fogReason: port.shared
        ? `${fogged.length} of these suppliers have open orders with no due date`
        : (fogBySupplier.get(port.supplierIds[0] ?? '') ?? ''),
      label:
        lateCount > 0
          ? `${port.name}: ${lateCount} of ${openCount} orders late, worst ${worstDaysLate} days`
          : staleCount > 0
            ? `${port.name}: ${openCount} open orders, ${staleCount} of them stale`
            : `${port.name}: ${openCount} open orders`,
    };
  });

  const biggestCustomer = Math.max(1, ...state.customers.map((customer) => customer.revenue));
  const villages: VillageSprite[] = layout.villages.flatMap((village) => {
    const customer = customerById.get(village.customerId);
    if (!customer) return [];
    return [
      {
        customerId: customer.id,
        houses: clamp(Math.round(Math.sqrt(customer.revenue / biggestCustomer) * 9), 1, 9),
        onStop: customer.onStop,
        overLimit: customer.overLimit,
        label: customer.onStop
          ? `${customer.name}: on stop, owes ${short(customer.balance)}`
          : `${customer.name}: ${short(customer.revenue)} in 90 days, owes ${short(customer.balance)}`,
      },
    ];
  });

  const hamlets: HamletSprite[] = layout.hamlets.map((hamlet) => {
    const members = hamlet.customerIds.flatMap((id) => customerById.get(id) ?? []);
    const revenue = members.reduce((sum, customer) => sum + customer.revenue, 0);
    return {
      index: hamlet.index,
      houses: clamp(Math.round(Math.sqrt(revenue / biggestCustomer) * 5), 1, 5),
      customerCount: members.length,
      onStopCount: members.filter((customer) => customer.onStop).length,
      label: `${members.length} small customers: ${short(revenue)} in 90 days`,
    };
  });

  return {
    vehicles,
    pallets,
    palletOverflow: Math.max(0, state.dock.length - DOCK_SLOTS.length),
    piles,
    ports,
    villages,
    hamlets,
    stalledOverflow: Math.max(0, stalled.length - STALLED_SLOTS.length),
  };
}
