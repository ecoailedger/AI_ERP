/**
 * Invented names for dummy suppliers, customers and products.
 * Everything here is made up. Never add a real company, brand or product name.
 */
import type { Rng } from './rng';

const STEMS = [
  'Brindle', 'Thorn', 'Wex', 'Cald', 'Quill', 'Ember', 'Fenn', 'Hollo', 'Marrow', 'Tessel',
  'Vander', 'Oster', 'Pell', 'Kes', 'Dru', 'Lumen', 'Corv', 'Zeph', 'Nim', 'Arden',
  'Sable', 'Wren', 'Garn', 'Isk', 'Morro', 'Tavi', 'Ulver', 'Yarrow', 'Bex', 'Halcy',
] as const;

const ENDINGS = [
  'combe', 'wick', 'mere', 'shaw', 'holt', 'reach', 'vale', 'moor', 'stead', 'brook',
  'crest', 'fell', 'haven', 'thwaite', 'barrow', 'garth', 'ridge', 'well',
] as const;

const SUPPLIER_SUFFIXES = [
  'Audio Works', 'Display Co', 'Optics', 'Sound Labs', 'Visual Systems', 'Electronics',
  'Signal Co', 'Supply', 'Lighting Works', 'Imaging', 'Acoustics', 'Devices',
] as const;

const CUSTOMER_SUFFIXES = [
  'Integrations', 'Hire', 'Events', 'Installs', 'Systems', 'Media', 'Studios',
  'Stage & Sound', 'Solutions', 'Conferencing', 'Schools Trust', 'Theatre Co', 'Venues',
] as const;

export interface NameMaker {
  supplier(): string;
  customer(): string;
}

export function createNameMaker(rng: Rng): NameMaker {
  const used = new Set<string>();

  const unique = (suffixes: readonly string[]): string => {
    for (;;) {
      const name = `${rng.pick(STEMS)}${rng.pick(ENDINGS)} ${rng.pick(suffixes)}`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  };

  return {
    supplier: () => unique(SUPPLIER_SUFFIXES),
    customer: () => unique(CUSTOMER_SUFFIXES),
  };
}

/** Generic product categories for an audio-visual distributor, with a cost range and a singular noun. */
export const CATEGORIES = [
  { name: 'Displays', noun: 'Display', costLow: 180, costHigh: 2400, weight: 8 },
  { name: 'Projectors', noun: 'Projector', costLow: 350, costHigh: 3200, weight: 5 },
  { name: 'Loudspeakers', noun: 'Loudspeaker', costLow: 60, costHigh: 900, weight: 9 },
  { name: 'Microphones', noun: 'Microphone', costLow: 25, costHigh: 420, weight: 8 },
  { name: 'Mixers', noun: 'Mixer', costLow: 140, costHigh: 1600, weight: 5 },
  { name: 'Cables', noun: 'Cable', costLow: 2, costHigh: 45, weight: 14 },
  { name: 'Mounts', noun: 'Mount', costLow: 12, costHigh: 190, weight: 10 },
  { name: 'Lighting', noun: 'Light', costLow: 70, costHigh: 1100, weight: 7 },
  { name: 'Cameras', noun: 'Camera', costLow: 220, costHigh: 2800, weight: 5 },
  { name: 'Control Systems', noun: 'Controller', costLow: 90, costHigh: 1500, weight: 6 },
  { name: 'Signage Players', noun: 'Player', costLow: 110, costHigh: 650, weight: 5 },
  { name: 'Accessories', noun: 'Accessory', costLow: 3, costHigh: 80, weight: 12 },
] as const;

const MODEL_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXZ';

export function productDescription(rng: Rng, noun: string): string {
  const letters = `${MODEL_LETTERS[rng.int(0, MODEL_LETTERS.length - 1)]}${MODEL_LETTERS[rng.int(0, MODEL_LETTERS.length - 1)]}`;
  return `${noun} ${letters}-${rng.int(100, 999)}`;
}
