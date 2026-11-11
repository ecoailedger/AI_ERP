import { useEffect } from 'react';
import { AlertsPanel } from './hud/AlertsPanel';
import { FigurePanel } from './hud/FigurePanel';
import { ResourceBar } from './hud/ResourceBar';
import { Scrubber } from './hud/Scrubber';
import { SelectionPanel } from './hud/SelectionPanel';
import { TableView } from './hud/TableView';
import { Tooltip } from './hud/Tooltip';
import { actions, useApp } from './store';
import { WorldCanvas } from './world/WorldCanvas';

export function App() {
  const error = useApp((state) => state.error);
  const ready = useApp((state) => state.world !== null);
  const figureOpen = useApp((state) => state.figure !== null);
  const tableOpen = useApp((state) => state.tableOpen);

  useEffect(() => {
    void actions.init();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === ' ') {
        event.preventDefault();
        actions.togglePlay();
      } else if (event.key === 'ArrowLeft') actions.step(-1);
      else if (event.key === 'ArrowRight') actions.step(1);
      else if (event.key === 'Escape') {
        actions.select(null);
        actions.openFigure(null);
        actions.toggleTable(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <WorldCanvas />
      <ResourceBar />
      {!tableOpen && !figureOpen && <AlertsPanel />}
      <SelectionPanel />
      {figureOpen && <FigurePanel />}
      {tableOpen && <TableView />}
      <Scrubber />
      <Tooltip />
      {error && (
        <div className="banner" role="alert">
          <strong>Something went wrong.</strong> {error} Check <code>npm run dev</code> is running, then reload.
        </div>
      )}
      {!ready && !error && <div className="banner quiet">Loading the world…</div>}
    </>
  );
}
