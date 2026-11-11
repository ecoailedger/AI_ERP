import { UNKNOWN_DATE, type RecordRef, type WorldState } from '@ai-erp/domain';
import { useState } from 'react';
import { longDate, money } from '../format';
import { actions, getState, useApp } from '../store';
import { locate } from '../world/locate';

const TABLE_ROWS = 500;

type Flag = 'ok' | 'warn' | 'late';
interface Row {
  ref: RecordRef;
  flag: Flag;
  cells: string[];
}
interface Table {
  id: string;
  label: string;
  columns: string[];
  rows: Row[];
}

const PO_STATUS = { raised: 'Not confirmed', in_transit: 'On its way', partly_received: 'Part received', received: 'Received' } as const;
const SO_STATUS = { back_ordered: 'Waiting for stock', allocated: 'Allocated', picked: 'Picked', shipped: 'Shipped' } as const;
const AGE = ['Fresh', 'Over 180 days', 'Over 365 days', 'Over 730 days'] as const;

/** The same world as plain tables: the serious summary that sits alongside the map. */
function tables(world: WorldState): Table[] {
  const supplier = new Map(world.suppliers.map((entry) => [entry.id, entry.name]));
  const customer = new Map(world.customers.map((entry) => [entry.id, entry.name]));
  return [
    {
      id: 'late',
      label: 'Late suppliers',
      columns: ['Supplier', 'Late orders', 'Worst', 'Stale orders', 'Open orders', 'Value on order'],
      rows: world.suppliers
        .filter((entry) => entry.latePoCount > 0)
        .sort((a, b) => b.latePoCount - a.latePoCount || b.worstDaysLate - a.worstDaysLate)
        .map((entry) => ({
          ref: { type: 'supplier', id: entry.id },
          flag: 'late',
          cells: [
            entry.name,
            String(entry.latePoCount),
            `${entry.worstDaysLate} days`,
            String(entry.stalePoCount),
            String(entry.openPoCount),
            money(entry.openPoValue),
          ],
        })),
    },
    {
      id: 'purchaseOrders',
      label: 'Purchase orders',
      columns: ['Order', 'Supplier', 'Ordered', 'Due', 'Status', 'Outstanding'],
      rows: world.purchaseOrders
        .filter((order) => order.qtyOutstanding > 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map((order) => ({
          ref: { type: 'purchaseOrder', id: order.id },
          flag: order.late ? 'late' : order.unacknowledged || order.dueUnknown || order.stale ? 'warn' : 'ok',
          cells: [
            order.id,
            supplier.get(order.supplierId) ?? order.supplierId,
            order.orderDate,
            order.dueUnknown ? 'Not held' : order.dueDate,
            order.late
              ? `${order.daysLate} days late`
              : order.stale
                ? `Stale, ${order.daysLate} days overdue`
                : order.dueUnknown
                  ? 'No due date'
                  : PO_STATUS[order.status],
            money(order.value),
          ],
        })),
    },
    {
      id: 'salesOrders',
      label: 'Sales orders',
      columns: ['Order', 'Customer', 'Ordered', 'Committed', 'Status', 'Value'],
      rows: world.salesOrders
        .filter((order) => order.status !== 'shipped')
        .sort((a, b) => a.committedDate.localeCompare(b.committedDate))
        .map((order) => ({
          ref: { type: 'salesOrder', id: order.id },
          flag: order.late ? 'late' : order.stale || order.status === 'back_ordered' ? 'warn' : 'ok',
          cells: [
            order.id,
            customer.get(order.customerId) ?? order.customerId,
            order.orderDate,
            order.committedDate >= UNKNOWN_DATE ? 'Not held' : order.committedDate,
            order.late
              ? `${SO_STATUS[order.status]}, ${order.daysLate} days late`
              : order.stale
                ? `Stale, ${order.daysLate} days past committed date`
                : SO_STATUS[order.status],
            money(order.value),
          ],
        })),
    },
    {
      id: 'stock',
      label: 'Stock',
      columns: ['Category', 'Products', 'Units', 'Age', 'Ageing value', 'Value'],
      rows: [...world.stockpiles]
        .sort((a, b) => b.value - a.value)
        .map((pile) => ({
          ref: { type: 'category', id: pile.categoryId },
          flag: pile.untrusted ? 'late' : pile.ageBand > 0 ? 'warn' : 'ok',
          cells: [
            pile.name,
            String(pile.productCount),
            pile.qty.toLocaleString('en-GB'),
            pile.untrusted ? 'Untrusted: negative stock' : AGE[pile.ageBand],
            money(pile.agedValue),
            money(pile.value),
          ],
        })),
    },
    {
      id: 'customers',
      label: 'Customers',
      columns: ['Customer', 'Status', 'Open orders', 'Revenue, 90 days', 'Credit limit', 'Owes'],
      rows: [...world.customers]
        .sort((a, b) => b.balance - a.balance)
        .map((entry) => ({
          ref: { type: 'customer', id: entry.id },
          flag: entry.onStop ? 'late' : entry.overLimit ? 'warn' : 'ok',
          cells: [
            entry.name,
            entry.onStop ? 'On stop' : entry.overLimit ? 'Over limit' : 'Trading',
            String(entry.openOrderCount),
            money(entry.revenue),
            money(entry.creditLimit),
            money(entry.balance),
          ],
        })),
    },
  ];
}

function open(ref: RecordRef): void {
  const { world, layout } = getState();
  actions.toggleTable(false);
  actions.selectRecord(ref);
  const tile = world && layout ? locate(ref, world, layout) : null;
  if (tile) actions.flyTo(tile);
}

export function TableView() {
  const world = useApp((state) => state.world);
  const [tab, setTab] = useState('late');
  if (!world) return null;
  const all = tables(world);
  const table = all.find((candidate) => candidate.id === tab) ?? all[0];
  if (!table) return null;

  return (
    <section className="panel sheet wide">
      <button className="close" onClick={() => actions.toggleTable(false)} aria-label="Close">
        ×
      </button>
      <h2>Table view</h2>
      <p className="muted subtitle">The same records as the world, on {longDate(world.asOf)}. Click a row to see it on the map.</p>
      <div className="tabs">
        {all.map((candidate) => (
          <button key={candidate.id} className={candidate.id === table.id ? 'active' : ''} onClick={() => setTab(candidate.id)}>
            {candidate.label} <b>{candidate.rows.length}</b>
          </button>
        ))}
      </div>
      <div className="table-wrap tall">
        <table>
          <thead>
            <tr>
              {table.columns.map((column, index) => (
                <th key={column} className={index === table.columns.length - 1 ? 'num' : undefined}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={table.columns.length} className="muted">
                  Nothing here on this day.
                </td>
              </tr>
            )}
            {table.rows.slice(0, TABLE_ROWS).map((row) => (
              <tr key={row.ref.id} className="clickable" onClick={() => open(row.ref)}>
                {row.cells.map((cell, index) => (
                  <td key={index} className={index === row.cells.length - 1 ? 'num' : undefined}>
                    {index === 0 && <i className={`dot ${row.flag}`} />}
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length > TABLE_ROWS && (
        <p className="muted">
          Showing the first {TABLE_ROWS} of {table.rows.length.toLocaleString('en-GB')} rows.
        </p>
      )}
    </section>
  );
}
