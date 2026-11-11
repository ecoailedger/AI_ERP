import type { FigureRecords } from '@ai-erp/domain';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { longDate, money } from '../format';
import { actions, useApp } from '../store';

const SHOWN = 300;

/** The records behind a resource bar figure. Their amounts add up to the figure exactly. */
export function FigurePanel() {
  const figure = useApp((state) => state.figure);
  const date = useApp((state) => state.date);
  const [records, setRecords] = useState<FigureRecords | null>(null);

  useEffect(() => {
    if (!figure) return;
    let current = true;
    setRecords(null);
    api
      .figureRecords(figure, date)
      .then((loaded) => current && setRecords(loaded))
      .catch(() => current && setRecords(null));
    return () => {
      current = false;
    };
  }, [figure, date]);

  if (!figure) return null;
  const rows = records?.rows ?? [];

  return (
    <section className="panel sheet">
      <button className="close" onClick={() => actions.openFigure(null)} aria-label="Close">
        ×
      </button>
      {!records && <p className="muted">Loading…</p>}
      {records && (
        <>
          <h2>
            {records.figure.label}: {money(records.figure.value)}
          </h2>
          <p className="muted subtitle">
            {rows.length.toLocaleString('en-GB')} rows on {longDate(date)}. They add up to the figure above.
            {records.figure.simulated && ' This figure is simulated: it has no real source yet.'}
          </p>
          <div className="table-wrap tall">
            <table>
              <thead>
                <tr>
                  {records.columns.map((column, index) => (
                    <th key={column} className={index === records.columns.length - 1 ? 'num' : undefined}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, SHOWN).map((row, index) => (
                  <tr
                    key={index}
                    className={row.ref ? 'clickable' : undefined}
                    onClick={() => {
                      if (row.ref) actions.selectRecord(row.ref);
                    }}
                  >
                    {row.cells.map((cell, cellIndex) => (
                      <td key={cellIndex} className={cellIndex === row.cells.length - 1 ? 'num' : undefined}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > SHOWN && (
            <p className="muted">
              Showing the first {SHOWN} of {rows.length.toLocaleString('en-GB')} rows. The total covers all of them.
            </p>
          )}
        </>
      )}
    </section>
  );
}
