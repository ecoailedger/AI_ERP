/** Small seeded random number generator (mulberry32). Same seed, same sequence, on every machine. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Index chosen in proportion to a running total of weights. */
  pickCumulative(cumulative: readonly number[]): number;
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick: (items) => {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) throw new Error('pick from an empty list');
      return item;
    },
    pickCumulative: (cumulative) => {
      const total = cumulative[cumulative.length - 1] ?? 0;
      const target = next() * total;
      let low = 0;
      let high = cumulative.length - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if ((cumulative[mid] ?? 0) > target) high = mid;
        else low = mid + 1;
      }
      return low;
    },
    shuffle: (items) => {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i--) {
        const j = int(0, i);
        const a = result[i] as (typeof result)[number];
        result[i] = result[j] as (typeof result)[number];
        result[j] = a;
      }
      return result;
    },
  };
}

/** Running totals of a list of weights, for Rng.pickCumulative. */
export function cumulativeWeights(weights: readonly number[]): number[] {
  const result: number[] = [];
  let total = 0;
  for (const weight of weights) {
    total += weight;
    result.push(total);
  }
  return result;
}
