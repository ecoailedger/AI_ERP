import { addDays, daysBetween } from '@ai-erp/domain';
import { longDate } from '../format';
import { actions, SPEEDS, useApp } from '../store';

/** The time scrubber: drag to any day, or play the days back as a timelapse. */
export function Scrubber() {
  const range = useApp((state) => state.master?.range);
  const date = useApp((state) => state.date);
  const playing = useApp((state) => state.playing);
  const secondsPerDay = useApp((state) => state.secondsPerDay);
  const loading = useApp((state) => state.world?.asOf !== state.date);
  if (!range || !date) return null;

  const total = daysBetween(range.start, range.end);
  const day = daysBetween(range.start, date);
  const live = date === range.end;

  return (
    <footer className="panel scrubber">
      <div className="scrub-controls">
        <button className="icon" onClick={() => actions.step(-1)} disabled={day === 0} title="Back one day" aria-label="Back one day">
          ‹
        </button>
        <button className="play" onClick={() => actions.togglePlay()} title={playing ? 'Pause' : 'Play the days back'}>
          {playing ? 'Pause' : live ? 'Replay' : 'Play'}
        </button>
        <button className="icon" onClick={() => actions.step(1)} disabled={live} title="Forward one day" aria-label="Forward one day">
          ›
        </button>
      </div>
      <div className="scrub-track">
        <div className="scrub-date">
          <strong>{longDate(date)}</strong>
          <span className="muted">{loading ? 'Loading…' : live ? 'Latest day' : `Day ${day + 1} of ${total + 1}`}</span>
        </div>
        <input
          type="range"
          min={0}
          max={total}
          value={day}
          aria-label="Date"
          onChange={(event) => {
            if (playing) actions.togglePlay();
            actions.setDate(addDays(range.start, Number(event.target.value)));
          }}
        />
        <div className="scrub-ends muted">
          <span>{longDate(range.start)}</span>
          <span>{longDate(range.end)}</span>
        </div>
      </div>
      <div className="scrub-speed">
        <span className="muted">One day takes</span>
        <div className="segmented">
          {SPEEDS.map((speed) => (
            <button key={speed} className={speed === secondsPerDay ? 'active' : ''} onClick={() => actions.setSpeed(speed)}>
              {speed}s
            </button>
          ))}
        </div>
        <button className="pill" onClick={() => actions.goLive()} disabled={live}>
          Latest
        </button>
      </div>
    </footer>
  );
}
