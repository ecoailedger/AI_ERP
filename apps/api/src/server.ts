import { createCore } from '@ai-erp/core';
import { buildApp } from './app';
import { DUMMY_DATA_DIR, loadDataset } from './data';

const port = Number(process.env.PORT ?? 5191);
const dataDir = process.env.AI_ERP_DATA_DIR ?? DUMMY_DATA_DIR;

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
