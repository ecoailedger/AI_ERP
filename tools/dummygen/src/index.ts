/**
 * Writes the dummy dataset to data/dummy. Run with: npm run generate -w @ai-erp/dummygen
 * Synthetic data only. Never put real names or figures here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetToFiles } from './files';
import { DEFAULT_OPTIONS, generate } from './generate';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'dummy');
const dataset = generate(DEFAULT_OPTIONS);

mkdirSync(outDir, { recursive: true });
for (const [name, text] of datasetToFiles(dataset)) writeFileSync(join(outDir, name), text);

console.log(
  `dummygen: seed ${DEFAULT_OPTIONS.seed}, ${dataset.meta.startDate} to ${dataset.meta.endDate}: ` +
    `${dataset.purchaseOrders.length} purchase orders, ${dataset.salesOrders.length} sales orders, ` +
    `${dataset.goodsReceipts.length} receipts, ${dataset.salesInvoices.length} sales invoices -> ${outDir}`,
);
