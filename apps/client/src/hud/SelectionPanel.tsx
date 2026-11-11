import type { BuildingId, RecordCard, RecordRef } from '@ai-erp/domain';
import { BUILDINGS, headcount } from '@ai-erp/scene';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { money } from '../format';
import { actions, getState, useApp, type Selection } from '../store';
import { locate } from '../world/locate';

function showOnMap(ref: RecordRef): void {
  const { world, layout } = getState();
  const tile = world && layout ? locate(ref, world, layout) : null;
  if (tile) actions.flyTo(tile);
}

/** One record as it stood on the day showing, with where it came from. */
function RecordView({ selection }: { selection: Extract<Selection, { kind: 'records' }> }) {
  const date = useApp((state) => state.date);
  const ref = selection.refs[selection.index];
  const [card, setCard] = useState<RecordCard | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    if (!ref) return;
    let current = true;
    setMissing(null);
    api
      .record(ref, date)
      .then((loaded) => current && setCard(loaded))
      .catch((error: unknown) => {
        if (!current) return;
        setCard(null);
        setMissing(error instanceof Error ? error.message : String(error));
      });
    return () => {
      current = false;
    };
  }, [ref, date]);

  if (!ref) return null;
  const count = selection.refs.length;
  const move = (by: number): void =>
    actions.select({ ...selection, index: (selection.index + by + count) % count });

  return (
    <>
      {count > 1 && (
        <div className="pager">
          <button className="icon" onClick={() => move(-1)} aria-label="Previous record">
            ‹
          </button>
          <span>
            {selection.index + 1} of {count}
          </span>
          <button className="icon" onClick={() => move(1)} aria-label="Next record">
            ›
          </button>
        </div>
      )}
      {selection.note && <p className="note">{selection.note}</p>}
      {missing && <p className="muted">{missing}</p>}
      {card && (
        <>
          <h2>{card.title}</h2>
          <p className="muted subtitle">{card.subtitle}</p>
          <span className={`chip ${card.status.flag}`}>{card.status.text}</span>
          <dl className="fields">
            {card.fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
          {card.lines && card.lines.rows.length > 0 && (
            <div className="table-wrap small">
              <table>
                <thead>
                  <tr>
                    {card.lines.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {card.lines.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {card.related.length > 0 && (
            <div className="related">
              <h3>Linked records</h3>
              {card.related.map((link) => (
                <button key={`${link.ref.type}:${link.ref.id}`} className="link" onClick={() => actions.selectRecord(link.ref)}>
                  {link.label}
                </button>
              ))}
            </div>
          )}
          <div className="card-foot">
            <button className="pill" onClick={() => showOnMap(card.ref)}>
              Show on map
            </button>
            <span className="muted source">
              Source: {card.source.map((source) => `${source.system} / ${source.entity} / ${source.id}`).join(', ')}
            </span>
          </div>
        </>
      )}
    </>
  );
}

/** A building's queue: the plain list of records it is working through. */
function QueueView({ id }: { id: BuildingId }) {
  const building = useApp((state) => state.world?.buildings.find((candidate) => candidate.id === id));
  if (!building) return null;
  const { workers, backlog } = headcount(id, building.queue.length);

  return (
    <>
      <h2>{BUILDINGS[id].label}</h2>
      <p className="muted subtitle">
        {building.queue.length} {building.queue.length === 1 ? 'job' : 'jobs'}, {workers} at work
      </p>
      <span className={`chip ${backlog > 0 ? 'late' : 'ok'}`}>
        {backlog > 0 ? `${backlog} more than it can handle` : building.queue.length === 0 ? 'Nothing to do' : 'Keeping up'}
      </span>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Detail</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {building.queue.map((item, index) => (
              <tr key={`${item.kind}:${item.ref.id}:${index}`} className="clickable" onClick={() => actions.selectRecord(item.ref, item.label)}>
                <td>
                  <i className={`dot ${item.flag}`} />
                  {item.label}
                </td>
                <td>{item.detail}</td>
                <td className="num">{money(item.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SelectionPanel() {
  const selection = useApp((state) => state.selection);
  if (!selection) return null;
  return (
    <aside className="panel selection">
      <button className="close" onClick={() => actions.select(null)} aria-label="Close">
        ×
      </button>
      {selection.kind === 'building' ? <QueueView id={selection.id} /> : <RecordView selection={selection} />}
    </aside>
  );
}
