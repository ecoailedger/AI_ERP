import { DOMAIN_SCHEMA_VERSION } from '@ai-erp/domain';
import { describe, expect, it } from 'vitest';
import { coreInfo } from './index';

describe('core', () => {
  it('reports the domain schema it was built against', () => {
    expect(coreInfo().domainSchemaVersion).toBe(DOMAIN_SCHEMA_VERSION);
  });
});
