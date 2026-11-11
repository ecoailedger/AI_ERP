/** App state: which day is showing, what is selected, which panels are open. */
import { addDays, type BuildingId, type FigureId, type IsoDate, type RecordRef, type WorldMaster, type WorldState } from '@ai-erp/domain';
import { buildLayout, type Layout, type Tile, type WorkerTask } from '@ai-erp/scene';
import { useSyncExternalStore } from 'react';
import { api } from './api';

export type Selection =
  | { kind: 'records'; refs: RecordRef[]; index: number; note: string | null }
  | { kind: 'building'; id: BuildingId };

export interface AppState {
  master: WorldMaster | null;
  layout: Layout | null;
  error: string | null;
  date: IsoDate;
  world: WorldState | null;
  playing: boolean;
  /** Seconds of real time one day takes when playing. */
  secondsPerDay: number;
  selection: Selection | null;
  figure: FigureId | null;
  tableOpen: boolean;
  /** Bumped to ask the camera to fly to `focusTile`. */
  focusSeq: number;
  focusTile: Tile | null;
}

export const SPEEDS = [10, 5, 2, 1] as const;

let state: AppState = {
  master: null,
  layout: null,
  error: null,
  date: '',
  world: null,
  playing: false,
  secondsPerDay: 5,
  selection: null,
  figure: null,
  tableOpen: false,
  focusSeq: 0,
  focusTile: null,
};

/**
 * How far through the day it is, 0 to 1. Kept outside the reactive state because it changes
 * every frame: the renderer reads it directly, and the HUD only needs the date.
 */
export const clock = { fraction: 0.5 };

const listeners = new Set<() => void>();
const set = (patch: Partial<AppState>): void => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

export const getState = (): AppState => state;
export function useApp<T>(select: (state: AppState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );
}

const fail = (error: unknown): void => set({ error: error instanceof Error ? error.message : String(error), playing: false });

async function showDate(date: IsoDate): Promise<void> {
  const world = await api.state(date);
  // A later request may have finished first; only the date still wanted is shown.
  if (state.date === date) set({ world, error: null });
}

export const actions = {
  async init(): Promise<void> {
    try {
      const master = await api.master();
      set({ master, layout: buildLayout(master), date: master.range.end });
      await showDate(master.range.end);
    } catch (error) {
      fail(error);
    }
  },

  setDate(date: IsoDate, fraction = 0.5): void {
    const { master } = state;
    if (!master) return;
    const clamped = date < master.range.start ? master.range.start : date > master.range.end ? master.range.end : date;
    clock.fraction = fraction;
    if (clamped === state.date) return;
    set({ date: clamped });
    showDate(clamped).catch(fail);
  },

  step(days: number): void {
    set({ playing: false });
    actions.setDate(addDays(state.date, days));
  },

  goLive(): void {
    if (!state.master) return;
    set({ playing: false });
    actions.setDate(state.master.range.end);
  },

  togglePlay(): void {
    const { master, playing, date } = state;
    if (!master) return;
    if (!playing && date >= master.range.end) {
      // Playing from the last day restarts the replay from the first.
      actions.setDate(master.range.start, 0);
    }
    set({ playing: !playing });
  },

  setSpeed(secondsPerDay: number): void {
    set({ secondsPerDay });
  },

  /** Called every frame by the renderer. Moves time on while playing. */
  tick(deltaSeconds: number): void {
    const { master, playing, date, world, secondsPerDay } = state;
    if (!master || !playing) return;
    const next = addDays(date, 1);
    if (date < master.range.end) void api.state(next).catch(() => undefined);
    // Hold at the end of the day until its state has arrived, so the world never runs ahead of the data.
    if (world?.asOf !== date) return;
    clock.fraction += deltaSeconds / secondsPerDay;
    if (clock.fraction < 1) return;
    if (date >= master.range.end) {
      clock.fraction = 1;
      set({ playing: false });
      return;
    }
    actions.setDate(next, 0);
  },

  /** Shows a failure to the user instead of leaving a blank screen. */
  reportError(error: unknown): void {
    fail(error);
  },

  select(selection: Selection | null): void {
    set({ selection });
  },

  selectRecord(ref: RecordRef, note: string | null = null): void {
    set({ selection: { kind: 'records', refs: [ref], index: 0, note } });
  },

  selectTask(task: WorkerTask): void {
    set({ selection: { kind: 'records', refs: [task.ref], index: 0, note: `A worker is on this: ${task.label}` } });
  },

  openFigure(figure: FigureId | null): void {
    set({ figure });
  },

  toggleTable(open?: boolean): void {
    set({ tableOpen: open ?? !state.tableOpen });
  },

  flyTo(tile: Tile): void {
    set({ focusTile: tile, focusSeq: state.focusSeq + 1 });
  },
};
