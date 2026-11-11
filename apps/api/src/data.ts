import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASET_FILES, DatasetSchema, type Dataset } from '@ai-erp/domain';

/** The committed synthetic dataset. Real snapshots live in data/real and are never committed. */
export const DUMMY_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'dummy');

/** Reads a dataset stored as one JSON file per entity and checks it against the canonical schema. */
export function loadDataset(dir: string): Dataset {
  const raw: Record<string, unknown> = {};
  for (const name of DATASET_FILES) raw[name] = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  const parsed = DatasetSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Dataset in ${dir} does not match the canonical schema: ${first?.path.join('.')}: ${first?.message}`);
  }
  return parsed.data;
}
