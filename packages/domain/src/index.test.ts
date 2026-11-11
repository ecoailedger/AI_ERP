import { describe, expect, it } from 'vitest';
import { DOMAIN_SCHEMA_VERSION, ENTITY_KINDS } from './index';

describe('domain', () => {
  it('has a schema version', () => {
    expect(DOMAIN_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('lists each entity kind once', () => {
    expect(new Set(ENTITY_KINDS).size).toBe(ENTITY_KINDS.length);
  });
});
