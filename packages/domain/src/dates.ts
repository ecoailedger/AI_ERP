/** ISO calendar date, e.g. "2026-11-11". Plain strings compare correctly with < and >. */
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  // Date.parse rolls 30 February over into March, so check the date survives a round trip.
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Whole days since 1970-01-01. */
export function toDayNumber(date: IsoDate): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY);
}

export function fromDayNumber(day: number): IsoDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

export function isWeekend(date: IsoDate): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** The same date if it is a weekday, otherwise the following Monday. */
export function nextWorkday(date: IsoDate): IsoDate {
  let day = date;
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}

/** Stands in for a date the source does not hold, such as a purchase order with no due date. */
export const UNKNOWN_DATE: IsoDate = '2099-12-31';

export function clampDate(date: IsoDate, min: IsoDate, max: IsoDate): IsoDate {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}
