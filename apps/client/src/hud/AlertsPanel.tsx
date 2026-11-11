import type { Alert } from '@ai-erp/domain';
import { useState } from 'react';
import { actions, getState, useApp } from '../store';
import { locate } from '../world/locate';

function open(alert: Alert): void {
  const { world, layout } = getState();
  actions.selectRecord(alert.ref, alert.detail);
  const tile = world && layout ? locate(alert.ref, world, layout) : null;
  if (tile) actions.flyTo(tile);
}

/** Exceptions, most serious first. Clicking one flies the camera to it. */
export function AlertsPanel() {
  const alerts = useApp((state) => state.world?.alerts) ?? [];
  const [collapsed, setCollapsed] = useState(false);
  const high = alerts.filter((alert) => alert.severity === 'high').length;

  return (
    <aside className={`panel alerts${collapsed ? ' collapsed' : ''}`}>
      <button className="panel-head" onClick={() => setCollapsed(!collapsed)}>
        <span>
          Needs attention <b>{alerts.length}</b>
        </span>
        <span className="muted">{collapsed ? 'Show' : `${high} serious`}</span>
      </button>
      {!collapsed && (
        <ul className="alert-list">
          {alerts.length === 0 && <li className="muted empty">Nothing is stuck.</li>}
          {alerts.map((alert) => (
            <li key={alert.id}>
              <button className="alert" onClick={() => open(alert)}>
                <i className={`dot ${alert.severity === 'high' ? 'late' : 'warn'}`} />
                <span>
                  <strong>{alert.title}</strong>
                  <small>{alert.detail}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
