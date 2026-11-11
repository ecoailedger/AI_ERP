import { isAbsolute, join } from 'node:path';
import { createCore } from '@ai-erp/core';
import { buildApp } from './app';
import { DUMMY_DATA_DIR, loadDataset } from './data';

const port = Number(process.env.PORT ?? 5191);
// A relative AI_ERP_DATA_DIR is taken from the repository root, e.g. data/real/lookback.
const requested = process.env.AI_ERP_DATA_DIR;
const dataDir = !requested ? DUMMY_DATA_DIR : isAbsolute(requested) ? requested : join(DUMMY_DATA_DIR, '..', '..', requested);

const dataset = loadDataset(dataDir);
console.log(`api: loaded "${dataset.meta.source}" data, ${dataset.meta.startDate} to ${dataset.meta.endDate}`);

// Local only: the API binds to the loopback interface and nothing wider.
buildApp(createCore(dataset))
  .listen({ port, host: '127.0.0.1' })
  .then((address) => console.log(`api listening on ${address}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
