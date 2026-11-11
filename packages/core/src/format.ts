export const round2 = (value: number): number => Math.round(value * 100) / 100;

/** "£12,345.60". Fixed formatting so output is the same on every machine. */
export function money(value: number): string {
  const [whole, pence] = Math.abs(value).toFixed(2).split('.') as [string, string];
  return `${value < 0 ? '-' : ''}£${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${pence}`;
}

/** "£12k", "£3.4m": short form for labels. */
export function moneyShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}m`;
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1_000)}k`;
  return `${sign}£${Math.round(abs)}`;
}

export const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;
