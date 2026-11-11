import { useSyncExternalStore } from 'react';
import type { HoverInfo } from '../world/WorldView';

let hover: HoverInfo | null = null;
const listeners = new Set<() => void>();

/** Called by the renderer as the pointer moves over things in the world. */
export function setHover(next: HoverInfo | null): void {
  if (next === hover) return;
  if (next && hover && next.x === hover.x && next.y === hover.y && next.lines.join('|') === hover.lines.join('|')) return;
  hover = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function Tooltip() {
  const info = useSyncExternalStore(subscribe, () => hover);
  if (!info) return null;
  const flipX = info.x > window.innerWidth - 300;
  const flipY = info.y > window.innerHeight - 140;
  return (
    <div
      className="tooltip"
      style={{
        left: flipX ? undefined : info.x + 16,
        right: flipX ? window.innerWidth - info.x + 16 : undefined,
        top: flipY ? undefined : info.y + 16,
        bottom: flipY ? window.innerHeight - info.y + 16 : undefined,
      }}
    >
      {info.lines.map((line, index) => (
        <div key={index} className={index === 0 ? 'tooltip-title' : undefined}>
          {line}
        </div>
      ))}
      <div className="tooltip-hint">Click for the records</div>
    </div>
  );
}
