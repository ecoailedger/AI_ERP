/**
 * How long desk work takes, and how much of it fits in a working day.
 *
 * The times are assumptions, not measurements. They exist so that workload can be compared
 * between people and against the length of the day. Replace them with timed figures when there are some.
 */
import type { PurchaseOrder, SalesOrder } from '@ai-erp/domain';

/** The length of a working day. Nobody can do more than this, whoever or whatever they are. */
export const WORKDAY_HOURS = 7.5;
export const WORKDAY_MINUTES = WORKDAY_HOURS * 60;

/** Minutes to raise a purchase order: a fixed part, and more for every line. */
export const RAISE_PO_MINUTES = { base: 20, perLine: 6 };

/** Minutes to enter a sales order: a fixed part, and more for every line. */
export const ENTER_ORDER_MINUTES = { base: 15, perLine: 5 };

export function raisePurchaseOrderMinutes(order: PurchaseOrder): number {
  return RAISE_PO_MINUTES.base + RAISE_PO_MINUTES.perLine * order.lines.length;
}

export function enterSalesOrderMinutes(lineCount: number): number {
  return ENTER_ORDER_MINUTES.base + ENTER_ORDER_MINUTES.perLine * lineCount;
}

/**
 * The sales orders entered on a date, one entry per order as the customer placed it.
 * An order shipped in parts is several records but was entered once, with all its lines.
 */
export function ordersEntered<T extends { order: SalesOrder }>(views: readonly T[], date: string): { first: T; lineCount: number }[] {
  const entries = new Map<string, { first: T; lineCount: number }>();
  for (const view of views) {
    if (view.order.orderDate !== date) continue;
    const entry = entries.get(view.order.sourceOrderId);
    if (entry) entry.lineCount += view.order.lines.length;
    else entries.set(view.order.sourceOrderId, { first: view, lineCount: view.order.lines.length });
  }
  return [...entries.values()];
}

/** "6 h 20 min" */
export function hoursAndMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
