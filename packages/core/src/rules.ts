/** Business thresholds. Every "is this a problem?" decision in the world comes from here. */

/** Stock not received for longer than these many days moves into age band 1, 2, 3. */
export const AGE_BAND_DAYS = [180, 365, 730] as const;

/** A category shows an age band once this share of its value is that old. */
export const AGED_VALUE_SHARE = 0.3;

/**
 * A category's stock figure stops being trustworthy once rows that cannot be right (negative stock)
 * are worth this share of it. Below that, the rows are listed as untrusted but the pile is not fogged.
 */
export const UNTRUSTED_VALUE_SHARE = 0.01;

/** A delivery should leave the dock within this many days. */
export const DOCK_STALE_DAYS = 1;

/** A supplier should confirm an order within this many days. */
export const UNACKNOWLEDGED_DAYS = 2;

/** Accounts start chasing an invoice once it is this many days overdue. */
export const DEBT_CHASE_DAYS = 7;

/** Window for the revenue that sizes a customer. */
export const REVENUE_WINDOW_DAYS = 90;

/**
 * An order this many days past its date is treated as stale: probably never closed, rather than still expected.
 * Stale orders are counted and shown apart from late ones, so they do not drown out real lateness.
 */
export const STALE_DAYS = 90;

/** A late purchase order is serious once it is this many days late. */
export const PO_LATE_SERIOUS_DAYS = 7;
