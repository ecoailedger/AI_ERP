import { useEffect, useRef } from 'react';
import { setHover } from '../hud/Tooltip';
import { actions, clock, useApp } from '../store';
import { WorldView, type PickTarget } from './WorldView';

function onPick(target: PickTarget | null): void {
  if (!target) actions.select(null);
  else if (target.kind === 'building') actions.select({ kind: 'building', id: target.id });
  else if (target.kind === 'task') actions.selectTask(target.task);
  else actions.select({ kind: 'records', refs: target.refs, index: 0, note: target.note });
}

/** Mounts the PixiJS world and keeps it fed from the app state. */
export function WorldCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<WorldView | null>(null);
  const layout = useApp((state) => state.layout);
  const world = useApp((state) => state.world);
  const focusSeq = useApp((state) => state.focusSeq);
  const focusTile = useApp((state) => state.focusTile);

  useEffect(() => {
    if (!host.current) return;
    const created = new WorldView(host.current, {
      onPick,
      onHover: setHover,
      onTick: (deltaSeconds) => actions.tick(deltaSeconds),
      fraction: () => clock.fraction,
    });
    view.current = created;
    created.init().catch((error: unknown) => actions.reportError(error));
    return () => {
      view.current = null;
      created.destroy();
    };
  }, []);

  useEffect(() => {
    if (layout) view.current?.setLayout(layout);
  }, [layout]);

  useEffect(() => {
    if (world) view.current?.setWorld(world);
  }, [world, layout]);

  // focusSeq is a dependency so that asking for the same tile twice still moves the camera.
  useEffect(() => {
    if (focusTile) view.current?.flyTo(focusTile);
  }, [focusSeq, focusTile]);

  return <div className="world" ref={host} />;
}
