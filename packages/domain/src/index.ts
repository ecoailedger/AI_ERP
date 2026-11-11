/**
 * Types shared by every layer: the canonical dataset, the world-state API contract, and date helpers.
 */

/** Bumped when the canonical dataset shape changes, so snapshots can be checked on load. */
export const DOMAIN_SCHEMA_VERSION = 1;

export * from './dates';
export * from './dataset';
export * from './world';
