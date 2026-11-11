/** Where on the map a record can be seen, so the camera can fly to it. */
import type { RecordRef, WorldState } from '@ai-erp/domain';
import { BUILDINGS, customerPlace, DOCK, STALLED_SLOTS, type Layout, type Tile } from '@ai-erp/scene';

const centreOf = (rect: { col: number; row: number; w: number; h: number }): Tile => ({
  col: rect.col + rect.w / 2,
  row: rect.row + rect.h / 2,
});

export function locate(ref: RecordRef, world: WorldState, layout: Layout): Tile | null {
  switch (ref.type) {
    case 'supplier':
      return layout.portBySupplier.get(ref.id)?.tile ?? null;
    case 'customer':
      return customerPlace(layout, ref.id)?.tile ?? null;
    case 'category': {
      const plot = layout.plotByCategory.get(ref.id);
      return plot ? centreOf(plot.rect) : null;
    }
    case 'purchaseOrder': {
      const order = world.purchaseOrders.find((candidate) => candidate.id === ref.id);
      if (!order) return null;
      if (order.late && order.status !== 'raised') return STALLED_SLOTS[8] ?? null;
      return layout.portBySupplier.get(order.supplierId)?.tile ?? null;
    }
    case 'goodsReceipt':
      return centreOf(DOCK);
    case 'salesOrder': {
      const order = world.salesOrders.find((candidate) => candidate.id === ref.id);
      if (!order) return centreOf(BUILDINGS.dispatch.rect);
      if (order.status === 'back_ordered') return centreOf(BUILDINGS.sales.rect);
      if (order.status === 'allocated') return centreOf(BUILDINGS.warehouse.rect);
      return centreOf(BUILDINGS.dispatch.rect);
    }
    case 'salesInvoice':
    case 'purchaseInvoice':
      return centreOf(BUILDINGS.accounts.rect);
    case 'product':
      return null;
  }
}
