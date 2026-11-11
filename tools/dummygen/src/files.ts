import { DATASET_FILES, type Dataset } from '@ai-erp/domain';

/** Serialises a dataset to one JSON file per entity, one record per line so diffs stay readable. */
export function datasetToFiles(dataset: Dataset): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of DATASET_FILES) {
    const value = dataset[name];
    const text = Array.isArray(value)
      ? `[\n${value.map((record) => JSON.stringify(record)).join(',\n')}\n]\n`
      : `${JSON.stringify(value, null, 2)}\n`;
    files.set(`${name}.json`, text);
  }
  return files;
}
