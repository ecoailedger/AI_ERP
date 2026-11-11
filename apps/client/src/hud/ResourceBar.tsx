import type { Figure } from '@ai-erp/domain';
import { moneyShort } from '../format';
import { actions, useApp } from '../store';

const UNIT: Record<Figure['id'], string> = {
  stockValue: 'products',
  debtors: 'unpaid invoices',
  openSalesOrders: 'orders',
  openPurchaseOrders: 'orders',
  creditors: 'unpaid bills',
  cash: 'movements',
};

/** The figures along the top. Each one opens the records that add up to it. */
export function ResourceBar() {
  const figures = useApp((state) => state.world?.figures);
  const open = useApp((state) => state.figure);
  const source = useApp((state) => state.master?.source);
  const tableOpen = useApp((state) => state.tableOpen);

  return (
    <header className="resource-bar">
      <div className="brand">
        <strong>AI_ERP</strong>
        <span>{source === 'dummy' ? 'Dummy data' : source === undefined ? '' : `Real data: ${source}`}</span>
      </div>
      <div className="figures">
        {(figures ?? []).map((figure) => (
          <button
            key={figure.id}
            className={`figure${open === figure.id ? ' active' : ''}`}
            onClick={() => actions.openFigure(open === figure.id ? null : figure.id)}
            title={`Show the ${figure.count.toLocaleString('en-GB')} ${UNIT[figure.id]} behind this figure`}
          >
            <span className="figure-label">
              {figure.label}
              {figure.simulated && <em>simulated</em>}
            </span>
            <span className="figure-value">{moneyShort(figure.value)}</span>
            <span className="figure-count">
              {figure.count.toLocaleString('en-GB')} {UNIT[figure.id]}
            </span>
          </button>
        ))}
      </div>
      <button className={`pill${tableOpen ? ' active' : ''}`} onClick={() => actions.toggleTable()}>
        {tableOpen ? 'Back to the world' : 'Table view'}
      </button>
    </header>
  );
}
