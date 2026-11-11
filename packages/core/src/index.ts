/**
 * Core: state machines, exception rules, projections, sandbox ledger, event log.
 * It must not import anything from the game (scene, client). Logic arrives in milestone 1.2.
 */
import { DOMAIN_SCHEMA_VERSION } from '@ai-erp/domain';

export interface CoreInfo {
  name: 'ai-erp-core';
  domainSchemaVersion: number;
}

export function coreInfo(): CoreInfo {
  return { name: 'ai-erp-core', domainSchemaVersion: DOMAIN_SCHEMA_VERSION };
}
